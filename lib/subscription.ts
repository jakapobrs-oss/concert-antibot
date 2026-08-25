// ============================================================
// Subscription — แพ็กเกจสมาชิก (Phase 2.2, docs/22)
// ============================================================
// แพ็กเกจ = ระดับสมาชิกที่มีอยู่ (มาตรฐาน/พรีเมียม) × ระยะเวลา (1/3/12 เดือน)
//   มาตรฐาน  → เข้ารอบสมาชิก (MEMBER_ONLY)
//   พรีเมียม → เข้ารอบแฟนคลับ (FANCLUB) ได้ด้วย  — ดู lib/sale-round.ts
//
// 🔑 แบ่งหน้าที่ให้ชัด (กันสองแหล่งความจริง):
//    Subscription = ประวัติการสมัครแต่ละรอบ (ledger)
//    Membership   = สิทธิ์ปัจจุบัน — **ด่านตรวจทุกจุดอ่านจากตารางนี้เท่านั้น**
//    ทุกครั้งที่สมัคร/ต่ออายุ จะเขียน 2 ที่ในทรานแซกชันเดียว (ledger + สถานะ) จึงไม่มีทางหลุดจากกัน
//
// 💰 สถานะเรื่องเงิน: รอบนี้ทีมเคาะว่า **ยังไม่เก็บเงินจริง** — ทุกแพ็กเกจราคา 0 บาท
//    โครงข้อมูลเก็บ priceAmount ไว้แล้ว (snapshot ราคา ณ ตอนสมัคร) เพื่อให้ต่อ PromptPay/EasySlip
//    ทีหลังได้โดยไม่ต้องแก้ตาราง — จุดที่ต้องเสียบคือ subscribeToPlan() (ดู docs/22 §6)
import { prisma } from "@/lib/prisma";
import {
  isIdentityVerified,
  isMembershipActive,
  membershipState,
  getMembershipView,
  MAX_PREPAID_MONTHS,
  monthsBetween,
  type MembershipTier,
  type MembershipView,
} from "@/lib/membership";

export type PlanCode =
  | "STANDARD_1M"
  | "STANDARD_3M"
  | "STANDARD_12M"
  | "PREMIUM_1M"
  | "PREMIUM_3M"
  | "PREMIUM_12M";

export type SubscriptionPlan = {
  code: PlanCode;
  tier: MembershipTier;
  months: number;
  /** ราคาป้าย (บาท) — 0 = ช่วงนี้ยังไม่เปิดเก็บเงินจริง */
  priceTHB: number;
  name: string;
  note: string;
};

// ราคาทั้งหมดเป็น 0 โดยตั้งใจ — เปลี่ยนตัวเลขตรงนี้ตอนเปิดเก็บเงินจริงได้เลย (ที่เหลือรองรับไว้แล้ว)
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    code: "STANDARD_1M",
    tier: "STANDARD",
    months: 1,
    priceTHB: 0,
    name: "มาตรฐาน 1 เดือน",
    note: "เข้ารอบสมาชิกได้",
  },
  {
    code: "STANDARD_3M",
    tier: "STANDARD",
    months: 3,
    priceTHB: 0,
    name: "มาตรฐาน 3 เดือน",
    note: "เข้ารอบสมาชิกได้",
  },
  {
    code: "STANDARD_12M",
    tier: "STANDARD",
    months: 12,
    priceTHB: 0,
    name: "มาตรฐาน 12 เดือน",
    note: "เข้ารอบสมาชิกได้ ยาวหนึ่งปี",
  },
  {
    code: "PREMIUM_1M",
    tier: "PREMIUM",
    months: 1,
    priceTHB: 0,
    name: "พรีเมียม 1 เดือน",
    note: "เข้ารอบแฟนคลับซึ่งเปิดก่อนรอบอื่น",
  },
  {
    code: "PREMIUM_3M",
    tier: "PREMIUM",
    months: 3,
    priceTHB: 0,
    name: "พรีเมียม 3 เดือน",
    note: "เข้ารอบแฟนคลับซึ่งเปิดก่อนรอบอื่น",
  },
  {
    code: "PREMIUM_12M",
    tier: "PREMIUM",
    months: 12,
    priceTHB: 0,
    name: "พรีเมียม 12 เดือน",
    note: "เข้ารอบแฟนคลับ ยาวหนึ่งปี",
  },
];

export function planByCode(code: string): SubscriptionPlan | null {
  return SUBSCRIPTION_PLANS.find((p) => p.code === code) ?? null;
}

// ------------------------------------------------------------
// ส่วนที่ 1: pure logic
// ------------------------------------------------------------

// บวกเดือนแบบ "หนีบสิ้นเดือน" — 31 ม.ค. + 1 เดือน = 28/29 ก.พ. ไม่ใช่ 3 มี.ค.
//   (ถ้าใช้ setMonth ตรง ๆ JS จะล้นไปเดือนถัดไป ทำให้รอบยาวเกินที่ผู้ใช้ซื้อ)
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

// ระดับหลังสมัคร — อัประดับมีผลทันที (ลดระดับถูกกันไว้ที่ canApplyPlan ตั้งแต่ต้นทาง)
export function resolveTierAfterPlan(
  currentTier: MembershipTier | null,
  planTier: MembershipTier,
  active: boolean
): MembershipTier {
  if (!active || currentTier === null) return planTier;
  return currentTier === "PREMIUM" || planTier === "PREMIUM" ? "PREMIUM" : "STANDARD";
}

// ช่วงเวลาของรอบใหม่ — ต่อท้ายรอบเดิมถ้าสิทธิ์ยังไม่หมด (วันที่เหลือไม่หาย)
export function nextPeriod(params: {
  months: number;
  currentExpiresAt: Date | null;
  active: boolean;
  now: Date;
}): { startedAt: Date; expiresAt: Date } {
  const stackable =
    params.active &&
    params.currentExpiresAt !== null &&
    params.currentExpiresAt.getTime() > params.now.getTime();
  const startedAt = stackable ? (params.currentExpiresAt as Date) : params.now;
  return { startedAt, expiresAt: addMonths(startedAt, params.months) };
}

export type PlanDenyReason =
  | "UNKNOWN_PLAN"
  | "REVOKED"
  | "NOT_VERIFIED"
  | "OVER_PREPAID_CAP"
  | "DOWNGRADE_BLOCKED";

export type PlanCheck = { ok: true } | { ok: false; reason: PlanDenyReason; message: string };

// ตัดสินว่า "สมัครแพ็กเกจนี้ตอนนี้ได้ไหม" — ใช้ทั้งฝั่งปุ่มบนหน้าจอและฝั่ง server ก่อนเขียน DB
export function canApplyPlan(params: {
  plan: SubscriptionPlan;
  state: "NONE" | "ACTIVE" | "EXPIRED" | "REVOKED";
  currentTier: MembershipTier | null;
  expiresAt: Date | null;
  now: Date;
}): PlanCheck {
  if (params.state === "REVOKED") {
    return {
      ok: false,
      reason: "REVOKED",
      message: "สิทธิ์สมาชิกของบัญชีนี้ถูกระงับ กรุณาติดต่อทีมงาน",
    };
  }

  const active = params.state === "ACTIVE";

  // ลดระดับระหว่างที่สิทธิ์พรีเมียมยังไม่หมด → กันไว้ ไม่ให้ผู้ใช้เผลอทิ้งสิทธิ์ที่ยังเหลือ
  if (active && params.currentTier === "PREMIUM" && params.plan.tier === "STANDARD") {
    return {
      ok: false,
      reason: "DOWNGRADE_BLOCKED",
      message: "คุณเป็นสมาชิกพรีเมียมอยู่ — เปลี่ยนเป็นแพ็กเกจมาตรฐานได้เมื่อรอบปัจจุบันหมดอายุ",
    };
  }

  // เพดานสมัครล่วงหน้า — กันกดรัวสะสมสิทธิ์ยาวเกินจริง (แพ็กเกจฟรีในช่วงนี้ยิ่งต้องมี)
  const remaining = active ? monthsBetween(params.now, params.expiresAt) : 0;
  if (remaining + params.plan.months > MAX_PREPAID_MONTHS) {
    return {
      ok: false,
      reason: "OVER_PREPAID_CAP",
      message: `สมัครล่วงหน้าได้ไม่เกิน ${MAX_PREPAID_MONTHS} เดือน (ตอนนี้เหลืออยู่แล้วประมาณ ${remaining} เดือน)`,
    };
  }

  return { ok: true };
}

// สถานะที่โชว์ในประวัติ — คำนวณสดจากเวลา ไม่ต้องมี cron มาปิดรอบ (แพทเทิร์นเดียวกับ Membership)
export type SubscriptionDisplayStatus = "ACTIVE" | "ENDED" | "CANCELLED";

export function subscriptionDisplayStatus(
  row: { status: "ACTIVE" | "ENDED" | "CANCELLED"; expiresAt: Date },
  now: Date
): SubscriptionDisplayStatus {
  if (row.status === "CANCELLED") return "CANCELLED";
  return row.expiresAt.getTime() > now.getTime() ? "ACTIVE" : "ENDED";
}

// ------------------------------------------------------------
// ส่วนที่ 2: อ่าน/เขียน DB
// ------------------------------------------------------------

export type SubscriptionView = {
  id: string;
  planCode: string;
  planName: string;
  tier: MembershipTier;
  months: number;
  priceTHB: number;
  status: SubscriptionDisplayStatus;
  startedAt: Date;
  expiresAt: Date;
  cancelledAt: Date | null;
};

function toView(
  row: {
    id: bigint;
    planCode: string;
    tier: MembershipTier;
    months: number;
    priceAmount: { toString(): string };
    status: "ACTIVE" | "ENDED" | "CANCELLED";
    startedAt: Date;
    expiresAt: Date;
    cancelledAt: Date | null;
  },
  now: Date
): SubscriptionView {
  return {
    id: row.id.toString(),
    planCode: row.planCode,
    planName: planByCode(row.planCode)?.name ?? row.planCode,
    tier: row.tier,
    months: row.months,
    priceTHB: Number(row.priceAmount.toString()),
    status: subscriptionDisplayStatus(row, now),
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    cancelledAt: row.cancelledAt,
  };
}

export type SubscribeResult =
  | { ok: true; subscription: SubscriptionView; membership: MembershipView }
  | { ok: false; error: string };

// ⭐ สมัคร/ต่ออายุแพ็กเกจ — เขียน ledger + สถานะสิทธิ์ในทรานแซกชันเดียว
export async function subscribeToPlan(params: {
  userId: string | bigint;
  planCode: string;
  now?: Date;
}): Promise<SubscribeResult> {
  const now = params.now ?? new Date();
  const userId = typeof params.userId === "bigint" ? params.userId : BigInt(params.userId);

  const plan = planByCode(params.planCode);
  if (!plan) return { ok: false, error: "ไม่พบแพ็กเกจนี้" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      emailVerified: true,
      _count: { select: { accounts: true } },
      membership: { select: { status: true, tier: true, expiresAt: true, startedAt: true } },
    },
  });
  if (!user) return { ok: false, error: "ไม่พบบัญชีผู้ใช้" };

  if (
    !isIdentityVerified({
      emailVerified: user.emailVerified,
      oauthAccountCount: user._count.accounts,
    })
  ) {
    return { ok: false, error: "กรุณายืนยันอีเมลก่อนสมัครสมาชิก" };
  }

  const state = membershipState(user.membership ?? null, now);
  const check = canApplyPlan({
    plan,
    state,
    currentTier: user.membership?.tier ?? null,
    expiresAt: user.membership?.expiresAt ?? null,
    now,
  });
  if (!check.ok) return { ok: false, error: check.message };

  const active = isMembershipActive(user.membership ?? null, now);
  const period = nextPeriod({
    months: plan.months,
    currentExpiresAt: user.membership?.expiresAt ?? null,
    active,
    now,
  });
  const tier = resolveTierAfterPlan(user.membership?.tier ?? null, plan.tier, active);

  const created = await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.create({
      data: {
        userId,
        planCode: plan.code,
        tier: plan.tier,
        months: plan.months,
        priceAmount: plan.priceTHB,
        status: "ACTIVE",
        startedAt: period.startedAt,
        expiresAt: period.expiresAt,
      },
    });

    await tx.membership.upsert({
      where: { userId },
      create: {
        userId,
        status: "ACTIVE",
        source: "SELF_SIGNUP",
        tier,
        startedAt: now,
        expiresAt: period.expiresAt,
      },
      update: {
        status: "ACTIVE",
        source: "SELF_SIGNUP",
        tier,
        expiresAt: period.expiresAt,
        revokedAt: null,
        grantedByUserId: null,
        // สิทธิ์ขาดไปแล้วค่อยกลับมาสมัคร = เริ่มนับความเป็นสมาชิกใหม่
        ...(active ? {} : { startedAt: now }),
      },
    });

    return sub;
  });

  return {
    ok: true,
    subscription: toView(created, now),
    membership: await getMembershipView(userId, now),
  };
}

export type CancelResult =
  | { ok: true; usableUntil: Date | null }
  | { ok: false; error: string };

// ยกเลิกการต่ออายุ — สิทธิ์ยังใช้ได้จนจบรอบที่สมัครไว้แล้ว (ไม่ตัดกลางคัน)
//   เหตุผลเดียวกับกติกา "ตรวจสิทธิ์ที่ขาเข้า" ใน docs/20: ไม่ยึดสิ่งที่ผู้ใช้ได้มาแล้วกลางทาง
export async function cancelSubscription(params: {
  userId: string | bigint;
  now?: Date;
}): Promise<CancelResult> {
  const now = params.now ?? new Date();
  const userId = typeof params.userId === "bigint" ? params.userId : BigInt(params.userId);

  const active = await prisma.subscription.findFirst({
    where: { userId, status: "ACTIVE", expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
    select: { id: true, expiresAt: true },
  });
  if (!active) return { ok: false, error: "ไม่มีแพ็กเกจที่กำลังใช้งานอยู่" };

  // ยกเลิกทุกใบที่ยังไม่หมดอายุ (เผื่อสมัครล่วงหน้าซ้อนไว้หลายรอบ)
  await prisma.subscription.updateMany({
    where: { userId, status: "ACTIVE", expiresAt: { gt: now } },
    data: { status: "CANCELLED", cancelledAt: now },
  });

  return { ok: true, usableUntil: active.expiresAt };
}

// แพ็กเกจที่กำลังใช้งานอยู่ (ใบที่หมดอายุช้าที่สุด) — null = ไม่มี
export async function currentSubscription(
  userId: string | bigint,
  now: Date = new Date()
): Promise<SubscriptionView | null> {
  const row = await prisma.subscription.findFirst({
    where: {
      userId: typeof userId === "bigint" ? userId : BigInt(userId),
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: "desc" },
  });
  return row ? toView(row, now) : null;
}

export async function subscriptionHistory(
  userId: string | bigint,
  now: Date = new Date(),
  take = 20
): Promise<SubscriptionView[]> {
  const rows = await prisma.subscription.findMany({
    where: { userId: typeof userId === "bigint" ? userId : BigInt(userId) },
    orderBy: { startedAt: "desc" },
    take,
  });
  return rows.map((r) => toView(r, now));
}

// แพ็กเกจพร้อมสถานะ "กดได้ไหม" สำหรับ render หน้าเลือกแพ็กเกจ
export type PlanOffer = SubscriptionPlan & { available: boolean; blockedReason: string | null };

export function buildPlanOffers(params: {
  state: "NONE" | "ACTIVE" | "EXPIRED" | "REVOKED";
  currentTier: MembershipTier | null;
  expiresAt: Date | null;
  now: Date;
}): PlanOffer[] {
  return SUBSCRIPTION_PLANS.map((plan) => {
    const check = canApplyPlan({ ...params, plan });
    return { ...plan, available: check.ok, blockedReason: check.ok ? null : check.message };
  });
}
