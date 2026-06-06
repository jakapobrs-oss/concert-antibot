// ============================================================
// Payer Key — คีย์ระบุ "ผู้จ่ายเงิน" สำหรับ per-payer ticket cap (กัน account farming)
// ============================================================
// แนวคิด (จาก threat model ขบวนการบอท):
//   บอทปั๊ม "app account" ได้ฟรี แต่ "บัญชีธนาคารจริง" ปั๊มไม่ไหว (ต้อง KYC + มีต้นทุน)
//   → จำกัดจำนวนตั๋วต่อ "ผู้จ่าย" (เลขบัญชี/ชื่อจากสลิป) ข้ามทุก account
//   บังคับที่ชั้น payment ซึ่งเป็นชั้นเดียวที่บอทปลอมไม่ได้ (ต้องโอนเงินจริงเข้าบัญชีถูกต้อง + สลิป unique)
// ข้อจำกัด (เขียนใน thesis): ขบวนการที่มี "หลายบัญชีธนาคารจริง" ยังเลี่ยงได้ แต่ต้นทุนสูงขึ้นมาก;
//   EasySlip คืนเลขบัญชีแบบ masked → ใช้เลขที่เห็นเป็นคีย์ (ชนกันได้น้อย แต่ไม่ 100%)
import { digitsOnly } from "@/lib/slip-match";

// สร้างคีย์ผู้จ่ายที่ normalize แล้วจากข้อมูลในสลิป
//   - มีเลขบัญชี (>=4 หลักหลัง unmask) → "acct:<digits>"  (เสถียรสุด)
//   - ไม่มีเลข แต่มีชื่อ          → "name:<ชื่อ lower+trim>" (อ่อนกว่า แต่ดีกว่าปล่อยผ่าน)
//   - ไม่มีทั้งคู่               → null (บังคับ cap ไม่ได้ → caller ข้าม ไม่ block ผิดคน)
export function computePayerKey(params: {
  senderAccount?: string | null;
  senderName?: string | null;
}): string | null {
  const digits = digitsOnly(params.senderAccount ?? "");
  if (digits.length >= 4) return `acct:${digits}`;

  const name = (params.senderName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (name.length > 0) return `name:${name}`;

  return null;
}

// เกินลิมิตต่อผู้จ่ายมั้ย — pure function แยกออกมาเพื่อทดสอบง่าย
export function exceedsPayerLimit(params: {
  priorPaid: number; // ตั๋วที่ผู้จ่ายรายนี้ได้ไปแล้ว (เฉพาะคอนเสิร์ตนี้)
  requested: number; // จำนวนที่กำลังจะออกเพิ่มในออเดอร์นี้
  limit: number; // เพดานต่อผู้จ่ายต่อคอนเสิร์ต
}): boolean {
  return params.priorPaid + params.requested > params.limit;
}
