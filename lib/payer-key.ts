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

// ทำข้อความให้เทียบกันได้: ตัดช่องว่างหัวท้าย + lower-case + ยุบช่องว่างซ้อนให้เหลือ 1
function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// สร้างคีย์ผู้จ่ายที่ normalize แล้วจากข้อมูลในสลิป
//   - มีเลขบัญชี (>=4 หลักหลัง unmask) → "acct:<digits>"        (เสถียรสุด)
//   - ไม่มีเลข แต่มีชื่อ + ธนาคาร      → "name:<ธนาคาร>:<ชื่อ>"  (SECURITY_TODO #3)
//   - ไม่มีเลข มีแต่ชื่อ               → "name:<ชื่อ>"            (อ่อนสุด แต่ดีกว่าปล่อยผ่าน)
//   - ไม่มีทั้งเลขและชื่อ              → null (บังคับ cap ไม่ได้ → caller ข้าม ไม่ block ผิดคน)
//
// ทำไม fallback ชื่อถึง "เติมธนาคารต้นทาง" แทนที่จะเลิกใช้ชื่อ (SECURITY_TODO #3):
//   ชื่ออย่างเดียวชนกันได้ (คนชื่อ-นามสกุลซ้ำ) → ผู้ซื้อจริงคนที่สองโดน cap ผิดคน (ต้องคืนเงิน)
//   ทางเลือกอื่นที่ไม่เอา:
//     - ใช้ transRef → unique ต่อธุรกรรม = ทุกสลิปเป็น "ผู้จ่ายใหม่" cap ไม่นับสะสม = ไม่มี cap
//     - สลิปไม่มีเลขบัญชี = ข้าม cap → ขบวนการบอท "เลือก" ช่องทางจ่ายที่สลิปไม่โชว์เลขบัญชี
//       แล้วหลุด cap ได้ทั้งขบวน (บอทเลือกได้ แต่เราแก้ทีหลังไม่ได้)
//   → เข้มไว้ก่อน: ชนกันแล้วอย่างมากคืนเงิน (กู้คืนได้ + มี REFUND_REQUIRED ใน DB)
//     แต่ปล่อยหลุด cap แล้วบัตรถึงมือ scalper กู้คืนไม่ได้
//   ชื่อเดียวกัน + ธนาคารเดียวกัน ยังชนได้ (ยอมรับ — โอกาสน้อยมากเพราะต้องเป็นสลิปที่ไม่มีเลขบัญชีเลยด้วย)
export function computePayerKey(params: {
  senderAccount?: string | null;
  senderName?: string | null;
  // รหัส/ชื่อย่อธนาคารต้นทางจากสลิป (EasySlip sender.bank เช่น "004" / "KBANK") — ใช้เสริมเฉพาะ fallback ชื่อ
  senderBank?: string | null;
}): string | null {
  const digits = digitsOnly(params.senderAccount ?? "");
  if (digits.length >= 4) return `acct:${digits}`;

  const name = normalizeText(params.senderName);
  if (name.length === 0) return null;

  const bank = normalizeText(params.senderBank);
  return bank ? `name:${bank}:${name}` : `name:${name}`;
}

// เกินลิมิตต่อผู้จ่ายมั้ย — pure function แยกออกมาเพื่อทดสอบง่าย
export function exceedsPayerLimit(params: {
  priorPaid: number; // ตั๋วที่ผู้จ่ายรายนี้ได้ไปแล้ว (เฉพาะคอนเสิร์ตนี้)
  requested: number; // จำนวนที่กำลังจะออกเพิ่มในออเดอร์นี้
  limit: number; // เพดานต่อผู้จ่ายต่อคอนเสิร์ต
}): boolean {
  return params.priorPaid + params.requested > params.limit;
}
