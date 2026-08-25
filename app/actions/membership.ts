"use server";

// ============================================================
// Membership / Subscription actions ฝั่งผู้ใช้ (Phase 2.2, docs/22)
// ============================================================
// สมัคร/ต่ออายุ "แพ็กเกจสมาชิก" + ยกเลิกการต่ออายุ
//   💰 รอบนี้ยังไม่เก็บเงินจริง (ทีมเคาะ 2026-08-20) — ทุกแพ็กเกจราคา 0 บาท
//      จุดเสียบระบบจ่ายเงินอยู่ที่ subscribeToPlan() ใน lib/subscription.ts (ดู docs/22 §6)
// กติกา/ด่านตรวจทั้งหมดอยู่ใน lib/ (unit test คลุมแล้ว) — ที่นี่ทำแค่ auth + validate + revalidate
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { subscribeToPlan, cancelSubscription } from "@/lib/subscription";

const planSchema = z.string().trim().min(1).max(40);

async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export type SubscribeActionResult =
  | { ok: true; planName: string; expiresAt: string }
  | { ok: false; error: string };

export async function subscribeToPlanAction(input: {
  planCode: string;
}): Promise<SubscribeActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบ" };

  const parsed = planSchema.safeParse(input.planCode);
  if (!parsed.success) return { ok: false, error: "ไม่พบแพ็กเกจนี้" };

  const res = await subscribeToPlan({ userId, planCode: parsed.data });
  if (!res.ok) return res;

  revalidatePath("/account/membership");
  return {
    ok: true,
    planName: res.subscription.planName,
    expiresAt: res.subscription.expiresAt.toISOString(),
  };
}

export type CancelActionResult =
  | { ok: true; usableUntil: string | null }
  | { ok: false; error: string };

export async function cancelSubscriptionAction(): Promise<CancelActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบ" };

  const res = await cancelSubscription({ userId });
  if (!res.ok) return res;

  revalidatePath("/account/membership");
  return { ok: true, usableUntil: res.usableUntil ? res.usableUntil.toISOString() : null };
}
