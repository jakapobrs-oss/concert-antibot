// ============================================================
// Order Finalize / Cancel — transaction ที่ปลอดภัยต่อ concurrency (N1, N3)
// ============================================================
// แยกออกจาก app/actions/booking.ts เพราะ:
//   1) เป็นหัวใจของ "ความถูกต้องเรื่องเงิน" — ต้องเขียน concurrency test ได้โดยตรง (ไม่ต้อง mock auth)
//   2) auth/verify สลิป เป็นหน้าที่ของ server action (caller) ทำมาก่อน — ที่นี่รับแต่ id/seat
//
// ปัญหาเดิม (N1): submitSlip อ่าน order (PENDING) นอก transaction แล้วระหว่างรอ EasySlip (กินเวลาหลายวินาที)
//   ถ้า sweeper/cancelOrder คั่นกลาง (ยกเลิก order + คืนที่นั่ง) → transaction เดิมเขียน PAID/SOLD แบบ
//   ไม่มี guard = "ชุบชีวิต" order ที่ถูกยกเลิก + ออกตั๋วทับที่นั่งที่อาจขายให้คนอื่นไปแล้ว (double-book)
//
// วิธีแก้: ทำแบบเดียวกับ order-sweeper — claim ด้วย conditional updateMany ใน interactive transaction
//   - claim order: ต้องยัง PENDING + ยังไม่หมดอายุ → PAID  (ถ้า count===0 = ไม่มีสิทธิ์ → rollback)
//   - claim seats: ต้องยัง HELD ครบทุกที่ → SOLD          (ถ้าไม่ครบ = ที่นั่งถูกปล่อย/ขายไป → rollback)
//   conditional updateMany จะล็อกแถวที่ match จึงเป็น atomic compare-and-set กัน race ได้จริง
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { exceedsPayerLimit } from "@/lib/payer-key";
import { exceedsTicketLimit, remainingTicketAllowance } from "@/lib/ticket-limit";
import crypto from "node:crypto";

export type FinalizeReason =
  | "ORDER_NOT_CLAIMABLE"
  | "SEAT_CONFLICT"
  | "PAYER_LIMIT"
  | "DUPLICATE_SLIP"
  | "ERROR";

export type FinalizeResult =
  | { ok: true; ticketCount: number }
  | { ok: false; reason: FinalizeReason };

// error ภายในใช้สื่อสารเหตุ rollback ออกมานอก transaction
class FinalizeError extends Error {
  reason: FinalizeReason;
  constructor(reason: FinalizeReason) {
    super(reason);
    this.reason = reason;
  }
}

// ออกตั๋ว + mark paid แบบ atomic & race-safe
// caller ต้องยืนยันเงินเข้า (verifySlip) + ownership + rate-limit มาก่อนแล้ว
export async function finalizePaidOrder(params: {
  orderId: bigint;
  userId: bigint;
  concertId: bigint;
  // holderUserId: "ผู้ถือ" ของที่นั่งนั้น (named ticket, docs/19) — null/ไม่ส่ง = ผู้ซื้อถือเอง
  // ความถูกต้องของผู้ถือ (verified/อายุบัญชี/เพดานรับ) ถูกบังคับตอน assignHolder ก่อนจ่ายแล้ว
  items: { seatId: bigint; price: Prisma.Decimal; holderUserId?: bigint | null }[];
  slipRef: string | null | undefined;
  senderName?: string | null;
  senderAccount?: string | null;
  payerKey?: string | null; // คีย์ผู้จ่าย (จาก computePayerKey) — null/undefined = ข้าม per-payer cap
  perPayerLimit?: number; // เพดานตั๋วต่อผู้จ่ายต่อคอนเสิร์ต (0/undefined = ปิด cap)
  paidAt?: Date | null;
  now?: Date; // เปิดให้ test ฉีดเวลาได้
}): Promise<FinalizeResult> {
  const now = params.now ?? new Date();
  const seatIds = params.items.map((i) => i.seatId);

  try {
    await prisma.$transaction(
      async (tx) => {
      // 0) per-payer cap (anti-scalping): นับตั๋วที่ "ผู้จ่ายรายนี้" ได้ไปแล้วสำหรับคอนเสิร์ตนี้ (ข้ามทุก app account)
      //    กันขบวนการปั๊มบัญชีแอปแล้วจ่ายจากบัญชีธนาคารเดียว — บังคับที่ชั้น payment ที่ปลอมไม่ได้ (โอนเงินจริง)
      //    ทำใน 同 transaction กับการ claim → ถ้า 2 สลิปของผู้จ่ายเดียวกันชนกัน อย่างมากหลุดได้แค่ขอบ (ดู test)
      const limit = params.perPayerLimit ?? 0;
      if (params.payerKey && limit > 0) {
        const priorPaid = await tx.ticket.count({
          where: { order: { concertId: params.concertId, payment: { payerKey: params.payerKey } } },
        });
        if (exceedsPayerLimit({ priorPaid, requested: params.items.length, limit })) {
          throw new FinalizeError("PAYER_LIMIT");
        }
      }

      // 1) claim order: PENDING + ยังไม่หมดอายุ + เป็นของ user คนนี้ → PAID
      //    กัน N1: ถ้าถูก cancel/expire ระหว่างรอ verify จะ claim ไม่ได้ → ไม่ resurrect
      const claimed = await tx.order.updateMany({
        where: { id: params.orderId, userId: params.userId, status: "PENDING", expiresAt: { gt: now } },
        data: { status: "PAID", paidAt: now },
      });
      if (claimed.count === 0) throw new FinalizeError("ORDER_NOT_CLAIMABLE");

      // 2) claim ที่นั่ง: ต้องยัง HELD ครบทุกที่ → SOLD (กัน double-book)
      const sold = await tx.seat.updateMany({
        where: { id: { in: seatIds }, status: "HELD" },
        data: { status: "SOLD" },
      });
      if (sold.count !== seatIds.length) throw new FinalizeError("SEAT_CONFLICT");

      // 3) payment success + slipRef (unique กันสลิปซ้ำ — ถ้าซ้ำจะ throw → DUPLICATE_SLIP)
      //    เก็บ senderAccount + payerKey ไว้ให้ order ถัดไปของผู้จ่ายคนเดียวกันนับ cap เจอ
      await tx.payment.update({
        where: { orderId: params.orderId },
        data: {
          status: "SUCCESS",
          slipRef: params.slipRef,
          senderName: params.senderName ?? undefined,
          senderAccount: params.senderAccount ?? undefined,
          payerKey: params.payerKey ?? undefined,
          paidAt: params.paidAt ?? now,
        },
      });

      // 4) ออกตั๋ว 1 ใบ/ที่นั่ง (atomic กับขั้นบน — partial unique บน seatId + qrCode unique กันซ้ำซ้อน)
      //    named ticket: Ticket.userId = ผู้ถือ (default ผู้ซื้อ) + snapshot ชื่อไว้เทียบบัตร ปชช.
      const holderIds = Array.from(
        new Set([
          params.userId,
          ...params.items
            .map((i) => i.holderUserId)
            .filter((x): x is bigint => x !== null && x !== undefined),
        ])
      );
      const holderRows = await tx.user.findMany({
        where: { id: { in: holderIds } },
        select: { id: true, name: true, email: true },
      });
      const holderNameById = new Map(
        holderRows.map((u) => [u.id.toString(), u.name?.trim() || u.email])
      );

      for (const item of params.items) {
        const holderId = item.holderUserId ?? params.userId;
        await tx.ticket.create({
          data: {
            orderId: params.orderId,
            seatId: item.seatId,
            userId: holderId,
            qrCode: `TKT-${crypto.randomBytes(16).toString("hex")}`,
            price: item.price,
            holderName: holderNameById.get(holderId.toString()) ?? "",
            // secret ของ dynamic QR — สุ่มต่อใบ ห้ามหลุดไป client (client ได้แค่ code รายรอบ)
            qrSecret: crypto.randomBytes(32).toString("hex"),
          },
        });
      }
    },
    {
      // Serializable กันการ race condition ของ per-payer cap (count-then-check)
      // ถ้า 2 transaction ยิงพร้อมกัน PostgreSQL จะ abort ตัวใดตัวหนึ่ง → retry ที่ caller
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    }
    );

    return { ok: true, ticketCount: params.items.length };
  } catch (e) {
    if (e instanceof FinalizeError) return { ok: false, reason: e.reason };
    // unique violation (slipRef/seatId/qrCode ซ้ำ) หรือ error อื่น → ถือเป็น duplicate/พลาด
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, reason: "DUPLICATE_SLIP" };
    }
    return { ok: false, reason: "ERROR" };
  }
}

// ============================================================
// Refund bookkeeping (Codex #3/#6)
// ============================================================

export type RefundRecordResult =
  | { recorded: true }
  | { recorded: false; reason: "SLIP_ALREADY_USED" | "PAYMENT_ALREADY_SUCCESS" | "ERROR" };

// Codex #3: เงินเข้าจริง (สลิปผ่าน verify) แต่ออกตั๋วไม่ได้ — เดิมมีแค่ console.error
//   (log หายตอน restart / ไม่มีใครไล่อ่าน) → เก็บลง DB: payment เป็น REFUND_REQUIRED + ผูก slipRef
// ผลพลอยได้จาก slipRef UNIQUE: สลิปใบนี้ถูก "จอง" กับ payment นี้ —
//   เอาไปเวียนจ่าย order อื่นไม่ได้อีก (กันหมุนสลิปที่กำลังรอคืนเงินไปซื้อใหม่)
export async function recordRefundRequired(params: {
  orderId: bigint;
  slipRef?: string | null;
  senderName?: string | null;
  senderAccount?: string | null;
  payerKey?: string | null;
}): Promise<RefundRecordResult> {
  try {
    // ไม่ทับ payment ที่ SUCCESS — order นั้นจ่ายสำเร็จด้วยสลิปอื่นไปแล้ว (เคสจ่ายซ้อน ให้ ops ดูจาก log)
    const updated = await prisma.payment.updateMany({
      where: { orderId: params.orderId, status: { not: "SUCCESS" } },
      data: {
        status: "REFUND_REQUIRED",
        slipRef: params.slipRef ?? undefined,
        senderName: params.senderName ?? undefined,
        senderAccount: params.senderAccount ?? undefined,
        payerKey: params.payerKey ?? undefined,
      },
    });
    if (updated.count === 0) return { recorded: false, reason: "PAYMENT_ALREADY_SUCCESS" };
    return { recorded: true };
  } catch (e) {
    // slipRef ซ้ำ = สลิปใบนี้จ่าย order อื่นสำเร็จ/ถูกจองไปแล้ว → สลิปเวียน ไม่ใช่เคสคืนเงิน
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { recorded: false, reason: "SLIP_ALREADY_USED" };
    }
    return { recorded: false, reason: "ERROR" };
  }
}

// Codex #6: order นี้ "จ่ายสำเร็จด้วยสลิปใบเดียวกัน" ไปแล้วหรือยัง
// ใช้ตอน claim ไม่ได้ (ORDER_NOT_CLAIMABLE) — ถ้าใช่ = ผู้ใช้กดส่งซ้ำ/สอง tab ยิงพร้อมกัน
// ต้องตอบ "สำเร็จ" แบบ idempotent (ลูกค้าได้ตั๋วแล้ว) ไม่ใช่ log REFUND ผิดๆ ขู่ว่าต้องคืนเงิน
export async function findPaidOrderBySlip(params: {
  orderId: bigint;
  userId: bigint;
  slipRef: string;
}): Promise<{ paid: true; ticketCount: number } | { paid: false }> {
  const order = await prisma.order.findFirst({
    where: {
      id: params.orderId,
      userId: params.userId,
      status: "PAID",
      payment: { is: { status: "SUCCESS", slipRef: params.slipRef } },
    },
    select: { _count: { select: { tickets: true } } },
  });
  if (!order) return { paid: false };
  return { paid: true, ticketCount: order._count.tickets };
}

// ยกเลิก order แบบ atomic & race-safe (N3)
// ยกเลิกเฉพาะถ้ายัง PENDING (กัน race กับ submitSlip ที่อาจเพิ่งจ่ายสำเร็จ → ไม่ไปยกเลิก order ที่ PAID แล้ว)
export async function cancelPendingOrder(params: {
  orderId: bigint;
  userId: bigint;
}): Promise<{ ok: boolean }> {
  try {
    await prisma.$transaction(async (tx) => {
      // claim: ยกเลิกเฉพาะ PENDING ที่เป็นของ user คนนี้
      const cancelled = await tx.order.updateMany({
        where: { id: params.orderId, userId: params.userId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      if (cancelled.count === 0) throw new FinalizeError("ORDER_NOT_CLAIMABLE");

      // อ่านที่นั่งของ order นี้ (หลัง claim สำเร็จ) แล้วลบ OrderItem
      //   OrderItem.seatId เป็น @unique global — ต้องลบเพื่อให้ที่นั่งจองใหม่ได้ (order ที่ยกเลิกยังไม่มีตั๋ว)
      const items = await tx.orderItem.findMany({
        where: { orderId: params.orderId },
        select: { seatId: true },
      });
      const seatIds = items.map((i) => i.seatId);
      await tx.orderItem.deleteMany({ where: { orderId: params.orderId } });

      // คืนเฉพาะที่นั่งที่ยัง HELD (ไม่แตะ SOLD เผื่อ race)
      if (seatIds.length > 0) {
        await tx.seat.updateMany({
          where: { id: { in: seatIds }, status: "HELD" },
          data: { status: "AVAILABLE" },
        });
      }
    });
    return { ok: true };
  } catch {
    // order ไม่ใช่ PENDING แล้ว (อาจจ่ายสำเร็จไปแล้ว) → ไม่ยกเลิก
    return { ok: false };
  }
}

// ============================================================
// Reserve — สร้าง order PENDING + จองที่นั่ง (HELD) แบบ race-safe ต่อ "ลิมิตตั๋วต่อ user" (Codex #5)
// ============================================================
// error ภายในสำหรับ rollback ออกมานอก transaction (LIMIT ต้องพก remaining กลับไปทำข้อความ)
class ReserveError extends Error {
  reason: "LIMIT" | "SEAT_TAKEN";
  remaining: number;
  constructor(reason: "LIMIT" | "SEAT_TAKEN", remaining = 0) {
    super(reason);
    this.reason = reason;
    this.remaining = remaining;
  }
}

export type ReserveResult =
  | { ok: true; orderId: bigint }
  | { ok: false; reason: "LIMIT"; remaining: number }
  | { ok: false; reason: "SEAT_TAKEN" | "ERROR" };

// สร้าง order + จองที่นั่ง — caller (booking.ts) ต้อง verify มาก่อน:
//   queue admit, concert ON_SALE, ownership, ที่นั่งเป็นของคอนเสิร์ตนี้ + AVAILABLE, และถือ Redis hold ไว้แล้ว
// ที่นี่รับผิดชอบเฉพาะชั้น DB: atomic + กัน race ของ "ลิมิตตั๋วต่อ user ต่อคอนเสิร์ต"
//
// ปัญหาเดิม (Codex #5): booking.ts นับ committed (PAID + PENDING active) "นอก transaction ไม่มี lock"
//   → 2 คำขอจอง "คนละที่นั่ง" พร้อมกัน ต่างอ่าน committed เดิมเท่ากัน แล้วผ่าน check ทั้งคู่
//   → รวมกันเกินโควตา (กักที่นั่ง/เข้าคิวซ้ำเพื่อกักตุน)
// วิธีแก้: advisory xact lock ต่อ (userId, concertId) → นับ+เช็ค+สร้าง "ภายใต้ lock เดียวกัน"
//   lock ผูกกับ transaction (ปล่อยอัตโนมัติเมื่อ commit/rollback) → ปลอดภัยกับ pgbouncer transaction pooling
export async function reserveSeatsForOrder(params: {
  userId: bigint;
  concertId: bigint;
  items: { seatId: bigint; price: Prisma.Decimal }[];
  maxTicketsPerUser: number;
  expiresAt: Date;
  now?: Date; // เปิดให้ test ฉีดเวลาได้
}): Promise<ReserveResult> {
  const now = params.now ?? new Date();
  const seatIds = params.items.map((i) => i.seatId);
  const totalAmount = params.items.reduce((sum, i) => sum + Number(i.price.toString()), 0);

  try {
    const orderId = await prisma.$transaction(async (tx) => {
      // 🔒 advisory lock ต่อ (user, concert) — serialize คำขอจองของ user คนนี้ในคอนเสิร์ตนี้
      //    (คำขอของ user/คอนเสิร์ตอื่นไม่ถูกกระทบ) → นับลิมิตด้านล่างจึงแม่นยำ ไม่ต้องใช้ Serializable+retry
      //    ใช้ $executeRaw (ไม่ map ผลลัพธ์) เพราะ pg_advisory_xact_lock คืน void ที่ $queryRaw deserialize ไม่ได้
      const lockKey = `ticketlimit:${params.userId}:${params.concertId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      // นับตั๋วที่ผูกพันอยู่แล้ว "ภายใต้ lock" — PAID + PENDING ที่ยังไม่หมดอายุ (ตรงกับ pre-check ใน booking.ts)
      const committed = await tx.orderItem.count({
        where: {
          order: {
            userId: params.userId,
            concertId: params.concertId,
            OR: [{ status: "PAID" }, { status: "PENDING", expiresAt: { gt: now } }],
          },
        },
      });
      if (
        exceedsTicketLimit({ committed, requested: params.items.length, max: params.maxTicketsPerUser })
      ) {
        throw new ReserveError(
          "LIMIT",
          remainingTicketAllowance({ committed, max: params.maxTicketsPerUser })
        );
      }

      // สร้าง Order + items + payment (PENDING) ใน tx เดียวกับที่ถือ lock
      const newOrder = await tx.order.create({
        data: {
          userId: params.userId,
          concertId: params.concertId,
          totalAmount,
          status: "PENDING",
          expiresAt: params.expiresAt,
          items: { create: params.items.map((i) => ({ seatId: i.seatId, price: i.price })) },
          payment: { create: { method: "PROMPTPAY", amount: totalAmount, status: "PENDING" } },
        },
      });

      // mark HELD แบบ conditional (compare-and-set) — ถ้ามีที่นั่งถูก race ไปก่อน count จะไม่ครบ → rollback
      const held = await tx.seat.updateMany({
        where: { id: { in: seatIds }, status: "AVAILABLE" },
        data: { status: "HELD" },
      });
      if (held.count !== seatIds.length) throw new ReserveError("SEAT_TAKEN");

      return newOrder.id;
    });
    return { ok: true, orderId };
  } catch (e) {
    if (e instanceof ReserveError) {
      return e.reason === "LIMIT"
        ? { ok: false, reason: "LIMIT", remaining: e.remaining }
        : { ok: false, reason: "SEAT_TAKEN" };
    }
    return { ok: false, reason: "ERROR" };
  }
}
