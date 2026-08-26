"use server";

// Server Actions สำหรับ Auth: register, requestVerification, verify
// เลือก server action แทน API route เพราะ Next 15 ออกแบบมาให้ใช้ใน form มันลด boilerplate
import { z } from "zod";
import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromXff } from "@/lib/get-ip";
import { env, isEmailEnabled, isProduction } from "@/lib/env";
import { sendVerificationEmail } from "@/lib/email";
import { isEmailSignupOpen, EMAIL_SIGNUP_CLOSED_MESSAGE } from "@/lib/email-signup-gate";

const registerSchema = z
  .object({
    email: z.string().min(3, "อีเมลไม่ถูกต้อง").includes("@", { message: "อีเมลไม่ถูกต้อง" }),
    password: z.string().min(8, "รหัสผ่านต้องอย่างน้อย 8 ตัว"),
    name: z.string().min(1, "กรุณากรอกชื่อ").max(100),
  });

export type RegisterResult =
  | { ok: true; userId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function registerUser(formData: FormData): Promise<RegisterResult> {
  // 🚪 production ที่ยังไม่ตั้ง RESEND_API_KEY = ปิดรับสมัครด้วยอีเมล (fail-closed แบบเดียวกับ payment/cron)
  //   ไม่งั้นได้บัญชีที่ยืนยันไม่ได้ (ลิงก์ไปโผล่ใน log) + "อีเมลนี้ถูกใช้แล้ว" กันเจ้าของจริงสมัครซ้ำ — ดู lib/email-signup-gate.ts
  if (!isEmailSignupOpen({ isProduction, isEmailEnabled })) {
    return { ok: false, error: EMAIL_SIGNUP_CLOSED_MESSAGE };
  }

  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
  };

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "ข้อมูลไม่ถูกต้อง",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // 🚦 rate limit ต่อ IP — กันยิง register รัวเผา CPU (argon2 hash แพงโดยตั้งใจ) + สร้าง user รัว
  //   F4 (Codex §4 #4): ใช้ clientIpFromXff (hop ขวาสุด) ไม่ใช่ split[0] (ซ้ายสุด = client ปลอมได้)
  const ip = clientIpFromXff((await headers()).get("x-forwarded-for"));
  const rl = await checkRateLimit({ key: `register:ip:${ip}`, limit: 5, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) {
    return { ok: false, error: "สมัครสมาชิกบ่อยเกินไป กรุณาลองใหม่ภายหลัง" };
  }

  const { email, password, name } = parsed.data;

  // เช็คซ้ำก่อน — ไม่ rely on unique constraint เพื่อให้ error message ดี
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    return { ok: false, error: "อีเมลนี้ถูกใช้แล้ว" };
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role: "USER",
    },
  });

  // ส่ง verification token — ส่งไม่ออก (Resend ปฏิเสธ/เน็ตล่ม) = ถอนบัญชีที่เพิ่งสร้างแล้วบอกให้ลองใหม่
  //   เดิม "ไม่ rollback" โดยหวังให้ user ขอลิงก์ใหม่ทีหลัง แต่ระบบยังไม่มีปุ่มขอลิงก์ใหม่ → บัญชีตายด้าน
  //   + อีเมลถูกจองไว้ (สมัครซ้ำไม่ได้) จึงเปลี่ยนเป็น fail-closed: ไม่มีอีเมลยืนยัน = ยังไม่นับว่าสมัครสำเร็จ
  const sent = await sendVerificationToken(email);
  if (!sent.ok) {
    await prisma.$transaction([
      prisma.verificationToken.deleteMany({ where: { identifier: email } }),
      prisma.user.delete({ where: { id: user.id } }),
    ]);
    return { ok: false, error: "ส่งอีเมลยืนยันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือสมัครด้วย Google" };
  }

  return { ok: true, userId: user.id.toString() };
}

// State สำหรับ useActionState ในฟอร์มสมัครสมาชิก
export type RegisterFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// adapter ให้เข้ากับ useActionState — สำเร็จแล้ว redirect, ผิดพลาดคืน error ไปแสดงในฟอร์ม
export async function registerAction(
  _prev: RegisterFormState,
  formData: FormData
): Promise<RegisterFormState> {
  const result = await registerUser(formData);
  if (result.ok) {
    // redirect() โยน error พิเศษเพื่อเปลี่ยนหน้า — โค้ดด้านล่างจะไม่ทำงาน
    redirect("/login?registered=1");
  }
  return { error: result.error, fieldErrors: result.fieldErrors };
}

// ส่ง verification token — dev (ไม่มี Resend) log ลิงก์ใน console; production ส่งจริง
// คืน { ok } ให้ registerUser ตัดสิน rollback — ไม่ throw เพราะอยากคุมข้อความที่ผู้ใช้เห็นเอง
async function sendVerificationToken(email: string): Promise<{ ok: boolean }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 ชม

  await prisma.verificationToken.create({
    data: { identifier: email, token, expires },
  });

  const verifyUrl = `${env.NEXTAUTH_URL}/verify?token=${token}`;

  if (!isEmailEnabled) {
    if (isProduction) {
      // มาถึงนี่ไม่ควรเกิด (registerUser ปิดรับสมัครไปแล้ว) — กันอีกชั้น: ห้ามพิมพ์ token ลง log ของ prod
      console.error(`📧 production ไม่มี RESEND_API_KEY — ส่งลิงก์ยืนยันให้ ${email} ไม่ได้`);
      return { ok: false };
    }
    // dev mode (ไม่มี RESEND_API_KEY) — log link ให้ user copy เอง
    console.log(`\n📧 [DEV MODE] Verification link สำหรับ ${email}:`);
    console.log(`   ${verifyUrl}\n`);
    return { ok: true };
  }

  // ส่งอีเมลจริงผ่าน Resend REST API (lib/email.ts)
  const result = await sendVerificationEmail(email, verifyUrl);
  if (result.ok) {
    console.log(`📧 ส่ง verification email ไป ${email} แล้ว (Resend id: ${result.id})`);
    return { ok: true };
  }
  // ส่งไม่สำเร็จ (โดเมนยังไม่ verify / EMAIL_FROM เป็น sender ทดสอบ @resend.dev ที่ส่งได้แค่อีเมลเจ้าของบัญชี / เน็ตล่ม)
  //   log เหตุผล (ไม่มี token) แล้วให้ registerUser ถอนบัญชี — ผู้สมัครได้ข้อความชัดและลองใหม่ได้
  const reason = "error" in result ? result.error : "skipped (RESEND_API_KEY missing)";
  console.error(`📧 ส่ง verification email ไป ${email} ไม่สำเร็จ: ${reason}`);
  return { ok: false };
}

export async function verifyEmail(token: string): Promise<{ ok: boolean; error?: string }> {
  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record) return { ok: false, error: "Token ไม่ถูกต้อง" };
  if (record.expires < new Date()) return { ok: false, error: "Token หมดอายุแล้ว" };

  await prisma.$transaction([
    prisma.user.update({
      where: { email: record.identifier },
      data: { emailVerified: new Date() },
    }),
    prisma.verificationToken.delete({ where: { token } }),
  ]);

  return { ok: true };
}
