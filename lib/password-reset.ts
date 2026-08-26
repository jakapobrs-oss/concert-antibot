// ลืมรหัสผ่าน — กติกาของ token/รหัสใหม่ (pure ยกเว้น generateResetToken ที่ใช้ crypto) ให้ server action บาง ๆ และ unit test ได้
//
// ออกแบบ (gap map 2026-08-27 ขั้น 3): ใช้ตาราง VerificationToken เดิม ไม่เพิ่ม migration
//   แยกชนิดด้วย identifier ขึ้นต้น "pwreset:" → token ยืนยันอีเมล (identifier = อีเมลล้วน) กับ token รีเซ็ตรหัส
//   ใช้ข้ามกันไม่ได้: verifyEmail() ปฏิเสธ identifier ที่มี prefix / resetPassword() รับเฉพาะที่มี prefix
// token: 32 ไบต์สุ่ม (hex 64 ตัว) อายุ 30 นาที ใช้ครั้งเดียว (ลบทุก token ของอีเมลนั้นเมื่อรีเซ็ตสำเร็จ/ขอใหม่)
//
// ⚠️ ไฟล์นี้ถูก import จาก client component (ฟอร์ม) → ห้ามมี node:crypto/prisma/env ในนี้ (next build จะล้ม
//   "Reading from node:crypto is not handled by plugins") — ตัวสุ่ม token อยู่ที่ lib/password-reset-token.ts (server-only)

export const RESET_IDENTIFIER_PREFIX = "pwreset:";
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
// เท่ากับตอนสมัคร (app/actions/auth.ts registerSchema) — ไม่ให้รีเซ็ตแล้วได้รหัสอ่อนกว่าตอนสมัคร
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

// ข้อความหลังส่งฟอร์ม — "กลาง" โดยตั้งใจ: ไม่บอกว่าอีเมลนี้มีบัญชีหรือไม่ (anti-enumeration) ใช้ทั้ง server action และฟอร์ม
export const RESET_REQUESTED_MESSAGE =
  "ถ้าอีเมลนี้มีบัญชีที่ใช้รหัสผ่าน เราส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว (ลิงก์หมดอายุใน 30 นาที) — ไม่ได้รับภายในไม่กี่นาที ลองดูโฟลเดอร์สแปม หรือติดต่อแชตช่วยเหลือ";
export const VERIFICATION_RESENT_MESSAGE =
  "ถ้าอีเมลนี้มีบัญชีที่ยังไม่ยืนยัน เราส่งลิงก์ยืนยันใหม่ไปให้แล้ว (ลิงก์หมดอายุใน 24 ชั่วโมง)";

export function resetIdentifierFor(email: string): string {
  return `${RESET_IDENTIFIER_PREFIX}${email}`;
}

export function isResetIdentifier(identifier: string): boolean {
  return identifier.startsWith(RESET_IDENTIFIER_PREFIX);
}

// คืนอีเมลจาก identifier ของ token รีเซ็ต — null ถ้าไม่ใช่ token รีเซ็ต (เช่น token ยืนยันอีเมล)
export function emailFromResetIdentifier(identifier: string): string | null {
  if (!isResetIdentifier(identifier)) return null;
  const email = identifier.slice(RESET_IDENTIFIER_PREFIX.length);
  return email.length > 0 ? email : null;
}

export function resetTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MS);
}

export type ResetTokenState =
  | { usable: true; email: string }
  | { usable: false; reason: "missing" | "not-reset" | "expired" };

// ตัดสินว่า token ที่หามาจาก DB ใช้รีเซ็ตได้ไหม — ข้อความที่ผู้ใช้เห็นอยู่ที่หน้า /reset (ไม่แยก "ไม่มี" กับ "ผิดชนิด" ให้ผู้ใช้)
export function evaluateResetToken(
  record: { identifier: string; expires: Date } | null | undefined,
  now: Date = new Date(),
): ResetTokenState {
  if (!record) return { usable: false, reason: "missing" };
  const email = emailFromResetIdentifier(record.identifier);
  if (!email) return { usable: false, reason: "not-reset" };
  if (record.expires.getTime() <= now.getTime()) return { usable: false, reason: "expired" };
  return { usable: true, email };
}

export type PasswordCheck = { ok: true; password: string } | { ok: false; error: string };

// ตรวจรหัสใหม่ + ช่องยืนยัน — คืนข้อความไทยพร้อมแสดงใต้ช่องกรอก
export function checkNewPassword(password: unknown, confirm: unknown): PasswordCheck {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, error: "กรุณากรอกรหัสผ่านใหม่" };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `รหัสผ่านต้องอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัว` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: "รหัสผ่านยาวเกินไป" };
  }
  if (password !== confirm) {
    return { ok: false, error: "รหัสผ่านทั้งสองช่องไม่ตรงกัน" };
  }
  return { ok: true, password };
}
