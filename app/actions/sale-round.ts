"use server";

// ============================================================
// Sale round actions ฝั่งผู้ใช้ (Phase 2.1, docs/21)
// ============================================================
//   - preRegisterForRound: กด "ลงทะเบียนล่วงหน้า" ของรอบ (แบบ Weverse) → ได้โค้ดปลดล็อก
//   - redeemRoundAccessCode: กรอกโค้ดสิทธิ์สปอนเซอร์/บัตรเครดิต → ปลดล็อกรอบพาร์ทเนอร์
// กติกา/ด่านตรวจอยู่ใน lib/ (unit test คลุมแล้ว) — ที่นี่ทำแค่ auth + validate + revalidate
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { preRegister } from "@/lib/pre-registration";
import { redeemAccessCode } from "@/lib/access-code";

const idSchema = z.string().regex(/^\d+$/, "ข้อมูลไม่ถูกต้อง");

async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export type PreRegisterActionResult =
  | { ok: true; code: string; already: boolean }
  | { ok: false; error: string };

export async function preRegisterForRound(input: {
  saleRoundId: string;
}): Promise<PreRegisterActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบ" };

  const parsed = idSchema.safeParse(input.saleRoundId);
  if (!parsed.success) return { ok: false, error: "ไม่พบรอบขายนี้" };

  const res = await preRegister({ userId, saleRoundId: parsed.data });
  if (!res.ok) return res;

  revalidatePath("/concerts");
  return { ok: true, code: res.code, already: res.already };
}

export type RedeemActionResult =
  | { ok: true; roundName: string; already: boolean }
  | { ok: false; error: string };

// กรอกโค้ดผิดรัว ๆ = การเดาโค้ด → จำกัดอัตราต่อ user (โค้ดสั้นกว่ารหัสผ่านมาก จึงเดาง่ายกว่า)
const CODE_RL = { limit: 10, windowMs: 10 * 60_000 };

export async function redeemRoundAccessCode(input: {
  concertId: string;
  code: string;
}): Promise<RedeemActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบ" };

  const parsed = idSchema.safeParse(input.concertId);
  if (!parsed.success) return { ok: false, error: "ไม่พบคอนเสิร์ต" };
  if (typeof input.code !== "string" || input.code.trim().length === 0) {
    return { ok: false, error: "กรุณากรอกโค้ด" };
  }
  if (input.code.length > 64) return { ok: false, error: "โค้ดไม่ถูกต้อง" };

  const rl = await checkRateLimit({ key: `access_code:user:${userId}`, ...CODE_RL });
  if (!rl.allowed) {
    return { ok: false, error: "กรอกโค้ดผิดหลายครั้งเกินไป กรุณารอสักครู่" };
  }

  const res = await redeemAccessCode({ userId, concertId: parsed.data, code: input.code });
  if (!res.ok) return res;

  revalidatePath("/concerts");
  return { ok: true, roundName: res.roundName, already: res.already };
}
