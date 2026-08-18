"use server";

// ============================================================
// Server Actions — สิทธิ์สมาชิก (Phase 2)
// ============================================================
//   - signUpForMembership : ผู้ใช้กดสมัครเอง (ฟรี — ขอบเขตที่ตกลงไว้ ไม่มีการเก็บเงินค่าสมาชิก)
//   - grantMembership     : แอดมินให้สิทธิ์
//   - revokeMembership    : แอดมินเพิกถอนสิทธิ์
//
// ตรรกะการตัดสิน "ยังเป็นสมาชิกอยู่ไหม" อยู่ที่ lib/membership.ts (มีเทสหน่วยคุม)
// ไฟล์นี้รับผิดชอบแค่ สิทธิ์ + ตรวจ input + เขียนฐานข้อมูล
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertVerifiedAdmin } from "@/lib/admin-guard";
import { addDays, describeMembership, SELF_SIGNUP_DURATION_DAYS } from "@/lib/membership";

export type MembershipActionResult = { ok: true; message: string } | { ok: false; error: string };

const idSchema = z.string().regex(/^\d+$/, "รหัสไม่ถูกต้อง");

async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/**
 * ผู้ใช้กดสมัครสมาชิกเอง
 *
 * ใช้ upsert เพราะตาราง memberships มี userId เป็น unique — คนเดียวมีได้แถวเดียว
 * กรณีที่ต้องรองรับ: เคยถูกเพิกถอน/หมดอายุแล้วมาสมัครใหม่ → เขียนทับแถวเดิมให้กลับมา ACTIVE
 * (ล้าง revokedAt ด้วย ไม่งั้นแถวจะขัดแย้งกันเอง: ACTIVE แต่มีเวลาเพิกถอนค้างอยู่)
 */
export async function signUpForMembership(): Promise<MembershipActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "ต้องเข้าสู่ระบบก่อน" };

  const now = new Date();
  const existing = await prisma.membership.findUnique({ where: { userId: BigInt(userId) } });
  if (describeMembership(existing, now).active) {
    return { ok: false, error: "คุณเป็นสมาชิกอยู่แล้ว" };
  }

  const expiresAt = addDays(now, SELF_SIGNUP_DURATION_DAYS);
  await prisma.membership.upsert({
    where: { userId: BigInt(userId) },
    create: {
      userId: BigInt(userId),
      status: "ACTIVE",
      source: "SELF_SIGNUP",
      startedAt: now,
      expiresAt,
    },
    update: {
      status: "ACTIVE",
      source: "SELF_SIGNUP",
      startedAt: now,
      expiresAt,
      revokedAt: null,
      grantedByUserId: null,
    },
  });

  revalidatePath("/account/membership");
  return { ok: true, message: "สมัครสมาชิกเรียบร้อย — ใช้สิทธิ์เข้ารอบสมาชิกได้ทันที" };
}

/**
 * แอดมินให้สิทธิ์สมาชิก
 *
 * `durationDays = 0` หมายถึงไม่มีกำหนดหมดอายุ (expiresAt = null) ตามที่ lib/membership.ts ตีความ
 */
export async function grantMembership(input: {
  userId: string;
  durationDays: number;
}): Promise<MembershipActionResult> {
  const admin = await assertVerifiedAdmin();
  const adminId = (admin.user as { id?: string } | undefined)?.id;

  const parsed = z
    .object({
      userId: idSchema,
      durationDays: z
        .number()
        .int("จำนวนวันต้องเป็นจำนวนเต็ม")
        .min(0, "จำนวนวันติดลบไม่ได้")
        .max(3650, "จำนวนวันมากเกินไป"),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { userId, durationDays } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: BigInt(userId) },
    select: { id: true, email: true },
  });
  if (!user) return { ok: false, error: "ไม่พบผู้ใช้คนนี้" };

  const now = new Date();
  const expiresAt = durationDays === 0 ? null : addDays(now, durationDays);

  await prisma.membership.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      status: "ACTIVE",
      source: "ADMIN_GRANT",
      startedAt: now,
      expiresAt,
      grantedByUserId: adminId ? BigInt(adminId) : null,
    },
    update: {
      status: "ACTIVE",
      source: "ADMIN_GRANT",
      startedAt: now,
      expiresAt,
      revokedAt: null,
      grantedByUserId: adminId ? BigInt(adminId) : null,
    },
  });

  revalidatePath("/admin/members");
  return {
    ok: true,
    message: `ให้สิทธิ์สมาชิกกับ ${user.email} แล้ว${
      expiresAt ? ` (ถึง ${expiresAt.toLocaleDateString("th-TH")})` : " (ไม่มีกำหนดหมดอายุ)"
    }`,
  };
}

/**
 * แอดมินเพิกถอนสิทธิ์
 *
 * ไม่ลบแถวทิ้ง — เก็บไว้เป็นประวัติว่าเคยเป็นสมาชิกและถูกเพิกถอนเมื่อไหร่
 * (ต่างจาก "หมดอายุ" ที่ดูจาก expiresAt — ผู้ใช้ควรเห็นเหตุผลที่ต่างกันบนหน้าสถานะ)
 */
export async function revokeMembership(input: { userId: string }): Promise<MembershipActionResult> {
  await assertVerifiedAdmin();

  const parsed = z.object({ userId: idSchema }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const membership = await prisma.membership.findUnique({
    where: { userId: BigInt(parsed.data.userId) },
    include: { user: { select: { email: true } } },
  });
  if (!membership) return { ok: false, error: "ผู้ใช้คนนี้ไม่มีสิทธิ์สมาชิกอยู่แล้ว" };
  if (membership.status === "REVOKED") {
    return { ok: false, error: "สิทธิ์ถูกเพิกถอนไปแล้ว" };
  }

  await prisma.membership.update({
    where: { userId: membership.userId },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  revalidatePath("/admin/members");
  return { ok: true, message: `เพิกถอนสิทธิ์สมาชิกของ ${membership.user.email} แล้ว` };
}
