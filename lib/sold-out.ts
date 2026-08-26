// ============================================================
// Sold out — "บัตรหมด" ของคอนเสิร์ต (Phase 2.3, docs/23)
// ============================================================
// พฤติกรรมจริงของผังคอนไทย: ถ้าบัตรหมดตั้งแต่รอบสมาชิก ผู้จัดจะประกาศ SOLD OUT
//   แล้ว "รอบทั่วไปไม่เปิดขาย" ทั้งที่ยังไม่ถึงเวลาตามประกาศ
//   ⇒ ระบบต้องรู้ว่าบัตรหมดเอง ไม่ใช่รอแอดมินมากดเปลี่ยนสถานะ (ซึ่งมักช้ากว่าความจริงหลายชั่วโมง)
//
// นิยามที่ใช้ (สำคัญ — เคยพลาดกันบ่อย):
//   available = ที่นั่ง AVAILABLE (ยังเลือกได้ตอนนี้)
//   held      = ที่นั่ง HELD (มีคนอยู่ในหน้าจ่ายเงิน ยังไม่จบ อีก 5 นาทีอาจหลุดกลับมา)
//   soldOut   = available = 0 **และ** held = 0  → ไม่มีอะไรเหลือให้ลุ้นแล้วจริง ๆ
//
// ทำไมต้องนับ held ด้วย: ถ้าประกาศ SOLD OUT ตอน available = 0 แต่ยังมี held ค้าง
//   พอ hold หมดอายุที่นั่งจะไหลกลับมาเป็น AVAILABLE แต่ป้าย "บัตรหมด" ค้างไปแล้ว = โกหกผู้ใช้
import { prisma } from "@/lib/prisma";
import { isSoldOut } from "@/lib/admit-policy";

export type ConcertAvailability = {
  available: number; // เลือกได้ตอนนี้
  held: number; // ค้างอยู่ในหน้าจ่ายเงินของคนอื่น
  soldOut: boolean; // ไม่เหลืออะไรให้ลุ้นแล้ว
};

// ------------------------------------------------------------
// pure — นิยามจริงย้ายไป lib/admit-policy.ts (ไฟล์ pure ไม่แตะ DB) เพราะ lib/queue.ts ต้องใช้
//   นิยามเดียวกันตัดสิน "คิวไม่มีทางไปต่อ" โดยไม่ลาก prisma เข้าโมดูลคิว — re-export ให้ผู้เรียกเดิมใช้ชื่อเดิม
// ------------------------------------------------------------
export { isSoldOut, isTemporarilyFull } from "@/lib/admit-policy";

// ------------------------------------------------------------
// DB
// ------------------------------------------------------------

export async function getConcertAvailability(
  concertId: string | bigint
): Promise<ConcertAvailability> {
  const id = typeof concertId === "bigint" ? concertId : BigInt(concertId);
  const [available, held] = await Promise.all([
    prisma.seat.count({ where: { status: "AVAILABLE", zone: { concertId: id } } }),
    prisma.seat.count({ where: { status: "HELD", zone: { concertId: id } } }),
  ]);
  return { available, held, soldOut: isSoldOut({ available, held }) };
}

export type SoldOutSyncResult = "MARKED_SOLD_OUT" | "UNCHANGED";

// ประกาศบัตรหมดอัตโนมัติ — เรียกหลังออกตั๋วสำเร็จ (จังหวะเดียวที่ที่นั่งกลายเป็น SOLD จริง)
//   ⚠️ ทิศทางเดียว: ON_SALE → SOLD_OUT เท่านั้น
//      การเปิดขายใหม่ (เช่นมีคนคืนบัตร) เป็นการตัดสินใจของผู้จัด ระบบไม่พลิกกลับให้เอง
//      ไม่งั้นบัตรคืนใบเดียวจะทำให้ป้าย "SOLD OUT" ที่ประกาศไปแล้วกลับมาเปิดขายเองแบบเงียบ ๆ
export async function syncSoldOutStatus(concertId: string | bigint): Promise<SoldOutSyncResult> {
  const id = typeof concertId === "bigint" ? concertId : BigInt(concertId);
  const { soldOut } = await getConcertAvailability(id);
  if (!soldOut) return "UNCHANGED";

  // conditional update — ไม่ทับสถานะที่แอดมินตั้งเอง (DRAFT/ENDED/SCHEDULED)
  const res = await prisma.concert.updateMany({
    where: { id, status: "ON_SALE" },
    data: { status: "SOLD_OUT" },
  });
  return res.count > 0 ? "MARKED_SOLD_OUT" : "UNCHANGED";
}
