// Validate environment variables ที่ start time — ถ้าขาด fail ทันที
// ใช้ zod กัน production deploy แล้วเพิ่งรู้ว่าลืม env
import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis (queue + lock + rate limit) — default docker-compose
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // NextAuth
  NEXTAUTH_SECRET: z.string().min(32, "NEXTAUTH_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร"),
  NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),

  // Google OAuth (optional — ถ้าไม่ตั้ง จะปิด Google login)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Cloudflare Turnstile (CAPTCHA) — optional
  //   ถ้าไม่ตั้ง: dev = ใช้ test key (ผ่านเสมอ), production = fail-closed (ตรวจไม่ผ่าน)
  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),

  // Email (optional — ถ้าไม่ตั้ง verification token จะ log ใน console)
  RESEND_API_KEY: z.string().optional(),
  // ใช้ string ธรรมดา ไม่ใช่ .email() เพราะ dev ใช้ "noreply@localhost" (ไม่มี TLD)
  // ตอน production ที่ส่งจริงค่อย validate รูปแบบใน lib ที่ส่งเมล
  EMAIL_FROM: z.string().default("noreply@localhost"),

  // Payment (PromptPay + EasySlip)
  // PROMPTPAY_ID = เบอร์มือถือ/เลขบัตร ปชช. ที่ "รับเงิน" — ใช้สร้าง QR + ตรวจ receiver ในสลิป
  PROMPTPAY_ID: z.string().optional(),
  // EASYSLIP_API_KEY = key ตรวจสลิปจริง — ถ้าไม่ใส่: dev=mock(เตือน), production=ปฏิเสธ (fail-closed)
  EASYSLIP_API_KEY: z.string().optional(),
  // เปิด/ปิดการตรวจว่าเงินเข้าบัญชี PROMPTPAY_ID ของเราจริง (default เปิด)
  // ปิดได้ถ้าธนาคารบางเจ้า mask เลขบัญชีจน match ไม่ได้ — แต่ไม่แนะนำให้ปิดบน production
  PAYMENTS_RECEIVER_CHECK: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // เปิด/ปิดการตรวจว่า "เวลาโอนในสลิป" อยู่ในช่วงของ order (กันสลิปเก่า) — default เปิด
  PAYMENTS_FRESHNESS_CHECK: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // App
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_NAME: z.string().default("Concert Anti-Bot"),
  APP_CURRENCY: z.string().default("THB"),

  // Anti-bot tunables
  QUEUE_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  SEAT_HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  BOT_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),

  // per-payer ticket cap — จำนวนตั๋วสูงสุดที่ "1 บัญชีผู้จ่าย" ซื้อได้ต่อ 1 คอนเสิร์ต (ข้ามทุก app account)
  //   กัน account farming: ปั๊มบัญชีแอปได้ฟรี แต่บัญชีธนาคารจริงปั๊มไม่ไหว → cap ที่ชั้นจ่ายเงิน (ปลอมไม่ได้)
  PER_PAYER_TICKET_LIMIT: z.coerce.number().int().positive().default(10),
});

// parse once — throw ถ้า invalid (Next จะ crash ตอน boot, ดีกว่า silent fail)
export const env = envSchema.parse(process.env);

// helper: รู้ว่า Google login เปิดอยู่มั้ย
export const isGoogleEnabled = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const isEmailEnabled = !!env.RESEND_API_KEY;

// helper: payment config พร้อมแค่ไหน
export const isEasySlipConfigured = !!env.EASYSLIP_API_KEY;
export const isPromptPayConfigured = !!env.PROMPTPAY_ID;
export const isProduction = env.NODE_ENV === "production";

// helper: anti-bot config พร้อมแค่ไหน (Turnstile)
export const isTurnstileConfigured = !!env.TURNSTILE_SECRET_KEY;

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
