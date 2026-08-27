// สถานะที่ "ควรแสดง" ของคอนเสิร์ต — pure function ใช้ร่วมกันทั้งการ์ด/หน้ารายละเอียด/หน้าคิว/หน้าแอดมิน
//
// เหตุ (user-test 2026-08-26 #40): คอนเสิร์ต "A" ใน DB มี status ON_SALE แต่ไม่มีโซน (ราคา = Infinity → "฿∞")
//   และช่วงขายจบไปแล้ว → การ์ดยังขึ้น "กำลังขาย" กดเข้าคิวได้แล้วเจอ "บัตรหมดแล้ว"
// Concert.status ใน DB เป็นสิ่งที่แอดมินตั้ง (ON_SALE/SCHEDULED/SOLD_OUT/…) แต่หน้าเว็บต้องเทียบกับความจริง:
//   ไม่มีโซน = ยังไม่พร้อมขาย · เลยช่วงขาย = ปิดการขาย · ยังไม่ถึงช่วงขาย = เร็ว ๆ นี้
// เพิ่ม 2026-08-27: วันงาน (eventAt) ผ่านไปแล้ว = ปิดการขาย เสมอ — ฟอร์มยอมให้ปิดขายหลังวันงานได้
//   (คอนเสิร์ตที่งานจบตอน 10:00 แต่ saleEndAt วันถัดไป เคยขึ้น "กำลังขาย" ทั้งวัน)
import { formatThaiDate } from "@/lib/format";

export type DisplayStatus =
  | "ON_SALE" // ขายอยู่จริง (มีโซน + อยู่ในช่วงขาย)
  | "SCHEDULED" // ยังไม่ถึงช่วงขาย
  | "SOLD_OUT" // บัตรหมด (ประกาศอัตโนมัติ lib/sold-out.ts)
  | "ENDED" // เลยช่วงขาย/จบงาน หรือแอดมินปิด
  | "NOT_READY"; // ตั้ง ON_SALE แต่ยังไม่มีโซน/ราคา

export interface DisplayStatusInput {
  status: string;
  saleStartAt: Date;
  saleEndAt: Date;
  zoneCount: number;
  eventAt?: Date; // ไม่ส่ง = ไม่เช็ควันงาน (เข้ากันได้กับผู้เรียกเดิม)
  now?: Date;
}

export function deriveDisplayStatus(input: DisplayStatusInput): DisplayStatus {
  const now = input.now ?? new Date();
  // วันงานผ่านไปแล้ว → จบ ไม่ว่า DB จะตั้งอะไรไว้ (กัน "กำลังขาย"/"เร็ว ๆ นี้"/"บัตรหมด" ค้างหลังงานจบ)
  if (input.eventAt && input.eventAt.getTime() <= now.getTime()) return "ENDED";
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

// สถานะที่ DB เก็บได้ซึ่ง "ผู้ชมมองเห็นคอนเสิร์ตนี้ในหน้ารายการ" (DRAFT/ENDED ไม่ถูก list อยู่แล้ว)
const PUBLICLY_LISTED_STATUSES = new Set(["ON_SALE", "SCHEDULED", "SOLD_OUT"]);

// คำอธิบายสำหรับ "หน้าแอดมิน": ป้ายที่แอดมินตั้ง (เช่น กำลังขาย) กับสิ่งที่ผู้ชมเห็นจริงต่างกันไหม
//   คืน null เมื่อตรงกัน หรือคอนเสิร์ตยังไม่เผยแพร่ — เหตุ 2026-08-27: แอดมินเห็น "กำลังขาย" แต่ผู้ชมกดเข้าไม่ได้
export function publicStatusHint(input: DisplayStatusInput): string | null {
  if (!PUBLICLY_LISTED_STATUSES.has(input.status)) return null;
  const display = deriveDisplayStatus(input);
  if (display === input.status) return null;
  const reason: Record<DisplayStatus, string> = {
    ON_SALE: "",
    SCHEDULED: ` — เปิดขาย ${formatThaiDate(input.saleStartAt)}`,
    SOLD_OUT: "",
    ENDED:
      input.eventAt && input.eventAt.getTime() <= (input.now ?? new Date()).getTime()
        ? " — วันงานผ่านไปแล้ว"
        : " — เลยช่วงขายแล้ว",
    NOT_READY: " — ยังไม่มีโซน/ราคา",
  };
  return `ผู้ชมเห็นเป็น "${DISPLAY_STATUS_LABEL[display]}"${reason[display]}`;
}
