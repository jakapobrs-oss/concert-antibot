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
import { env, isEmailEnabled } from "@/lib/env";
import { sendVerificationEmail } from "@/lib/email";

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
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
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

  // ส่ง verification token (ถ้ามี email provider)
  await sendVerificationToken(email);

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

// ส่ง verification token — ถ้าไม่มี Resend จะ log ใน console
async function sendVerificationToken(email: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 ชม

  await prisma.verificationToken.create({
    data: { identifier: email, token, expires },
  });

  const verifyUrl = `${env.NEXTAUTH_URL}/verify?token=${token}`;

  if (!isEmailEnabled) {
    // dev mode (ไม่มี RESEND_API_KEY) — log link ให้ user copy เอง
    console.log(`\n📧 [DEV MODE] Verification link สำหรับ ${email}:`);
    console.log(`   ${verifyUrl}\n`);
    return;
  }

  // production — ส่งอีเมลจริงผ่าน Resend REST API (lib/email.ts)
  const result = await sendVerificationEmail(email, verifyUrl);
  if (result.ok) {
    console.log(`📧 ส่ง verification email ไป ${email} แล้ว (Resend id: ${result.id})`);
  } else {
    // ส่งไม่สำเร็จ (domain ยังไม่ verify / EMAIL_FROM ผิด / เน็ตล่ม) — ตั้งใจ "ไม่" throw
    // เพราะไม่อยาก rollback การสมัครเพราะระบบเมลล่ม; user ขอลิงก์ยืนยันใหม่ได้ภายหลัง
    const reason = "error" in result ? result.error : "skipped (RESEND_API_KEY missing)";
    console.error(`📧 ส่ง verification email ไป ${email} ไม่สำเร็จ: ${reason}`);
  }
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
