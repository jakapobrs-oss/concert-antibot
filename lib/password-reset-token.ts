// ส่วน "ฝั่ง server เท่านั้น" ของลืมรหัสผ่าน — แยกจาก lib/password-reset.ts เพราะไฟล์นั้นถูก import จาก client component
//   (ฟอร์มใช้ค่าคงที่/ข้อความ) → ถ้ามี node:crypto อยู่ในไฟล์เดียวกัน webpack ของ next build จะล้ม
//   "Reading from node:crypto is not handled by plugins" (deploy 34dxrztan ล้มด้วยเหตุนี้ — dev/turbopack ไม่ฟ้อง)
import crypto from "node:crypto";

// token 32 ไบต์สุ่ม = hex 64 ตัว (รูปแบบเดียวกับ token ยืนยันอีเมลใน app/actions/auth.ts)
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
