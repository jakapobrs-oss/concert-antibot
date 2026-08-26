"use server";

// Server Actions: ลืมรหัสผ่าน (ขอลิงก์ → ตั้งรหัสใหม่) + ขอลิงก์ยืนยันอีเมลใหม่ (gap map 2026-08-27 ขั้น 3)
// หลักการเดียวกับ login/register:
//   - ไม่บอกว่าอีเมลนี้มีบัญชีไหม (anti-enumeration): ขอลิงก์แล้วได้ข้อความเดียวกันเสมอ
//   - rate-limit ทั้งต่อ IP และต่ออีเมล (กันยิงสแปมอีเมลคนอื่น + เผา quota Resend)
//   - token ใช้ตาราง VerificationToken เดิม แยกชนิดด้วย prefix (lib/password-reset.ts) ไม่เพิ่ม migration
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromXff } from "@/lib/get-ip";
import { env, isEmailEnabled, isEmailVerificationRequired, isProduction } from "@/lib/env";
import { sendPasswordResetEmail } from "@/lib/email";
import {
  RESET_TOKEN_TTL_MS,
  checkNewPassword,
  evaluateResetToken,
  generateResetToken,
  resetIdentifierFor,
  resetTokenExpiry,
} from "@/lib/password-reset";
import { sendVerificationToken } from "@/app/actions/auth";

// state ของ useActionState ในฟอร์ม forgot / reset / resend — ข้อความสำเร็จ (กลาง ไม่เปิดเผยว่ามีบัญชี) อยู่ใน lib/password-reset.ts
export type SimpleFormState = { ok?: true; error?: string; fieldErrors?: Record<string, string[]> } | null;

function normalizeEmail(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  return email.length >= 3 && email.includes("@") && email.length <= 254 ? email : null;
}

async function clientIp(): Promise<string> {
  return clientIpFromXff((await headers()).get("x-forwarded-for"));
}

// ---------- 1) ขอลิงก์ตั้งรหัสผ่านใหม่ ----------
export async function requestPasswordResetAction(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const email = normalizeEmail(formData.get("email"));
  if (!email) return { error: "อีเมลไม่ถูกต้อง", fieldErrors: { email: ["อีเมลไม่ถูกต้อง"] } };

  const ip = await clientIp();
  const ipRl = await checkRateLimit({ key: `forgot:ip:${ip}`, limit: 5, windowMs: 15 * 60 * 1000 });
  const emailRl = await checkRateLimit({ key: `forgot:email:${email}`, limit: 3, windowMs: 60 * 60 * 1000 });
  if (!ipRl.allowed || !emailRl.allowed) {
    return { error: "ขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" };
  }

  // มีบัญชี + ใช้รหัสผ่าน (บัญชี Google ล้วนไม่มีรหัสให้รีเซ็ต) → ออก token; ไม่งั้นทำเงียบ ๆ แต่ตอบเหมือนกัน
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  if (user?.passwordHash) {
    const identifier = resetIdentifierFor(email);
    const token = generateResetToken();
    await prisma.$transaction([
      prisma.verificationToken.deleteMany({ where: { identifier } }), // token เก่าของอีเมลนี้ใช้ไม่ได้อีก
      prisma.verificationToken.create({ data: { identifier, token, expires: resetTokenExpiry() } }),
    ]);

    const resetUrl = `${env.NEXTAUTH_URL}/reset?token=${token}`;
    if (!isEmailEnabled) {
      if (isProduction) {
        // ไม่ควรเกิด (prod ตั้ง Resend แล้ว) — ห้ามพิมพ์ token ลง log ของ prod
        console.error(`🔑 production ไม่มี RESEND_API_KEY — ส่งลิงก์รีเซ็ตให้ ${email} ไม่ได้`);
        await prisma.verificationToken.deleteMany({ where: { identifier } });
      } else {
        console.log(`\n🔑 [DEV MODE] ลิงก์ตั้งรหัสผ่านใหม่สำหรับ ${email}:\n   ${resetUrl}\n`);
      }
    } else {
      const sent = await sendPasswordResetEmail(email, resetUrl, RESET_TOKEN_TTL_MS / 60_000);
      if (!sent.ok) {
        const reason = "error" in sent ? sent.error : "skipped";
        console.error(`🔑 ส่งลิงก์รีเซ็ตรหัสไป ${email} ไม่สำเร็จ: ${reason}`);
        await prisma.verificationToken.deleteMany({ where: { identifier } }); // ไม่มีใครได้ลิงก์ → ไม่ทิ้ง token ค้าง
      }
    }
  }

  return { ok: true };
}

// ---------- 2) เช็ค token ก่อนโชว์ฟอร์ม (หน้า /reset) — ไม่ consume ----------
export async function peekResetToken(token: string): Promise<{ usable: boolean; reason?: string }> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { usable: false, reason: "invalid" };
  const record = await prisma.verificationToken.findUnique({
    where: { token },
    select: { identifier: true, expires: true },
  });
  const state = evaluateResetToken(record);
  return state.usable ? { usable: true } : { usable: false, reason: state.reason };
}

// ---------- 3) ตั้งรหัสผ่านใหม่ ----------
export async function resetPasswordAction(_prev: SimpleFormState, formData: FormData): Promise<SimpleFormState> {
  const token = formData.get("token");
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    return { error: "ลิงก์ไม่ถูกต้อง กรุณาขอลิงก์ใหม่" };
  }

  const check = checkNewPassword(formData.get("password"), formData.get("confirm"));
  if (!check.ok) return { error: check.error, fieldErrors: { password: [check.error] } };

  const ip = await clientIp();
  const rl = await checkRateLimit({ key: `reset:ip:${ip}`, limit: 10, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return { error: "พยายามบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" };

  const record = await prisma.verificationToken.findUnique({
    where: { token },
    select: { identifier: true, expires: true },
  });
  const state = evaluateResetToken(record);
  if (!state.usable) {
    return {
      error:
        state.reason === "expired"
          ? "ลิงก์หมดอายุแล้ว กรุณาขอลิงก์ใหม่"
          : "ลิงก์ไม่ถูกต้องหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่",
    };
  }

  const user = await prisma.user.findUnique({ where: { email: state.email }, select: { id: true, emailVerified: true } });
  if (!user) return { error: "ไม่พบบัญชีของลิงก์นี้ กรุณาขอลิงก์ใหม่" };

  const passwordHash = await hashPassword(check.password);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // ปลดล็อกบัญชีที่ถูกล็อกจากการเดารหัส — เจ้าของพิสูจน์ตัวผ่านอีเมลแล้ว
        failedLoginCount: 0,
        lockedUntil: null,
        // กดลิงก์จากกล่องจดหมายได้ = ยืนยันว่าเป็นเจ้าของอีเมล → ถือว่ายืนยันอีเมลไปด้วย (ถ้ายังไม่เคย)
        emailVerified: user.emailVerified ?? new Date(),
      },
    }),
    // ใช้ครั้งเดียว: ลบทุก token รีเซ็ตของอีเมลนี้ (รวมอันที่เพิ่งใช้)
    prisma.verificationToken.deleteMany({ where: { identifier: record!.identifier } }),
  ]);

  redirect("/login?reset=1");
}

// ---------- 4) ขอลิงก์ยืนยันอีเมลใหม่ ----------
export async function resendVerificationAction(_prev: SimpleFormState, formData: FormData): Promise<SimpleFormState> {
  // โหมดข้ามยืนยัน (EMAIL_VERIFICATION=skip): บัญชีถูกยืนยันตั้งแต่สมัคร ไม่มีอะไรให้ส่ง
  if (!isEmailVerificationRequired) {
    return { error: "ระบบนี้ไม่ต้องยืนยันอีเมล — เข้าสู่ระบบได้เลย" };
  }

  const email = normalizeEmail(formData.get("email"));
  if (!email) return { error: "อีเมลไม่ถูกต้อง", fieldErrors: { email: ["อีเมลไม่ถูกต้อง"] } };

  const ip = await clientIp();
  const ipRl = await checkRateLimit({ key: `resend:ip:${ip}`, limit: 5, windowMs: 15 * 60 * 1000 });
  const emailRl = await checkRateLimit({ key: `resend:email:${email}`, limit: 3, windowMs: 60 * 60 * 1000 });
  if (!ipRl.allowed || !emailRl.allowed) {
    return { error: "ขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" };
  }

  // เฉพาะบัญชีรหัสผ่านที่ยังไม่ยืนยัน — ที่เหลือ (ไม่มีบัญชี/ยืนยันแล้ว/Google) ตอบเหมือนกันโดยไม่ส่งอะไร
  const user = await prisma.user.findUnique({
    where: { email },
    select: { emailVerified: true, passwordHash: true },
  });
  if (user && !user.emailVerified && user.passwordHash) {
    await prisma.verificationToken.deleteMany({ where: { identifier: email } }); // ลิงก์เก่าใช้ไม่ได้อีก
    const sent = await sendVerificationToken(email);
    if (!sent.ok) console.error(`📧 ส่งลิงก์ยืนยันใหม่ไป ${email} ไม่สำเร็จ`);
  }

  return { ok: true };
}
