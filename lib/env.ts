// Validate environment variables ที่ start time — ถ้าขาด fail ทันที
// ใช้ zod กัน production deploy แล้วเพิ่งรู้ว่าลืม env
//
// หมายเหตุ: ตัว schema ย้ายไปอยู่ lib/env-schema.ts แล้ว (ดู comment ในไฟล์นั้น)
//   เพื่อให้ scripts/check-env.ts ดึง schema ไปใช้ได้โดย import ไม่ throw
import { envSchema } from "./env-schema";

// parse once — throw ถ้า invalid (Next จะ crash ตอน boot, ดีกว่า silent fail)
export const env = envSchema.parse(process.env);

// re-export schema เผื่อที่อื่นอยากใช้ผ่าน "@/lib/env" ที่เดียว
export { envSchema };

// helper: รู้ว่า Google login เปิดอยู่มั้ย
export const isGoogleEnabled = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const isEmailEnabled = !!env.RESEND_API_KEY;

// helper: payment config พร้อมแค่ไหน
export const isEasySlipConfigured = !!env.EASYSLIP_API_KEY;
export const isPromptPayConfigured = !!env.PROMPTPAY_ID;
export const isProduction = env.NODE_ENV === "production";

// helper: anti-bot config พร้อมแค่ไหน (Turnstile)
export const isTurnstileConfigured = !!env.TURNSTILE_SECRET_KEY;
export const isGeminiConfigured = !!env.GEMINI_API_KEY;

// เตือนดังๆ ตอน boot ถ้า production แต่ payment ยังไม่พร้อม
// ไม่ throw เพื่อไม่ให้ next build พัง แต่ตัว verifySlip จะ "ปฏิเสธการจ่าย" (fail-closed) เอง
if (isProduction && (!isEasySlipConfigured || !isPromptPayConfigured)) {
  console.error(
    "🚨 [PAYMENT] production แต่ยังไม่ได้ตั้งค่า " +
      [!isPromptPayConfigured && "PROMPTPAY_ID", !isEasySlipConfigured && "EASYSLIP_API_KEY"]
        .filter(Boolean)
        .join(" + ") +
      " — ระบบจะปฏิเสธการชำระเงินทั้งหมดจนกว่าจะตั้งค่าครบ (fail-closed)"
  );
}

// เตือนถ้า production แต่ยังไม่ตั้ง Turnstile — CAPTCHA จะ fail-closed (verifyTurnstile)
// = ผู้ใช้จริงอาจโดน challenge/block หมด จนกว่าจะใส่ key จริง (ตั้งใจให้ดังเพื่อกัน "ปิด CAPTCHA เงียบ ๆ")
if (isProduction && !isTurnstileConfigured) {
  console.error(
    "🚨 [ANTI-BOT] production แต่ยังไม่ได้ตั้ง TURNSTILE_SECRET_KEY — " +
      "Turnstile จะตรวจไม่ผ่าน (fail-closed) ทุก request จนกว่าจะตั้งค่า"
  );
}
