"use server";

// ============================================================
// Ticket lifecycle actions (docs/19 Named Ticket)
// ============================================================
//   - getEntryCode: ผู้ถือขอ QR เข้างานรอบปัจจุบัน (dynamic QR หมุนทุก 30 วิ — Phase 3)
//   - checkInTicket: จนท.สแกนหน้างาน 1 บัตรเข้าได้ครั้งเดียว (Phase 2)
//   - returnTicket: ผู้ซื้อคืนบัตรเข้าระบบ ราคาหน้าบัตร ที่นั่งกลับ pool กลาง
//     (จงใจ "ไม่มี" การส่งบัตรถึงคนเจาะจง — กฎเหล็ก docs/19 กัน resale อำพราง)
//   - mark*Refunded: admin กดยืนยันหลังโอนเงินคืนแล้ว
import { z } from "zod";
import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isVerifiedAdmin } from "@/lib/admin-guard";
import { env } from "@/lib/env";
import {
  currentEntryCode,
  verifyEntryCode,
  buildEntryQrText,
  parseEntryQrText,
} from "@/lib/entry-code";

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

export async function getEntryCode(input: { ticketId: string }): Promise<EntryCodeResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบ" };
  const parsed = idSchema.safeParse(input.ticketId);
  if (!parsed.success) return { ok: false, error: "ไม่พบตั๋ว" };

  // ต้องเป็น "ผู้ถือ" ของตั๋วเท่านั้น (Ticket.userId) และตั๋วยังไม่ถูกคืน
  const ticket = await prisma.ticket.findFirst({
    where: { id: BigInt(parsed.data), userId: BigInt(userId), returnedAt: null },
    select: { id: true, qrSecret: true },
  });
  if (!ticket) return { ok: false, error: "ไม่พบตั๋ว" };
  if (!ticket.qrSecret) {
    // ตั๋วยุคก่อน migration ที่ไม่มี secret — ตรวจไม่ได้ = ไม่ออก QR (fail-closed)
    return { ok: false, error: "ตั๋วใบนี้ยังไม่รองรับ QR แบบหมุน กรุณาติดต่อทีมงาน" };
  }

  const { code, msLeft } = currentEntryCode(ticket.qrSecret);
  const qrText = buildEntryQrText(ticket.id.toString(), code);
  const qrDataUrl = await QRCode.toDataURL(qrText, { width: 200, margin: 1 });
  return { ok: true, qrDataUrl, code, msLeft };
}

// ---- 2. Check-in หน้างาน (Phase 2): 1 บัตรเข้าได้ครั้งเดียว ----
export type CheckInResult =
  | {
      ok: true;
      holderName: string;
      concertTitle: string;
      zoneName: string;
      seat: string;
      checkedInAt: string;
    }
  | { ok: false; error: string };

export async function checkInTicket(input: { qrText: string }): Promise<CheckInResult> {
  if (!(await isAdmin())) return { ok: false, error: "ต้องเป็นเจ้าหน้าที่เท่านั้น" };

  const parsed = parseEntryQrText(input.qrText ?? "");
  if (!parsed) return { ok: false, error: "รูปแบบ QR ไม่ถูกต้อง — ใช้ QR จากหน้าตั๋วของระบบเท่านั้น" };

  const ticket = await prisma.ticket.findUnique({
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
          zone: { select: { name: true, concert: { select: { title: true } } } },
        },
      },
    },
  });
  if (!ticket) return { ok: false, error: "ไม่พบตั๋วใบนี้ในระบบ" };
  if (ticket.returnedAt) return { ok: false, error: "ตั๋วใบนี้ถูกคืนเข้าระบบแล้ว — ใช้เข้างานไม่ได้" };

  // ตรวจ code แบบหมุน (±1 window) — ภาพแคป QR เก่าจะใช้ไม่ได้ภายใน ~1 นาที
  if (!verifyEntryCode(ticket.qrSecret, parsed.code)) {
    return {
      ok: false,
      error: "รหัส QR หมดอายุหรือไม่ถูกต้อง — ให้ผู้ถือเปิดหน้า 'ตั๋วของฉัน' ล่าสุดแล้วสแกนใหม่",
    };
  }

  if (ticket.checkedInAt) {
    return {
      ok: false,
      error: `ตั๋วใบนี้เช็คอินไปแล้วเมื่อ ${ticket.checkedInAt.toLocaleString("th-TH")} (ผู้ถือ: ${ticket.holderName || "-"}) — ห้ามให้เข้าซ้ำ`,
    };
  }

  // claim แบบ conditional กันสแกนซ้ำพร้อมกันสองเครื่อง — ชนะได้เครื่องเดียว
  const now = new Date();
  const claimed = await prisma.ticket.updateMany({
    where: { id: ticket.id, checkedInAt: null, returnedAt: null },
    data: { checkedInAt: now },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "ตั๋วใบนี้เพิ่งถูกเช็คอินจากอีกจุดสแกน — ห้ามให้เข้าซ้ำ" };
  }

  return {
    ok: true,
    holderName: ticket.holderName || "(ไม่มีชื่อบนตั๋ว)",
    concertTitle: ticket.seat.zone.concert.title,
    zoneName: ticket.seat.zone.name,
    seat: `${ticket.seat.rowLabel}${ticket.seat.seatNumber}`,
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
          zone: { select: { name: true, concert: { select: { eventAt: true } } } },
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

  const seatLabel = `${ticket.seat.zone.name} ${ticket.seat.rowLabel}${ticket.seat.seatNumber}`;
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
