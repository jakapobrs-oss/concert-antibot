// ============================================================
// Slip Date Parser (F6) — แปลงเวลาในสลิปให้ถูก timezone
// ============================================================
// ปัญหาเดิม: easyslip.ts ใช้ `new Date(d.date)` ตรง ๆ
//   ถ้า EasySlip คืน string ที่ "ไม่มี timezone" (เช่น "2026-06-04T10:00:00")
//   JS จะตีความเป็นเวลา "ของ server" — ถ้า server รันเป็น UTC แต่เวลาในสลิปเป็นไทย
//   จะเพี้ยนไป 7 ชั่วโมง → freshness check (Level 2) ตัดสินผิด (รับสลิปเก่า/ปฏิเสธสลิปจริง)
// แก้: ถ้า string ไม่มี TZ ให้ถือเป็นเวลาไทย (+07:00) เพราะ EasySlip/ธนาคารไทยคืนเวลา Asia/Bangkok

// มี timezone ต่อท้ายแล้วหรือยัง — "Z" หรือ "+07:00" / "+0700"
const HAS_TZ = /(?:Z|[+-]\d{2}:?\d{2})$/;
// EasySlip + ธนาคารไทย รายงานเวลาเป็นเขตเวลาไทย
const THAI_OFFSET = "+07:00";

// แปลงเวลาในสลิปเป็น Date ที่ถูกต้อง — คืน undefined ถ้า parse ไม่ได้
export function parseSlipDate(raw?: string | number | null): Date | undefined {
  if (raw === null || raw === undefined) return undefined;

  // ถ้าเป็น epoch ms (ตัวเลข) → ใช้ตรง ๆ ได้เลย (เป็น absolute time อยู่แล้ว)
  if (typeof raw === "number") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  const s = raw.trim();
  if (!s) return undefined;

  // รูปแบบ "YYYY-MM-DD HH:mm:ss" (เว้นวรรค) → ทำให้เป็น ISO ด้วย "T"
  let iso = s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;

  // ไม่มี timezone → เติมเวลาไทย กันเพี้ยนตาม TZ ของ server
  if (!HAS_TZ.test(iso)) iso = `${iso}${THAI_OFFSET}`;

  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
