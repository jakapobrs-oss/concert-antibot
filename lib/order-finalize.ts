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
  items: { seatId: bigint; price: Prisma.Decimal }[];
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

      // 4) ออกตั๋ว 1 ใบ/ที่นั่ง (atomic กับขั้นบน — Ticket.seatId/qrCode unique กันซ้ำซ้อน)
      for (const item of params.items) {
        await tx.ticket.create({
          data: {
            orderId: params.orderId,
            seatId: item.seatId,
            userId: params.userId,
            qrCode: `TKT-${crypto.randomBytes(16).toString("hex")}`,
            price: item.price,
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
