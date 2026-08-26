// แปลงค่าจาก <input type="datetime-local"> ("YYYY-MM-DDTHH:mm" หรือ "…:ss") ให้เป็นเวลาไทยเสมอ
//
// เหตุ (user-test 2026-08-26): ฟอร์มสร้างคอนเสิร์ตของแอดมินโพสต์สตริงที่ "ไม่มี timezone" ตรงมาที่ server action
//   → new Date("2026-12-20T19:00") บน Vercel (TZ=UTC) ถูกตีความเป็น 19:00 UTC = 02:00 ของวันถัดไปตามเวลาไทย
//   → วันแสดง/ช่วงเปิดขายเลื่อน +7 ชั่วโมงทั้งหน้าแอดมินและหน้าลูกค้า
//   ฟอร์มรอบกดบัตรไม่โดนเพราะ client แปลงเป็น ISO (toISOString) ก่อนส่ง — helper นี้ทำให้ฝั่ง server ถูกไม่ว่า client จะส่งแบบไหน
//
// กติกา:
//   - มี Z / offset อยู่แล้ว → ใช้ตามนั้น (ไม่ยัด +07 ซ้ำ)
//   - รูปแบบ datetime-local ล้วน → เติม ":00" ถ้าไม่มีวินาที แล้วต่อ "+07:00" (ระบบขายบัตรในไทยเท่านั้น — ไม่อ่าน TZ ของเครื่อง server)
//   - แปลงไม่ได้ / ว่าง → null ให้ผู้เรียกตัดสินใจฟ้อง (ไม่คืน Invalid Date เงียบ ๆ)
const HAS_TZ = /(?:Z|[+-]\d{2}:?\d{2})$/;
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

export const THAI_OFFSET = "+07:00";

export function parseThaiDateTimeLocal(value: string | null | undefined): Date | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  let iso = v;
  if (!HAS_TZ.test(v) && DATETIME_LOCAL.test(v)) {
    iso = `${v}${v.length === 16 ? ":00" : ""}${THAI_OFFSET}`;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
