"use server";

// ============================================================
// Server Actions — รอบกดบัตร (Phase 2)
// ============================================================
// แอดมินตั้งรอบให้คอนเสิร์ต เช่น "รอบสมาชิก 19:00-19:30" แล้ว "รอบทั่วไป 19:30-21:00"
//
// ตรรกะการตัดสินสิทธิ์อยู่ที่ lib/sale-round.ts (pure, มีเทสหน่วยคุม)
// ไฟล์นี้รับผิดชอบแค่ สิทธิ์แอดมิน + ตรวจ input + เขียนฐานข้อมูล
//
// ⚠️ ไม่มีการลบรอบที่มีคำสั่งซื้อผูกอยู่แบบทำลายข้อมูล — Order.saleRoundId ตั้งเป็น SetNull
//    ตอนลบรอบ (ดู schema) คำสั่งซื้อเดิมจึงไม่หาย แค่เสียข้อมูลว่ามาจากรอบไหน
//    จึงเตือนแอดมินก่อนลบรอบที่มีคนซื้อไปแล้ว
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { assertVerifiedAdmin } from "@/lib/admin-guard";
import { validateRoundWindow } from "@/lib/sale-round";

export type SaleRoundActionResult = { ok: true; message: string } | { ok: false; error: string };

const idSchema = z.string().regex(/^\d+$/, "รหัสไม่ถูกต้อง");

// เพดานจำนวนรอบต่อคอนเสิร์ต — กันตั้งรอบเป็นร้อยจนหน้าจอและด่านช้า
const MAX_ROUNDS_PER_CONCERT = 20;

const roundInputSchema = z.object({
  concertId: idSchema,
  name: z.string().trim().min(1, "ต้องตั้งชื่อรอบ").max(100, "ชื่อรอบยาวเกินไป"),
  audience: z.enum(["MEMBER_ONLY", "PUBLIC"], { errorMap: () => ({ message: "ประเภทรอบไม่ถูกต้อง" }) }),
  // รับเป็นสตริงจาก <input type="datetime-local"> แล้วแปลงเอง
  startAt: z.string().min(1, "ต้องระบุเวลาเปิดรอบ"),
  endAt: z.string().min(1, "ต้องระบุเวลาปิดรอบ"),
});

/** สร้างรอบใหม่ */
export async function createSaleRound(input: {
  concertId: string;
  name: string;
  audience: "MEMBER_ONLY" | "PUBLIC";
  startAt: string;
  endAt: string;
}): Promise<SaleRoundActionResult> {
  await assertVerifiedAdmin();

  const parsed = roundInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { concertId, name, audience } = parsed.data;

  const startAt = new Date(parsed.data.startAt);
  const endAt = new Date(parsed.data.endAt);
  const windowError = validateRoundWindow(startAt, endAt);
  if (windowError) return { ok: false, error: windowError };

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(concertId) },
    select: { id: true },
  });
  if (!concert) return { ok: false, error: "ไม่พบคอนเสิร์ตนี้" };

  const existingCount = await prisma.saleRound.count({ where: { concertId: concert.id } });
  if (existingCount >= MAX_ROUNDS_PER_CONCERT) {
    return { ok: false, error: `ตั้งรอบได้สูงสุด ${MAX_ROUNDS_PER_CONCERT} รอบต่อคอนเสิร์ต` };
  }

  await prisma.saleRound.create({
    data: { concertId: concert.id, name, audience, startAt, endAt },
  });

  revalidatePath(`/admin/concerts/${concertId}/rounds`);
  revalidatePath(`/admin/concerts/${concertId}`);
  return { ok: true, message: `เพิ่ม "${name}" แล้ว` };
}

/** แก้ไขรอบเดิม */
export async function updateSaleRound(input: {
  roundId: string;
  concertId: string;
  name: string;
  audience: "MEMBER_ONLY" | "PUBLIC";
  startAt: string;
  endAt: string;
}): Promise<SaleRoundActionResult> {
  await assertVerifiedAdmin();

  const parsed = roundInputSchema.extend({ roundId: idSchema }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { roundId, concertId, name, audience } = parsed.data;

  const startAt = new Date(parsed.data.startAt);
  const endAt = new Date(parsed.data.endAt);
  const windowError = validateRoundWindow(startAt, endAt);
  if (windowError) return { ok: false, error: windowError };

  const round = await prisma.saleRound.findUnique({
    where: { id: BigInt(roundId) },
    select: { id: true, concertId: true },
  });
  if (!round) return { ok: false, error: "ไม่พบรอบนี้" };
  // กันยิงข้ามคอนเสิร์ต — รหัสรอบเดาได้ ถ้าไม่เช็คจะแก้รอบของคอนเสิร์ตอื่นได้
  if (round.concertId !== BigInt(concertId)) {
    return { ok: false, error: "รอบนี้ไม่ได้อยู่ในคอนเสิร์ตนี้" };
  }

  await prisma.saleRound.update({
    where: { id: round.id },
    data: { name, audience, startAt, endAt },
  });

  revalidatePath(`/admin/concerts/${concertId}/rounds`);
  return { ok: true, message: `แก้ไข "${name}" แล้ว` };
}

/** ลบรอบ */
export async function deleteSaleRound(input: {
  roundId: string;
  concertId: string;
}): Promise<SaleRoundActionResult> {
  await assertVerifiedAdmin();

  const parsed = z.object({ roundId: idSchema, concertId: idSchema }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { roundId, concertId } = parsed.data;

  const round = await prisma.saleRound.findUnique({
    where: { id: BigInt(roundId) },
    select: { id: true, name: true, concertId: true, _count: { select: { orders: true } } },
  });
  if (!round) return { ok: false, error: "ไม่พบรอบนี้" };
  if (round.concertId !== BigInt(concertId)) {
    return { ok: false, error: "รอบนี้ไม่ได้อยู่ในคอนเสิร์ตนี้" };
  }
  // มีคนซื้อไปแล้วในรอบนี้ — ลบได้แต่จะเสียข้อมูลว่ายอดขายมาจากรอบไหน จึงกันไว้ก่อน
  // (คำสั่งซื้อและตั๋วไม่หาย เพราะ Order.saleRoundId เป็น SetNull ไม่ใช่ Cascade)
  if (round._count.orders > 0) {
    return {
      ok: false,
      error: `ลบไม่ได้ — มีคำสั่งซื้อ ${round._count.orders} รายการเกิดในรอบนี้ (แก้เวลารอบแทนได้)`,
    };
  }

  await prisma.saleRound.delete({ where: { id: round.id } });

  revalidatePath(`/admin/concerts/${concertId}/rounds`);
  return { ok: true, message: `ลบ "${round.name}" แล้ว` };
}
