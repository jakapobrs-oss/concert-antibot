// ============================================================
// Slip Image Validation (F7) — จำกัดขนาด + ชนิดของรูปสลิป
// ============================================================
// ปัญหาเดิม: `slipImageBase64` รับ string ยาวเท่าไรก็ได้ ชนิดอะไรก็ได้
//   → อัปโหลดข้อมูลยักษ์กิน RAM/แบนด์วิดท์ก่อนถึง EasySlip (abuse) + ส่ง payload แปลก ๆ ได้
// แก้: จำกัดความยาว base64 + ตรวจว่า "หน้าตาเป็นรูปภาพ" จริง (data URL ของ image หรือ base64 ล้วน)

// ความยาว base64 สูงสุด — base64 พองจาก binary ~33% → ~2.8M chars ≈ รูป ~2MB
export const MAX_SLIP_BASE64_LEN = 2_800_000;

// data URL ของรูปภาพที่ยอมรับ
const DATA_URL_IMAGE = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i;
// เนื้อ base64 ล้วน (อนุญาต padding "=" ท้ายได้ 0-2 ตัว)
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

// "หน้าตาเป็นรูป base64" ไหม — รับทั้งแบบมี data:image/...;base64, นำหน้า และแบบ base64 ล้วน
export function isLikelyBase64Image(input: string): boolean {
  let body = input.trim();

  const m = DATA_URL_IMAGE.exec(body);
  if (m) {
    body = body.slice(m[0].length);
  } else if (body.toLowerCase().startsWith("data:")) {
    // เป็น data URL แต่ไม่ใช่ image (เช่น data:text/html) → ปฏิเสธ
    return false;
  }

  // ตัด whitespace/newline ที่ encoder บางตัวใส่มา ก่อนตรวจ charset
  body = body.replace(/\s/g, "");
  if (body.length === 0) return false;

  return BASE64_BODY.test(body);
}
