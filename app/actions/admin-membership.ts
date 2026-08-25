"use server";

// ============================================================
// Membership actions ฝั่งแอดมิน (Phase 2, docs/20) — ให้สิทธิ์ / เพิกถอน
// ============================================================
// RBAC: middleware + (admin)/layout กันชั้นนึงแล้ว — ที่นี่เช็คซ้ำกับ DB จริง
//   (F2 Codex §4 #2: role ใน JWT ค้างได้ถึง 30 วัน → แอดมินที่ถูกถอดสิทธิ์ต้องกดไม่ได้ทันที)
// ทุก action คืน { ok } ไม่ throw — แผงแอดมินเอาไปแสดงข้อความได้ตรง ๆ
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertVerifiedAdmin } from "@/lib/admin-guard";
import {
  grantMembership,
  revokeMembership,
  MEMBERSHIP_DEFAULT_DAYS,
  type MembershipTier,
} from "@/lib/membership";

export type AdminMembershipResult = { ok: true; message: string } | { ok: false; error: string };

const grantSchema = z.object({
  // ไม่ใช้ .email() ตามคอนเวนชันของโปรเจกต์ (lib/auth.ts:16) — บัญชี dev เป็น "user@local" ไม่มี TLD
  //   zod 3.24 .email() บังคับต้องมีโดเมน+TLD → จะให้สิทธิ์บัญชีทดสอบไม่ได้เลย
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "อีเมลไม่ถูกต้อง")
    .max(255, "อีเมลยาวเกินไป")
    .includes("@", { message: "อีเมลไม่ถูกต้อง" }),
  // 0 = ไม่มีวันหมดอายุ (ใช้กับบัญชีทีมงาน/ผู้สนับสนุน) — เพดาน 10 ปีกันพิมพ์หลุด
  days: z.coerce.number().int().min(0).max(3650),
});

const idSchema = z.string().regex(/^\d+$/, "userId ไม่ถูกต้อง");

async function adminUserId(): Promise<string> {
  const session = await assertVerifiedAdmin();
  return (session.user as { id?: string }).id as string;
}

// ให้สิทธิ์/ต่ออายุด้วย "อีเมล" — แอดมินมักได้อีเมลจากผู้ใช้ ไม่ใช่ id
export async function grantMembershipByEmail(input: {
  email: string;
  days?: number;
}): Promise<AdminMembershipResult> {
  let grantedByUserId: string;
  try {
    grantedByUserId = await adminUserId();
  } catch {
    return { ok: false, error: "ต้องเป็นแอดมิน" };
  }

  const parsed = grantSchema.safeParse({
    email: input.email,
    days: input.days ?? MEMBERSHIP_DEFAULT_DAYS,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "ไม่พบผู้ใช้อีเมลนี้ในระบบ" };

  const res = await grantMembership({
    userId: user.id,
    days: parsed.data.days,
    grantedByUserId,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/admin/memberships");
  revalidatePath("/account/membership");
  return {
    ok: true,
    message: res.view.expiresAt
      ? `ให้สิทธิ์แล้ว — หมดอายุ ${res.view.expiresAt.toLocaleDateString("th-TH")}`
      : "ให้สิทธิ์แล้ว — ไม่มีวันหมดอายุ",
  };
}

// เพิกถอนสิทธิ์ — ไม่แตะ order/ตั๋วที่ซื้อไปแล้ว มีผลกับรอบขายครั้งต่อไปเท่านั้น
export async function revokeMembershipAction(input: {
  userId: string;
}): Promise<AdminMembershipResult> {
  try {
    await adminUserId();
  } catch {
    return { ok: false, error: "ต้องเป็นแอดมิน" };
  }

  const parsed = idSchema.safeParse(input.userId);
  if (!parsed.success) return { ok: false, error: "userId ไม่ถูกต้อง" };

  const res = await revokeMembership(parsed.data);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/admin/memberships");
  revalidatePath("/account/membership");
  return { ok: true, message: "เพิกถอนสิทธิ์แล้ว" };
}

// ต่ออายุ/คืนสิทธิ์จากปุ่มในตาราง (รู้ userId อยู่แล้ว ไม่ต้องพิมพ์อีเมลซ้ำ)
export async function grantMembershipById(input: {
  userId: string;
  days?: number;
  tier?: MembershipTier; // ไม่ส่ง = คงระดับเดิม
}): Promise<AdminMembershipResult> {
  let grantedByUserId: string;
  try {
    grantedByUserId = await adminUserId();
  } catch {
    return { ok: false, error: "ต้องเป็นแอดมิน" };
  }

  const parsed = idSchema.safeParse(input.userId);
  if (!parsed.success) return { ok: false, error: "userId ไม่ถูกต้อง" };

  const days = input.days ?? MEMBERSHIP_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 0 || days > 3650) {
    return { ok: false, error: "จำนวนวันต้องเป็น 0–3650" };
  }

  if (input.tier && input.tier !== "STANDARD" && input.tier !== "PREMIUM") {
    return { ok: false, error: "ระดับสมาชิกไม่ถูกต้อง" };
  }

  const res = await grantMembership({
    userId: parsed.data,
    days,
    tier: input.tier,
    grantedByUserId,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/admin/memberships");
  revalidatePath("/account/membership");
  return { ok: true, message: "อัปเดตสิทธิ์แล้ว" };
}

// เปลี่ยน "ระดับสมาชิก" อย่างเดียว — ไม่ต่ออายุให้โดยไม่ตั้งใจ
//   (ถ้าใช้ grantMembership จะพ่วงการต่อวันหมดอายุไปด้วย ซึ่งเป็นผลข้างเคียงที่แอดมินไม่ได้สั่ง)
export async function setMembershipTier(input: {
  userId: string;
  tier: MembershipTier;
}): Promise<AdminMembershipResult> {
  try {
    await adminUserId();
  } catch {
    return { ok: false, error: "ต้องเป็นแอดมิน" };
  }

  const parsed = idSchema.safeParse(input.userId);
  if (!parsed.success) return { ok: false, error: "userId ไม่ถูกต้อง" };
  if (input.tier !== "STANDARD" && input.tier !== "PREMIUM") {
    return { ok: false, error: "ระดับสมาชิกไม่ถูกต้อง" };
  }

  const existing = await prisma.membership.findUnique({
    where: { userId: BigInt(parsed.data) },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "ผู้ใช้รายนี้ยังไม่เป็นสมาชิก" };

  await prisma.membership.update({
    where: { userId: BigInt(parsed.data) },
    data: { tier: input.tier },
  });

  revalidatePath("/admin/memberships");
  revalidatePath("/account/membership");
  return {
    ok: true,
    message: input.tier === "PREMIUM" ? "อัปเป็นสมาชิกพรีเมียมแล้ว" : "ปรับเป็นสมาชิกมาตรฐานแล้ว",
  };
}
