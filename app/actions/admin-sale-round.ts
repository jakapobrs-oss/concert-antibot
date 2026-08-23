"use server";

// ============================================================
// Sale round actions ฝั่งแอดมิน (Phase 2.1, docs/21)
// ============================================================
// ตั้งรอบขายต่อคอนเสิร์ต + ออกโค้ดสิทธิ์รอบพาร์ทเนอร์
// RBAC: middleware + (admin)/layout กันชั้นนึงแล้ว — ที่นี่ re-check role กับ DB จริง (F2)
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertVerifiedAdmin } from "@/lib/admin-guard";
import { normalizeCode } from "@/lib/access-code";

export type AdminRoundResult = { ok: true; message: string } | { ok: false; error: string };

const idSchema = z.string().regex(/^\d+$/, "id ไม่ถูกต้อง");

const roundSchema = z
  .object({
    concertId: idSchema,
    name: z.string().trim().min(1, "กรุณาตั้งชื่อรอบ").max(100),
    audience: z.enum(["FANCLUB", "PARTNER", "MEMBER_ONLY", "PUBLIC"]),
    startAt: z.string().min(1, "กรุณาระบุเวลาเริ่ม"),
    endAt: z.string().min(1, "กรุณาระบุเวลาจบ"),
    requiresPreRegistration: z.boolean().default(false),
    preRegisterStartAt: z.string().optional(),
    preRegisterEndAt: z.string().optional(),
    maxTicketsPerUser: z.number().int().min(0).max(20).nullable().default(null),
    seatQuota: z.number().int().min(0).max(100000).nullable().default(null),
  })
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), {
    message: "เวลาจบต้องหลังเวลาเริ่ม",
  });

async function requireAdmin(): Promise<boolean> {
  try {
    await assertVerifiedAdmin();
    return true;
  } catch {
    return false;
  }
}

function optionalDate(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createSaleRound(input: {
  concertId: string;
  name: string;
  audience: "FANCLUB" | "PARTNER" | "MEMBER_ONLY" | "PUBLIC";
  startAt: string;
  endAt: string;
  requiresPreRegistration?: boolean;
  preRegisterStartAt?: string;
  preRegisterEndAt?: string;
  maxTicketsPerUser?: number | null;
  seatQuota?: number | null;
}): Promise<AdminRoundResult> {
  if (!(await requireAdmin())) return { ok: false, error: "ต้องเป็นแอดมิน" };

  const parsed = roundSchema.safeParse({
    ...input,
    requiresPreRegistration: input.requiresPreRegistration ?? false,
    maxTicketsPerUser: input.maxTicketsPerUser ?? null,
    seatQuota: input.seatQuota ?? null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const d = parsed.data;

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(d.concertId) },
    select: { id: true },
  });
  if (!concert) return { ok: false, error: "ไม่พบคอนเสิร์ต" };

  await prisma.saleRound.create({
    data: {
      concertId: concert.id,
      name: d.name,
      audience: d.audience,
      startAt: new Date(d.startAt),
      endAt: new Date(d.endAt),
      requiresPreRegistration: d.requiresPreRegistration,
      // ปิดลงทะเบียนล่วงหน้า = ล้างหน้าต่างเวลาทิ้งเสมอ (กันค่าค้างจากฟอร์มติดไปกับรอบที่ไม่ได้ใช้)
      preRegisterStartAt: d.requiresPreRegistration ? optionalDate(d.preRegisterStartAt) : null,
      preRegisterEndAt: d.requiresPreRegistration ? optionalDate(d.preRegisterEndAt) : null,
      // 0 = ไม่จำกัด → เก็บเป็น null ให้ logic ฝั่งอ่านตีความง่าย
      maxTicketsPerUser: d.maxTicketsPerUser && d.maxTicketsPerUser > 0 ? d.maxTicketsPerUser : null,
      seatQuota: d.seatQuota && d.seatQuota > 0 ? d.seatQuota : null,
    },
  });

  revalidatePath(`/admin/concerts/${d.concertId}`);
  revalidatePath("/concerts");
  return { ok: true, message: "เพิ่มรอบขายแล้ว" };
}

export async function deleteSaleRound(input: { saleRoundId: string }): Promise<AdminRoundResult> {
  if (!(await requireAdmin())) return { ok: false, error: "ต้องเป็นแอดมิน" };

  const parsed = idSchema.safeParse(input.saleRoundId);
  if (!parsed.success) return { ok: false, error: "ไม่พบรอบขาย" };

  const round = await prisma.saleRound.findUnique({
    where: { id: BigInt(parsed.data) },
    select: { concertId: true, _count: { select: { orders: true } } },
  });
  if (!round) return { ok: false, error: "ไม่พบรอบขาย" };
  // มี order ผูกอยู่แล้ว = หลักฐานการขาย ห้ามลบทิ้ง (Order.saleRoundId เป็น SetNull ก็จริง แต่จะเสียที่มาของยอด)
  if (round._count.orders > 0) {
    return { ok: false, error: "รอบนี้มีคำสั่งซื้อผูกอยู่แล้ว ลบไม่ได้ (ปรับเวลาแทน)" };
  }

  await prisma.saleRound.delete({ where: { id: BigInt(parsed.data) } });

  revalidatePath(`/admin/concerts/${round.concertId}`);
  revalidatePath("/concerts");
  return { ok: true, message: "ลบรอบขายแล้ว" };
}

const codeSchema = z.object({
  saleRoundId: idSchema,
  code: z.string().trim().min(4, "โค้ดต้องยาวอย่างน้อย 4 ตัว").max(64),
  label: z.string().trim().max(100).optional(),
  maxUses: z.number().int().min(0).max(1000000).nullable().default(null),
  expiresAt: z.string().optional(),
});

export async function createAccessCode(input: {
  saleRoundId: string;
  code: string;
  label?: string;
  maxUses?: number | null;
  expiresAt?: string;
}): Promise<AdminRoundResult> {
  if (!(await requireAdmin())) return { ok: false, error: "ต้องเป็นแอดมิน" };

  const parsed = codeSchema.safeParse({ ...input, maxUses: input.maxUses ?? null });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const d = parsed.data;

  const round = await prisma.saleRound.findUnique({
    where: { id: BigInt(d.saleRoundId) },
    select: { concertId: true, audience: true },
  });
  if (!round) return { ok: false, error: "ไม่พบรอบขาย" };
  if (round.audience !== "PARTNER") {
    return { ok: false, error: "โค้ดสิทธิ์ใช้กับรอบพาร์ทเนอร์เท่านั้น" };
  }

  try {
    await prisma.accessCode.create({
      data: {
        saleRoundId: BigInt(d.saleRoundId),
        code: normalizeCode(d.code),
        label: d.label || null,
        maxUses: d.maxUses && d.maxUses > 0 ? d.maxUses : null,
        expiresAt: optionalDate(d.expiresAt),
      },
    });
  } catch {
    // code เป็น unique ทั้งระบบ — ชนแปลว่ามีคนใช้โค้ดนี้ไปแล้ว (อาจอยู่คนละงาน)
    return { ok: false, error: "โค้ดนี้ถูกใช้ไปแล้ว กรุณาตั้งโค้ดอื่น" };
  }

  revalidatePath(`/admin/concerts/${round.concertId}`);
  return { ok: true, message: "สร้างโค้ดสิทธิ์แล้ว" };
}

export async function deleteAccessCode(input: { accessCodeId: string }): Promise<AdminRoundResult> {
  if (!(await requireAdmin())) return { ok: false, error: "ต้องเป็นแอดมิน" };

  const parsed = idSchema.safeParse(input.accessCodeId);
  if (!parsed.success) return { ok: false, error: "ไม่พบโค้ด" };

  const code = await prisma.accessCode.findUnique({
    where: { id: BigInt(parsed.data) },
    select: { saleRound: { select: { concertId: true } } },
  });
  if (!code) return { ok: false, error: "ไม่พบโค้ด" };

  await prisma.accessCode.delete({ where: { id: BigInt(parsed.data) } });

  revalidatePath(`/admin/concerts/${code.saleRound.concertId}`);
  return { ok: true, message: "ลบโค้ดแล้ว" };
}

// ตั้ง "รอบมาตรฐานแบบผังคอนไทย" ในคลิกเดียว (Phase 2.3, docs/23)
//   รอบสมาชิกเปิดก่อน N วัน → พอจบก็ต่อด้วยรอบทั่วไปทันที (ไม่มีช่องว่างระหว่างรอบ)
//   ทำเป็นปุ่มสำเร็จรูปเพราะรูปแบบนี้คือสิ่งที่ผู้จัดใช้จริงเกือบทุกงาน — ไม่ควรให้กรอกฟอร์มยาว 2 รอบ
const standardSchema = z.object({
  concertId: idSchema,
  memberStartAt: z.string().min(1, "กรุณาระบุเวลาเริ่มรอบสมาชิก"),
  leadDays: z.number().int().min(1, "รอบสมาชิกต้องมาก่อนอย่างน้อย 1 วัน").max(14),
  publicDays: z.number().int().min(1).max(60).default(7),
  memberMaxTickets: z.number().int().min(0).max(20).nullable().default(null),
});

export async function createStandardRounds(input: {
  concertId: string;
  memberStartAt: string;
  leadDays: number;
  publicDays?: number;
  memberMaxTickets?: number | null;
}): Promise<AdminRoundResult> {
  if (!(await requireAdmin())) return { ok: false, error: "ต้องเป็นแอดมิน" };

  const parsed = standardSchema.safeParse({
    ...input,
    publicDays: input.publicDays ?? 7,
    memberMaxTickets: input.memberMaxTickets ?? null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const d = parsed.data;

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(d.concertId) },
    select: { id: true, _count: { select: { saleRounds: true } } },
  });
  if (!concert) return { ok: false, error: "ไม่พบคอนเสิร์ต" };
  if (concert._count.saleRounds > 0) {
    return { ok: false, error: "คอนเสิร์ตนี้มีรอบอยู่แล้ว — ลบรอบเดิมก่อน หรือเพิ่มทีละรอบเอง" };
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const memberStart = new Date(d.memberStartAt);
  if (Number.isNaN(memberStart.getTime())) return { ok: false, error: "เวลาเริ่มไม่ถูกต้อง" };
  // รอบสมาชิกจบตรงเวลาที่รอบทั่วไปเริ่มพอดี — ช่วงรอบเป็น [start, end) จึงไม่ทับกัน
  const publicStart = new Date(memberStart.getTime() + d.leadDays * DAY_MS);
  const publicEnd = new Date(publicStart.getTime() + d.publicDays * DAY_MS);

  await prisma.saleRound.createMany({
    data: [
      {
        concertId: concert.id,
        name: "รอบสมาชิก",
        audience: "MEMBER_ONLY",
        startAt: memberStart,
        endAt: publicStart,
        maxTicketsPerUser:
          d.memberMaxTickets && d.memberMaxTickets > 0 ? d.memberMaxTickets : null,
      },
      {
        concertId: concert.id,
        name: "รอบทั่วไป",
        audience: "PUBLIC",
        startAt: publicStart,
        endAt: publicEnd,
      },
    ],
  });

  revalidatePath(`/admin/concerts/${d.concertId}`);
  revalidatePath("/concerts");
  return {
    ok: true,
    message: `ตั้งรอบแล้ว — สมาชิกกดก่อน ${d.leadDays} วัน แล้วเปิดรอบทั่วไป`,
  };
}
