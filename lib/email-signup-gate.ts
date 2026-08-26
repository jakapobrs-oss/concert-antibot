// ด่าน "สมัครด้วยอีเมล" — pure function ไม่ import env เพื่อให้ unit test ได้โดยไม่ต้องตั้ง env ครบ
//
// เหตุ (readiness audit 2026-08-26): prod ไม่มี RESEND_API_KEY → app/actions/auth.ts เข้าโหมด dev
//   พิมพ์ลิงก์ยืนยัน (มี token) ลง console = Vercel log ไม่ถึงผู้สมัคร → บัญชีตายด้าน (ยืนยันไม่ได้
//   แต่ "อีเมลนี้ถูกใช้แล้ว" กันเจ้าของตัวจริงสมัครซ้ำ) + token รั่วลง log
// กติกา: production ที่ยังไม่ตั้งอีเมล = ปิดรับสมัครด้วยอีเมลชัด ๆ (fail-closed แบบเดียวกับ payment/cron)
//   dev/test ยังสมัครได้ตามเดิม (ลิงก์ยืนยันโผล่ใน console ให้ copy)
//   โหมดข้ามยืนยัน (EMAIL_VERIFICATION=skip, 2026-08-27): ไม่ต้องส่งอีเมลเลย → เปิดรับสมัครเสมอ

export const EMAIL_SIGNUP_CLOSED_MESSAGE =
  "ระบบยังไม่เปิดรับสมัครด้วยอีเมล กรุณาสมัครหรือเข้าสู่ระบบด้วย Google";

export function isEmailSignupOpen(flags: {
  isProduction: boolean;
  isEmailEnabled: boolean;
  verificationRequired?: boolean; // default true (ไม่ส่ง = ถือว่ายังต้องยืนยัน)
}): boolean {
  if (flags.verificationRequired === false) return true; // ไม่ต้องส่งอีเมล → ไม่มีอะไรให้ปิด
  if (!flags.isProduction) return true; // dev/test: log ลิงก์ให้ copy ได้ ไม่ต้องมี provider
  return flags.isEmailEnabled;
}
