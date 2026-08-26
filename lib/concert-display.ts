// สถานะที่ "ควรแสดง" ของคอนเสิร์ต — pure function ใช้ร่วมกันทั้งการ์ด/หน้ารายละเอียด/หน้าคิว
//
// เหตุ (user-test 2026-08-26 #40): คอนเสิร์ต "A" ใน DB มี status ON_SALE แต่ไม่มีโซน (ราคา = Infinity → "฿∞")
//   และช่วงขายจบไปแล้ว → การ์ดยังขึ้น "กำลังขาย" กดเข้าคิวได้แล้วเจอ "บัตรหมดแล้ว"
// Concert.status ใน DB เป็นสิ่งที่แอดมินตั้ง (ON_SALE/SCHEDULED/SOLD_OUT/…) แต่หน้าเว็บต้องเทียบกับความจริง:
//   ไม่มีโซน = ยังไม่พร้อมขาย · เลยช่วงขาย = ปิดการขาย · ยังไม่ถึงช่วงขาย = เร็ว ๆ นี้

export type DisplayStatus =
  | "ON_SALE" // ขายอยู่จริง (มีโซน + อยู่ในช่วงขาย)
  | "SCHEDULED" // ยังไม่ถึงช่วงขาย
  | "SOLD_OUT" // บัตรหมด (ประกาศอัตโนมัติ lib/sold-out.ts)
  | "ENDED" // เลยช่วงขาย/จบงาน หรือแอดมินปิด
  | "NOT_READY"; // ตั้ง ON_SALE แต่ยังไม่มีโซน/ราคา

export function deriveDisplayStatus(input: {
  status: string;
  saleStartAt: Date;
  saleEndAt: Date;
  zoneCount: number;
  now?: Date;
}): DisplayStatus {
  const now = input.now ?? new Date();
  if (input.status === "SOLD_OUT") return "SOLD_OUT";
  if (input.status === "SCHEDULED") return "SCHEDULED";
  if (input.status !== "ON_SALE") return "ENDED"; // CANCELLED/ENDED/DRAFT ฯลฯ
  if (input.zoneCount === 0) return "NOT_READY";
  if (input.saleEndAt.getTime() <= now.getTime()) return "ENDED";
  if (input.saleStartAt.getTime() > now.getTime()) return "SCHEDULED";
  return "ON_SALE";
}

// ราคาเริ่มต้นจากโซน — null เมื่อยังไม่มีโซน (เดิม Math.min(...[]) = Infinity → โชว์ "฿∞")
export function minZonePrice(zones: { price: { toString(): string } }[]): number | null {
  if (zones.length === 0) return null;
  return Math.min(...zones.map((z) => Number(z.price.toString())));
}

// ป้ายภาษาไทยของแต่ละสถานะ (ใช้ทั้งการ์ดและหน้ารายละเอียด)
export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  ON_SALE: "กำลังขาย",
  SCHEDULED: "เร็ว ๆ นี้",
  SOLD_OUT: "บัตรหมดแล้ว",
  ENDED: "ปิดการขาย",
  NOT_READY: "ยังไม่พร้อมขาย",
};
