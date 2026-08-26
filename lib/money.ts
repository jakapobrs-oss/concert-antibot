// ============================================================
// เงินเป็นจำนวนเต็ม "สตางค์" — กัน floating-point drift ตอนเทียบยอด (SECURITY_TODO #4)
// ============================================================
// ทำไม: ยอดจากสลิป (EasySlip → number) กับยอดของ order (Prisma Decimal → string) ถ้าเทียบเป็น float
//   1500.0000000001 !== 1500 ทั้งที่เป็นยอดเดียวกัน (หรือกลับกัน 19.99 * 100 = 1998.9999999999998)
//   → แปลงทั้งสองฝั่งเป็นจำนวนเต็มสตางค์ (ปัดที่ทศนิยม 2 ตำแหน่ง = หน่วยเล็กสุดของบาท) ก่อนเทียบ
// ไฟล์นี้ pure — ไม่ import อะไร เทสตรง ๆ ได้
const SATANG_PER_BAHT = 100;

// รูปแบบ string ที่ยอมรับ: ทศนิยมล้วน "1500" / "1500.00" / "-1.5" เท่านั้น
//   ห้ามพึ่ง Number() ตรง ๆ เพราะ Number("") = 0 และ Number("0x10") = 16 → สลิปที่อ่านยอดไม่ได้จะกลายเป็น "0 บาท"
const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

// บาท (number หรือ string จาก Decimal.toString()) → สตางค์จำนวนเต็ม
//   ค่าที่อ่านเป็นตัวเลขไม่ได้ / ว่าง / Infinity → NaN (NaN เทียบไม่เท่าใครเลย = fail-closed โดยธรรมชาติ)
export function toSatang(baht: number | string): number {
  let value: number;
  if (typeof baht === "number") {
    value = baht;
  } else {
    const text = String(baht).trim();
    if (!DECIMAL_STRING.test(text)) return NaN;
    value = Number(text);
  }
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * SATANG_PER_BAHT);
}

// ยอดสองฝั่ง "เท่ากันที่ระดับสตางค์" ไหม — ฝั่งใดขาด/อ่านไม่ได้ = ไม่เท่า (ห้ามเดาว่าตรง)
export function sameAmount(
  a: number | string | null | undefined,
  b: number | string | null | undefined
): boolean {
  if (a == null || b == null) return false;
  const satangA = toSatang(a);
  const satangB = toSatang(b);
  return Number.isFinite(satangA) && Number.isFinite(satangB) && satangA === satangB;
}
