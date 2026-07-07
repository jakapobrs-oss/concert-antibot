// Schema กลางของ environment variables (zod) — แยกออกจาก lib/env.ts
// เหตุผลที่แยก: lib/env.ts ทำ envSchema.parse(process.env) ตอน import (throw ถ้าขาด)
//   เครื่องมือที่อยาก "ตรวจ" env (scripts/check-env.ts) ต้องการแค่ "ตัว schema"
//   โดยไม่ให้การ import ไป throw ก่อน → ดึง schema มาไว้ที่นี่ แล้วให้ทั้งสองฝั่ง import ใช้ร่วมกัน (DRY)
import { z } from "zod";

export const envSchema = z.object({
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
  // ชื่อบัญชีผู้รับเงินที่คาดหวัง (ใส่ได้หลายชื่อคั่น comma เช่น "จักรภพ ยมรัตน์,Jakapob Y")
  // ตั้งแล้ว = สลิปต้องมีชื่อผู้รับตรงด้วย — ปิดช่อง "บัญชี attacker เองที่เลขท้ายพ้องกับร้าน"
  // (เลขบัญชีบนสลิปถูก mask จนเทียบได้บางหลัก แต่ชื่อบัญชีปลอมไม่ได้) — แนะนำให้ตั้งบน production
  PAYMENTS_RECEIVER_NAME: z.string().optional(),

  // App
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_NAME: z.string().default("Concert Anti-Bot"),
  APP_CURRENCY: z.string().default("THB"),

  // Gemini AI (Google AI Studio — free tier 60 req/min)
  // ขอจาก: https://aistudio.google.com/apikey
  GEMINI_API_KEY: z.string().optional(),

  // Queue fairness — HMAC secret สำหรับคำนวณ deterministic randomScore ต่อ userId+concert
  // กัน leave/rejoin re-roll: user เดิม+concert เดิม ได้ randomScore เดิมเสมอ
  // สร้างด้วย: openssl rand -base64 32
  QUEUE_SCORE_SECRET: z.string().min(16).default("insecure-default-change-in-production"),

  // Anti-bot tunables
  QUEUE_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  // ความจุ "ห้องเลือกที่นั่ง" (capacity-aware admission) — คนที่อยู่ในหน้าเลือกที่นั่งพร้อมกันได้สูงสุด
  //   admitNext ปล่อยไม่เกิน (cap − คนที่ยังเลือกอยู่ข้างใน) ต่อรอบ → กันรุมเลือกที่นั่งเกินความจุจริง
  //   พอคนข้างในจ่ายเสร็จ/หมดเวลา → คืนความจุ (self-refill). ควรตั้ง >= QUEUE_BATCH_SIZE
  QUEUE_ADMIT_CAP: z.coerce.number().int().positive().default(200),
  SEAT_HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  BOT_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),

  // per-payer ticket cap — จำนวนตั๋วสูงสุดที่ "1 บัญชีผู้จ่าย" ซื้อได้ต่อ 1 คอนเสิร์ต (ข้ามทุก app account)
  //   กัน account farming: ปั๊มบัญชีแอปได้ฟรี แต่บัญชีธนาคารจริงปั๊มไม่ไหว → cap ที่ชั้นจ่ายเงิน (ปลอมไม่ได้)
  PER_PAYER_TICKET_LIMIT: z.coerce.number().int().positive().default(10),

  // ---- Named ticket (docs/19) ----
  // อายุบัญชีขั้นต่ำ (วัน) ของ "ผู้ถือที่ไม่ใช่ผู้ซื้อ" — กัน scalper ให้ลูกค้าสมัครบัญชีใหม่มารับบัตร
  //   (เกณฑ์ ~1 เดือนตามที่ user เลือก) 0 = ปิดเช็ค (สะดวกตอน dev/demo ที่บัญชีเพิ่งสร้าง)
  HOLDER_MIN_ACCOUNT_AGE_DAYS: z.coerce.number().int().min(0).default(30),
  // คืนบัตรได้ถึงกี่ชั่วโมงก่อนเริ่มงาน — ให้ระบบมีเวลาขายที่นั่งที่คืนมารอบใหม่
  RETURN_CUTOFF_HOURS: z.coerce.number().int().min(0).default(24),

  // Vercel Cron — secret กัน endpoint /api/cron/sweep ถูกเรียกมั่วจากภายนอก
  //   ตั้งบน Vercel → Vercel แนบ header "Authorization: Bearer <CRON_SECRET>" ตอนยิง cron ให้เอง
  //   ไม่ตั้ง = route เปิดเรียกได้ (สะดวกตอน dev) — production ควรตั้ง
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
