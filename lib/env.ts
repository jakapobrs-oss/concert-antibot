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

// เตือนถ้า production ตั้ง SECRET แต่ "ลืม" SITE_KEY (Codex §3 #5)
//   client จะ render test site key (always-pass: 1x0000…AA) แต่ server verify ด้วย secret จริง
//   → token ที่ client ได้ไม่มีทางผ่าน = ผู้ใช้ทุกคนติด challenge วน 428 ไม่จบ (queue join ล่มทั้งระบบ)
//   ตั้งใจ warn (ไม่ throw) ให้เข้ากับ convention ไฟล์นี้ — operator ต้องใส่ SITE_KEY ให้ครบคู่
if (isProduction && isTurnstileConfigured && !env.TURNSTILE_SITE_KEY) {
  console.error(
    "🚨 [ANTI-BOT] ตั้ง TURNSTILE_SECRET_KEY แล้วแต่ลืม TURNSTILE_SITE_KEY — " +
      "หน้าเว็บจะใช้ test site key (always-pass) ที่ verify กับ secret จริงไม่ผ่าน = ผู้ใช้ติด challenge วนไม่จบ"
  );
}

// เตือนถ้า production แต่ยังไม่ตั้ง CRON_SECRET (Codex §5 #1 / G1)
//   /api/cron/sweep จะ fail-closed (503) จนกว่าจะตั้ง — กัน endpoint กวาด order เปลือยหลุด deploy
if (isProduction && !env.CRON_SECRET) {
  console.error(
    "🚨 [CRON] production แต่ยังไม่ได้ตั้ง CRON_SECRET — /api/cron/sweep จะปฏิเสธ (503) จนกว่าจะตั้งค่า"
  );
}

// เตือนถ้า production แต่ยังไม่ตั้ง GEMINI_API_KEY (Codex §6 #2)
//   /api/chat + /api/admin/chat จะตอบ "AI ยังไม่พร้อม" (503) — กัน key ว่างเงียบ ๆ แล้ว user เจอ error วน
if (isProduction && !isGeminiConfigured) {
  console.error(
    "🚨 [AI] production แต่ยังไม่ได้ตั้ง GEMINI_API_KEY — ผู้ช่วย AI (chat) จะปิดใช้งาน (503) จนกว่าจะตั้งค่า"
  );
}
