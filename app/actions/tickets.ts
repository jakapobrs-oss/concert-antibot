"use server";

// ============================================================
// Ticket lifecycle actions (docs/19 Named Ticket)
// ============================================================
//   - getEntryCode: ผู้ถือขอ QR เข้างานรอบปัจจุบัน (dynamic QR หมุนทุก 30 วิ — Phase 3)
//   - getEntryCodes: ขอภาพ QR ล่วงหน้าเป็นชุด ≈ 5 นาที ทนเน็ตหาย (rev 42)
//   - checkInTicket: จนท.สแกนหน้างาน 1 บัตรเข้าได้ครั้งเดียว (Phase 2) — role STAFF/ADMIN + บันทึกคนสแกน (rev 42)
//   - returnTicket: ผู้ซื้อคืนบัตรเข้าระบบ ราคาหน้าบัตร ที่นั่งกลับ pool กลาง
//     (จงใจ "ไม่มี" การส่งบัตรถึงคนเจาะจง — กฎเหล็ก docs/19 กัน resale อำพราง)
//   - mark*Refunded: admin กดยืนยันหลังโอนเงินคืนแล้ว
import { z } from "zod";
import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isVerifiedAdmin, assertVerifiedStaff } from "@/lib/admin-guard";
import { env } from "@/lib/env";
import {
  ENTRY_CODE_WINDOW_MS,
  currentEntryCode,
  entryCodeBatch,
  verifyEntryCode,
  buildEntryQrText,
  parseEntryQrText,
} from "@/lib/entry-code";
import { formatSeatLabel } from "@/lib/seatmap/seat-rows";
import { checkRateLimit } from "@/lib/rate-limit";
import { decideCheckInScope, type CheckInScopeDecision } from "@/lib/checkin-policy";

async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

// เช็คสิทธิ์ admin — F2 (Codex §4 #2): re-check role กับ DB จริง (ไม่เชื่อ JWT ค้าง)
async function isAdmin(): Promise<boolean> {
  return isVerifiedAdmin();
}

const idSchema = z.string().regex(/^\d+$/, "id ไม่ถูกต้อง");

// ---- 1. Dynamic QR (Phase 3): ผู้ถือขอ code รอบปัจจุบัน ----
// client poll ทุก ~รอบหมุน — server คืน "ภาพ QR + เวลาที่เหลือ" เท่านั้น ไม่มีทางเห็น qrSecret
export type EntryCodeResult =
  | { ok: true; qrDataUrl: string; code: string; msLeft: number }
  | { ok: false; error: string };

// หา secret ของตั๋วที่ผู้เรียกเป็น "ผู้ถือ" (Ticket.userId) และยังไม่ถูกคืน — ใช้ร่วมกันทั้งขอทีละรอบ/ขอเป็นชุด
async function ownedTicketSecret(
  ticketId: string,
): Promise<{ ok: true; id: string; qrSecret: string } | { ok: false; error: string }> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบ" };
  const parsed = idSchema.safeParse(ticketId);
  if (!parsed.success) return { ok: false, error: "ไม่พบตั๋ว" };

  const ticket = await prisma.ticket.findFirst({
    where: { id: BigInt(parsed.data), userId: BigInt(userId), returnedAt: null },
    select: { id: true, qrSecret: true },
  });
  if (!ticket) return { ok: false, error: "ไม่พบตั๋ว" };
  if (!ticket.qrSecret) {
    // ตั๋วยุคก่อน migration ที่ไม่มี secret — ตรวจไม่ได้ = ไม่ออก QR (fail-closed)
    return { ok: false, error: "ตั๋วใบนี้ยังไม่รองรับ QR แบบหมุน กรุณาติดต่อทีมงาน" };
  }
  return { ok: true, id: ticket.id.toString(), qrSecret: ticket.qrSecret };
}

export async function getEntryCode(input: { ticketId: string }): Promise<EntryCodeResult> {
  const ticket = await ownedTicketSecret(input.ticketId);
  if (!ticket.ok) return ticket;

  const { code, msLeft } = currentEntryCode(ticket.qrSecret);
  const qrText = buildEntryQrText(ticket.id, code);
  const qrDataUrl = await QRCode.toDataURL(qrText, { width: 200, margin: 1 });
  return { ok: true, qrDataUrl, code, msLeft };
}

// ---- 1b. ขอภาพ QR ล่วงหน้าเป็นชุด (rev 42) — ENTRY_PREFETCH_WINDOWS ช่วง ≈ 5 นาที ----
// ทำไม: เน็ตหน้างานหาย/จอล็อก แล้ว QR ตายใน 1 นาที (docs/19 §Phase 3) — client หมุนภาพเองตามเวลา
// client ยังได้แค่ "ภาพ" ของแต่ละช่วง ไม่ได้ secret · ภาพเดียวยังมีแค่ code ของช่วงนั้น (แคปหน้าจอตายใน ≤60 วิ เท่าเดิม)
export type EntryCodeBatchResult =
  | { ok: true; windowMs: number; msLeft: number; frames: string[] }
  | { ok: false; error: string };

export async function getEntryCodes(input: { ticketId: string }): Promise<EntryCodeBatchResult> {
  // rate-limit ต่อผู้ใช้ (audit rev 42): 1 ครั้ง = วาด QR 10 ภาพ — หน้าตั๋วปกติขอทุก ~3.5 นาที/ใบ, 30/นาที เผื่อหลายใบ+รีเฟรช
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบ" };
  const rl = await checkRateLimit({ key: `entry_codes:user:${userId}`, limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return { ok: false, error: "ขอ QR ถี่เกินไป — รอสักครู่แล้วรีเฟรชหน้า" };

  const ticket = await ownedTicketSecret(input.ticketId);
  if (!ticket.ok) return ticket;

  const { msLeft, codes } = entryCodeBatch(ticket.qrSecret);
  const frames = await Promise.all(
    codes.map((code) => QRCode.toDataURL(buildEntryQrText(ticket.id, code), { width: 200, margin: 1 })),
  );
  return { ok: true, windowMs: ENTRY_CODE_WINDOW_MS, msLeft, frames };
}

// ---- 2. Check-in หน้างาน (Phase 2): 1 บัตรเข้าได้ครั้งเดียว ----
// kind ให้ UI แยกสี/การสั่น: ผิดงาน-ผิดเวลา (เหลือง: ตั๋วยังไม่ถูกใช้ ให้ไปประตูที่ถูก) vs ปฏิเสธจริง (แดง)
export type CheckInFailKind =
  | "auth"
  | "format"
  | "rate"
  | "not_found"
  | "returned"
  | "expired"
  | "used"
  | Extract<CheckInScopeDecision, { ok: false }>["kind"];

export type CheckInResult =
  | {
      ok: true;
      holderName: string;
      concertTitle: string;
      zoneName: string;
      seat: string;
      checkedInAt: string;
    }
  | { ok: false; error: string; kind: CheckInFailKind };

export async function checkInTicket(input: { qrText: string; concertId: string }): Promise<CheckInResult> {
  // rev 42: STAFF หรือ ADMIN (เช็ค role กับ DB จริง) — เก็บ id ไว้บันทึกว่าใครเป็นคนสแกน
  let staffId: bigint;
  try {
    const session = await assertVerifiedStaff();
    staffId = BigInt((session.user as { id?: string }).id as string);
  } catch {
    return { ok: false, error: "ต้องเป็นเจ้าหน้าที่เท่านั้น", kind: "auth" };
  }

  // จุดสแกนต้องระบุงาน (audit rev 42 High): ตั๋วของงานอื่น/นอกกรอบเวลา ห้ามผ่านประตูนี้
  const gate = idSchema.safeParse(input.concertId ?? "");
  if (!gate.success) return { ok: false, error: "ต้องเลือกคอนเสิร์ตของจุดสแกนก่อน", kind: "format" };

  // กันยิงรัว/สคริปต์เดา code: จุดสแกนคนจริง ~1–2 ใบ/วิ — 300/นาที/เจ้าหน้าที่ พอสำหรับประตูคนแน่น
  const rl = await checkRateLimit({ key: `checkin:user:${staffId}`, limit: 300, windowMs: 60_000 });
  if (!rl.allowed) return { ok: false, error: "สแกนถี่เกินไป — รอสักครู่แล้วสแกนใหม่", kind: "rate" };

  const parsed = parseEntryQrText(input.qrText ?? "");
  if (!parsed) {
    return { ok: false, error: "รูปแบบ QR ไม่ถูกต้อง — ใช้ QR จากหน้าตั๋วของระบบเท่านั้น", kind: "format" };
  }

  const [ticket, gateConcert] = await Promise.all([
    prisma.ticket.findUnique({
      where: { id: BigInt(parsed.ticketId) },
      select: {
        id: true,
        qrSecret: true,
        holderName: true,
        checkedInAt: true,
        returnedAt: true,
        seat: {
          select: {
            rowLabel: true,
            seatNumber: true,
            zone: {
              select: {
                name: true,
                isStanding: true,
                concert: { select: { id: true, title: true, eventAt: true } },
              },
            },
          },
        },
      },
    }),
    prisma.concert.findUnique({
      where: { id: BigInt(gate.data) },
      select: { id: true, title: true, eventAt: true },
    }),
  ]);
  if (!gateConcert) return { ok: false, error: "ไม่พบคอนเสิร์ตของจุดสแกน — เลือกงานใหม่", kind: "format" };
  if (!ticket) return { ok: false, error: "ไม่พบตั๋วใบนี้ในระบบ", kind: "not_found" };
  if (ticket.returnedAt) {
    return { ok: false, error: "ตั๋วใบนี้ถูกคืนเข้าระบบแล้ว — ใช้เข้างานไม่ได้", kind: "returned" };
  }

  // ตรวจ code แบบหมุน (±1 window) — ภาพแคป QR เก่าจะใช้ไม่ได้ภายใน ~1 นาที
  if (!verifyEntryCode(ticket.qrSecret, parsed.code)) {
    return {
      ok: false,
      error: "รหัส QR หมดอายุหรือไม่ถูกต้อง — ให้ผู้ถือเปิดหน้า 'ตั๋วของฉัน' ล่าสุดแล้วสแกนใหม่",
      kind: "expired",
    };
  }

  // ขอบเขตงาน + กรอบเวลา — ต้องตัดสิน "ก่อน" claim: สแกนผิดประตูต้องไม่เผาตั๋ว (lib/checkin-policy.ts)
  const scope = decideCheckInScope({
    ticketConcertId: ticket.seat.zone.concert.id.toString(),
    ticketConcertTitle: ticket.seat.zone.concert.title,
    gateConcertId: gateConcert.id.toString(),
    gateConcertTitle: gateConcert.title,
    eventAt: gateConcert.eventAt,
    now: new Date(),
    openBeforeMs: env.CHECKIN_OPEN_BEFORE_HOURS * 60 * 60 * 1000,
    closeAfterMs: env.CHECKIN_CLOSE_AFTER_HOURS * 60 * 60 * 1000,
  });
  if (!scope.ok) return { ok: false, error: scope.error, kind: scope.kind };

  if (ticket.checkedInAt) {
    return {
      ok: false,
      error: `ตั๋วใบนี้เช็คอินไปแล้วเมื่อ ${ticket.checkedInAt.toLocaleString("th-TH")} (ผู้ถือ: ${ticket.holderName || "-"}) — ห้ามให้เข้าซ้ำ`,
      kind: "used",
    };
  }

  // claim แบบ conditional กันสแกนซ้ำพร้อมกันสองเครื่อง — ชนะได้เครื่องเดียว · ผูก concertId ซ้ำใน where (belt-and-braces)
  const now = new Date();
  const claimed = await prisma.ticket.updateMany({
    where: { id: ticket.id, checkedInAt: null, returnedAt: null, seat: { zone: { concertId: gateConcert.id } } },
    data: { checkedInAt: now, checkedInById: staffId },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "ตั๋วใบนี้เพิ่งถูกเช็คอินจากอีกจุดสแกน — ห้ามให้เข้าซ้ำ", kind: "used" };
  }

  return {
    ok: true,
    holderName: ticket.holderName || "(ไม่มีชื่อบนตั๋ว)",
    concertTitle: ticket.seat.zone.concert.title,
    zoneName: ticket.seat.zone.name,
    seat: formatSeatLabel({
      zoneName: ticket.seat.zone.name,
      isStanding: ticket.seat.zone.isStanding,
      rowLabel: ticket.seat.rowLabel,
      seatNumber: ticket.seat.seatNumber,
    }),
    checkedInAt: now.toISOString(),
  };
}

// ---- 3. คืนบัตรเข้าระบบ (ตามที่ user เลือก: มีช่องคืนบัตร) ----
// ทำไมไม่ผิดกฎเหล็ก: ผู้คืน "เลือกผู้รับไม่ได้" — ที่นั่งกลับเข้า pool กลาง ใครจะได้ต้องผ่าน
// คิว + anti-bot + ผูกชื่อตอนซื้อ ตามปกติ และเงินคืนแค่ราคาหน้าบัตร → scalper ไม่มีกำไรจากช่องนี้
export type ReturnTicketResult = { ok: true } | { ok: false; error: string };

export async function returnTicket(input: { ticketId: string }): Promise<ReturnTicketResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบ" };
  const parsed = idSchema.safeParse(input.ticketId);
  if (!parsed.success) return { ok: false, error: "ไม่พบตั๋ว" };

  const ticket = await prisma.ticket.findUnique({
    where: { id: BigInt(parsed.data) },
    select: {
      id: true,
      orderId: true,
      seatId: true,
      userId: true,
      price: true,
      checkedInAt: true,
      returnedAt: true,
      order: { select: { userId: true, status: true } },
      seat: {
        select: {
          rowLabel: true,
          seatNumber: true,
          zone: {
            select: { name: true, isStanding: true, concert: { select: { eventAt: true } } },
          },
        },
      },
    },
  });
  if (!ticket) return { ok: false, error: "ไม่พบตั๋ว" };
  // สิทธิ์คืนเป็นของ "ผู้ซื้อ" (เงินคืนไปหาเขา) — ผู้ถือที่ได้รับบัตรฟรีไม่มีสิทธิ์ทำลายเงินคนซื้อ
  if (ticket.order.userId !== BigInt(userId)) return { ok: false, error: "ไม่พบตั๋ว" };
  if (ticket.order.status !== "PAID") return { ok: false, error: "คำสั่งซื้อนี้ยังไม่อยู่ในสถานะคืนได้" };
  if (ticket.returnedAt) return { ok: false, error: "ตั๋วใบนี้คืนไปแล้ว" };
  if (ticket.checkedInAt) return { ok: false, error: "ตั๋วที่เช็คอินเข้างานแล้ว คืนไม่ได้" };

  // เส้นตายคืนบัตร — ให้ระบบมีเวลาปล่อยที่นั่งขายรอบใหม่
  const cutoffMs =
    ticket.seat.zone.concert.eventAt.getTime() - env.RETURN_CUTOFF_HOURS * 60 * 60 * 1000;
  if (Date.now() >= cutoffMs) {
    return {
      ok: false,
      error: `เลยเวลาคืนบัตรแล้ว (คืนได้ถึง ${env.RETURN_CUTOFF_HOURS} ชั่วโมงก่อนเริ่มงาน)`,
    };
  }

  const seatLabel = formatSeatLabel({
    zoneName: ticket.seat.zone.name,
    isStanding: ticket.seat.zone.isStanding,
    rowLabel: ticket.seat.rowLabel,
    seatNumber: ticket.seat.seatNumber,
  });
  try {
    await prisma.$transaction(async (tx) => {
      // claim ตั๋วแบบ conditional — กันคืนซ้ำ/ชนกับ check-in ที่กำลังเกิดพร้อมกัน
      const claimed = await tx.ticket.updateMany({
        where: { id: ticket.id, returnedAt: null, checkedInAt: null },
        data: { returnedAt: new Date() },
      });
      if (claimed.count === 0) throw new Error("NOT_RETURNABLE");

      // OrderItem.seatId เป็น unique ระดับ global — ต้องลบเพื่อให้ที่นั่งถูกจองรอบใหม่ได้
      // (บทเรียนเดียวกับ order-sweeper; มูลค่าการซื้อเดิมยังตามได้จาก Ticket + TicketReturn)
      await tx.orderItem.deleteMany({ where: { orderId: ticket.orderId, seatId: ticket.seatId } });

      // คืนที่นั่งเข้า pool เฉพาะถ้ายัง SOLD (สถานะอื่นแปลว่ามีอย่างอื่นแทรก — ไม่ทับ)
      await tx.seat.updateMany({
        where: { id: ticket.seatId, status: "SOLD" },
        data: { status: "AVAILABLE" },
      });

      // ใบขอคืนเงิน — admin เห็นในหน้า refunds แล้วโอนคืน "ราคาหน้าบัตร" ให้ผู้ซื้อ
      await tx.ticketReturn.create({
        data: {
          ticketId: ticket.id,
          orderId: ticket.orderId,
          payerUserId: ticket.order.userId,
          holderUserId: ticket.userId,
          amount: ticket.price,
          seatLabel,
        },
      });
    });
  } catch {
    return { ok: false, error: "คืนบัตรไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/account/tickets");
  return { ok: true };
}

// ---- 4. Admin: ปิดงานคืนเงิน (กดหลังโอนเงินคืนแล้วจริง) ----
export async function markTicketReturnRefunded(input: { returnId: string }): Promise<{ ok: boolean }> {
  if (!(await isAdmin())) return { ok: false };
  const parsed = idSchema.safeParse(input.returnId);
  if (!parsed.success) return { ok: false };
  const updated = await prisma.ticketReturn.updateMany({
    where: { id: BigInt(parsed.data), status: "PENDING" },
    data: { status: "REFUNDED", refundedAt: new Date() },
  });
  revalidatePath("/admin/refunds");
  return { ok: updated.count > 0 };
}

export async function markPaymentRefunded(input: { paymentId: string }): Promise<{ ok: boolean }> {
  if (!(await isAdmin())) return { ok: false };
  const parsed = idSchema.safeParse(input.paymentId);
  if (!parsed.success) return { ok: false };
  const updated = await prisma.payment.updateMany({
    where: { id: BigInt(parsed.data), status: "REFUND_REQUIRED" },
    data: { status: "REFUNDED" },
  });
  revalidatePath("/admin/refunds");
  return { ok: updated.count > 0 };
}
