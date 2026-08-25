// Unit tests — แพ็กเกจสมาชิก / ซับสคริปชั่น (Phase 2.2, docs/22)
// เน้นเรื่องที่พังแล้วผู้ใช้เสียของ: วันหมดอายุที่ต่อท้ายผิด, ระดับสมาชิกถูกลดเงียบ ๆ, สะสมสิทธิ์ไม่จำกัด
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => {
  const base = {
    membership: { findUnique: vi.fn(), upsert: vi.fn() },
    user: { findUnique: vi.fn() },
    subscription: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { db: base };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  SUBSCRIPTION_PLANS,
  planByCode,
  addMonths,
  nextPeriod,
  resolveTierAfterPlan,
  canApplyPlan,
  subscriptionDisplayStatus,
  buildPlanOffers,
  subscribeToPlan,
  cancelSubscription,
} from "@/lib/subscription";
import { MAX_PREPAID_MONTHS } from "@/lib/membership";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-08-20T12:00:00+07:00");
const past = new Date(now.getTime() - DAY);

const PREMIUM_12M = planByCode("PREMIUM_12M")!;
const STANDARD_1M = planByCode("STANDARD_1M")!;
const STANDARD_12M = planByCode("STANDARD_12M")!;

beforeEach(() => {
  vi.clearAllMocks();
  db.membership.findUnique.mockResolvedValue(null);
  db.subscription.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 1n,
    priceAmount: { toString: () => String(data.priceAmount ?? 0) },
    cancelledAt: null,
    ...data,
  }));
  // ให้ tx เป็นตัวเดียวกับ db — เทสจะได้ตรวจ call ได้ตรง ๆ
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
});

// ============================================================
// 1. แพ็กเกจ
// ============================================================
describe("SUBSCRIPTION_PLANS — แพ็กเกจผูกกับระดับสมาชิกที่มีอยู่", () => {
  it("มีครบทั้ง 2 ระดับ × 3 ระยะเวลา", () => {
    expect(SUBSCRIPTION_PLANS).toHaveLength(6);
    expect(SUBSCRIPTION_PLANS.filter((p) => p.tier === "PREMIUM")).toHaveLength(3);
    expect(SUBSCRIPTION_PLANS.map((p) => p.months)).toEqual([1, 3, 12, 1, 3, 12]);
  });

  it("💰 ช่วงนี้ยังไม่เก็บเงิน — ทุกแพ็กเกจราคา 0 (ถ้าจะเปิดเก็บเงินต้องแก้ที่เดียว)", () => {
    expect(SUBSCRIPTION_PLANS.every((p) => p.priceTHB === 0)).toBe(true);
  });

  it("รหัสแพ็กเกจไม่ซ้ำ + หาไม่เจอคืน null", () => {
    const codes = new Set(SUBSCRIPTION_PLANS.map((p) => p.code));
    expect(codes.size).toBe(SUBSCRIPTION_PLANS.length);
    expect(planByCode("NOT_A_PLAN")).toBeNull();
  });
});

// ============================================================
// 2. คณิตของรอบเวลา
// ============================================================
describe("addMonths — บวกเดือนแบบหนีบสิ้นเดือน", () => {
  it("กลางเดือนปกติ", () => {
    expect(addMonths(new Date("2026-08-20T12:00:00+07:00"), 1).getDate()).toBe(20);
  });

  it("🔑 31 ม.ค. + 1 เดือน → 28 ก.พ. (ไม่ล้นไป 3 มี.ค. แบบ setMonth ตรง ๆ)", () => {
    const got = addMonths(new Date(2026, 0, 31), 1);
    expect(got.getMonth()).toBe(1); // กุมภาพันธ์
    expect(got.getDate()).toBe(28);
  });

  it("ปีอธิกสุรทิน: 31 ม.ค. 2028 + 1 เดือน → 29 ก.พ.", () => {
    const got = addMonths(new Date(2028, 0, 31), 1);
    expect(got.getDate()).toBe(29);
  });

  it("12 เดือน = ข้ามปี", () => {
    const got = addMonths(new Date(2026, 7, 20), 12);
    expect(got.getFullYear()).toBe(2027);
    expect(got.getMonth()).toBe(7);
  });
});

describe("nextPeriod — ต่ออายุแล้ววันที่เหลือต้องไม่หาย", () => {
  const currentExpiry = new Date(now.getTime() + 10 * DAY);

  it("ยังไม่หมดอายุ → รอบใหม่เริ่มตรงวันที่รอบเก่าจบ (ไม่ทับกัน ไม่เสียวัน)", () => {
    const got = nextPeriod({ months: 1, currentExpiresAt: currentExpiry, active: true, now });
    expect(got.startedAt).toEqual(currentExpiry);
    expect(got.expiresAt).toEqual(addMonths(currentExpiry, 1));
  });

  it("หมดอายุแล้ว → เริ่มนับใหม่จากวันนี้", () => {
    const got = nextPeriod({ months: 3, currentExpiresAt: past, active: false, now });
    expect(got.startedAt).toEqual(now);
    expect(got.expiresAt).toEqual(addMonths(now, 3));
  });

  it("ยังไม่เคยสมัคร → เริ่มจากวันนี้", () => {
    const got = nextPeriod({ months: 12, currentExpiresAt: null, active: false, now });
    expect(got.startedAt).toEqual(now);
  });
});

describe("resolveTierAfterPlan — อัประดับมีผลทันที", () => {
  it("มาตรฐานอยู่ แล้วซื้อพรีเมียม → เป็นพรีเมียมทันที", () => {
    expect(resolveTierAfterPlan("STANDARD", "PREMIUM", true)).toBe("PREMIUM");
  });

  it("🔑 พรีเมียมอยู่ แล้วซื้อมาตรฐานต่อท้าย → ยังเป็นพรีเมียม (ไม่ถูกลดเงียบ ๆ)", () => {
    expect(resolveTierAfterPlan("PREMIUM", "STANDARD", true)).toBe("PREMIUM");
  });

  it("สิทธิ์ขาดไปแล้ว → ใช้ระดับของแพ็กเกจใหม่ล้วน", () => {
    expect(resolveTierAfterPlan("PREMIUM", "STANDARD", false)).toBe("STANDARD");
  });

  it("ไม่เคยเป็นสมาชิก → ใช้ระดับของแพ็กเกจ", () => {
    expect(resolveTierAfterPlan(null, "PREMIUM", false)).toBe("PREMIUM");
  });
});

// ============================================================
// 3. กติกาว่าสมัครแพ็กเกจนี้ได้ไหม
// ============================================================
describe("canApplyPlan — ด่านก่อนเขียน DB", () => {
  it("ยังไม่เป็นสมาชิก → สมัครได้ทุกแพ็กเกจ", () => {
    for (const plan of SUBSCRIPTION_PLANS) {
      expect(canApplyPlan({ plan, state: "NONE", currentTier: null, expiresAt: null, now }).ok).toBe(
        true
      );
    }
  });

  it("❌ ถูกเพิกถอน → สมัครเองไม่ได้ทุกแพ็กเกจ", () => {
    const res = canApplyPlan({
      plan: STANDARD_1M,
      state: "REVOKED",
      currentTier: "STANDARD",
      expiresAt: new Date(now.getTime() + 30 * DAY),
      now,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("REVOKED");
  });

  it("❌ เป็นพรีเมียมอยู่ แล้วกดแพ็กเกจมาตรฐาน → กันไว้ (ไม่ให้เผลอทิ้งสิทธิ์ที่เหลือ)", () => {
    const res = canApplyPlan({
      plan: STANDARD_12M,
      state: "ACTIVE",
      currentTier: "PREMIUM",
      expiresAt: new Date(now.getTime() + 30 * DAY),
      now,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("DOWNGRADE_BLOCKED");
  });

  it("พรีเมียมหมดอายุแล้ว → กลับมาเลือกแพ็กเกจมาตรฐานได้", () => {
    expect(
      canApplyPlan({ plan: STANDARD_12M, state: "EXPIRED", currentTier: "PREMIUM", expiresAt: past, now })
        .ok
    ).toBe(true);
  });

  it("มาตรฐานอยู่ แล้วอัปเป็นพรีเมียม → ได้", () => {
    expect(
      canApplyPlan({
        plan: PREMIUM_12M,
        state: "ACTIVE",
        currentTier: "STANDARD",
        expiresAt: new Date(now.getTime() + 30 * DAY),
        now,
      }).ok
    ).toBe(true);
  });

  it(`❌ สะสมเกินเพดาน ${MAX_PREPAID_MONTHS} เดือน → ปฏิเสธ (กันกดรัวเพราะตอนนี้ฟรี)`, () => {
    const far = new Date(now.getTime() + 20 * 30 * DAY); // เหลืออยู่ ~20 เดือน
    const res = canApplyPlan({
      plan: PREMIUM_12M,
      state: "ACTIVE",
      currentTier: "PREMIUM",
      expiresAt: far,
      now,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("OVER_PREPAID_CAP");
  });
});

describe("buildPlanOffers — การ์ดแพ็กเกจบนหน้าจอต้องบอกเหตุผลตอนกดไม่ได้", () => {
  it("พรีเมียมอยู่ → การ์ดมาตรฐานถูกปิดพร้อมเหตุผล ส่วนพรีเมียมยังกดได้", () => {
    const offers = buildPlanOffers({
      state: "ACTIVE",
      currentTier: "PREMIUM",
      expiresAt: new Date(now.getTime() + 30 * DAY),
      now,
    });
    const std = offers.filter((o) => o.tier === "STANDARD");
    const prm = offers.filter((o) => o.tier === "PREMIUM");
    expect(std.every((o) => !o.available && o.blockedReason)).toBe(true);
    expect(prm.every((o) => o.available)).toBe(true);
  });
});

describe("subscriptionDisplayStatus — คำนวณสด ไม่ต้องมี cron ปิดรอบ", () => {
  const base = { status: "ACTIVE" as const, expiresAt: new Date(now.getTime() + DAY) };

  it("ยังไม่ถึงวันสิ้นสุด → ใช้งานอยู่", () => {
    expect(subscriptionDisplayStatus(base, now)).toBe("ACTIVE");
  });
  it("เลยวันสิ้นสุด → จบรอบแล้ว (แม้ status ใน DB ยัง ACTIVE)", () => {
    expect(subscriptionDisplayStatus({ ...base, expiresAt: past }, now)).toBe("ENDED");
  });
  it("ยกเลิกแล้ว → ยกเลิก (ชนะเงื่อนไขเวลา)", () => {
    expect(subscriptionDisplayStatus({ ...base, status: "CANCELLED" }, now)).toBe("CANCELLED");
  });
});

// ============================================================
// 4. DB — สมัคร/ยกเลิก
// ============================================================
describe("subscribeToPlan — เขียน ledger + สถานะสิทธิ์ในทรานแซกชันเดียว", () => {
  it("สมัครครั้งแรก → สร้าง Subscription และตั้ง Membership ให้ตรงกัน", async () => {
    db.user.findUnique.mockResolvedValue({
      emailVerified: past,
      _count: { accounts: 0 },
      membership: null,
    });

    const res = await subscribeToPlan({ userId: "42", planCode: "PREMIUM_12M", now });

    expect(res.ok).toBe(true);
    const sub = db.subscription.create.mock.calls[0][0].data;
    expect(sub.planCode).toBe("PREMIUM_12M");
    expect(sub.tier).toBe("PREMIUM");
    expect(sub.months).toBe(12);
    expect(sub.startedAt).toEqual(now);
    expect(sub.expiresAt).toEqual(addMonths(now, 12));

    const mem = db.membership.upsert.mock.calls[0][0];
    expect(mem.where).toEqual({ userId: 42n });
    expect(mem.create.tier).toBe("PREMIUM");
    // 🔑 วันหมดอายุของ Membership ต้องตรงกับรอบที่เพิ่งสร้าง ไม่งั้นสองแหล่งความจริงจะขัดกัน
    expect(mem.create.expiresAt).toEqual(sub.expiresAt);
  });

  it("ต่ออายุตอนยังไม่หมด → รอบใหม่ต่อท้าย และ Membership ขยับตาม", async () => {
    const currentExpiry = new Date(now.getTime() + 10 * DAY);
    db.user.findUnique.mockResolvedValue({
      emailVerified: past,
      _count: { accounts: 0 },
      membership: { status: "ACTIVE", tier: "STANDARD", expiresAt: currentExpiry, startedAt: past },
    });

    await subscribeToPlan({ userId: "42", planCode: "STANDARD_1M", now });

    const sub = db.subscription.create.mock.calls[0][0].data;
    expect(sub.startedAt).toEqual(currentExpiry);
    expect(sub.expiresAt).toEqual(addMonths(currentExpiry, 1));
    const update = db.membership.upsert.mock.calls[0][0].update;
    expect(update.expiresAt).toEqual(sub.expiresAt);
    expect(update.startedAt).toBeUndefined(); // ยัง active → ไม่รีเซ็ตวันเริ่มเป็นสมาชิก
  });

  it("อัประดับเป็นพรีเมียมระหว่างรอบ → ระดับเปลี่ยนทันที", async () => {
    db.user.findUnique.mockResolvedValue({
      emailVerified: past,
      _count: { accounts: 0 },
      membership: {
        status: "ACTIVE",
        tier: "STANDARD",
        expiresAt: new Date(now.getTime() + 10 * DAY),
        startedAt: past,
      },
    });

    await subscribeToPlan({ userId: "42", planCode: "PREMIUM_3M", now });

    expect(db.membership.upsert.mock.calls[0][0].update.tier).toBe("PREMIUM");
  });

  it("❌ ยังไม่ยืนยันอีเมล → ไม่เขียนอะไรเลย", async () => {
    db.user.findUnique.mockResolvedValue({
      emailVerified: null,
      _count: { accounts: 0 },
      membership: null,
    });

    const res = await subscribeToPlan({ userId: "42", planCode: "STANDARD_1M", now });

    expect(res).toEqual({ ok: false, error: "กรุณายืนยันอีเมลก่อนสมัครสมาชิก" });
    expect(db.subscription.create).not.toHaveBeenCalled();
    expect(db.membership.upsert).not.toHaveBeenCalled();
  });

  it("❌ แพ็กเกจไม่มีจริง → ปฏิเสธก่อนแตะ DB", async () => {
    const res = await subscribeToPlan({ userId: "42", planCode: "GOLD_100Y", now });
    expect(res).toEqual({ ok: false, error: "ไม่พบแพ็กเกจนี้" });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("❌ ถูกเพิกถอน → สมัครแพ็กเกจใหม่เองไม่ได้", async () => {
    db.user.findUnique.mockResolvedValue({
      emailVerified: past,
      _count: { accounts: 0 },
      membership: {
        status: "REVOKED",
        tier: "STANDARD",
        expiresAt: new Date(now.getTime() + 30 * DAY),
        startedAt: past,
      },
    });

    const res = await subscribeToPlan({ userId: "42", planCode: "STANDARD_1M", now });

    expect(res.ok).toBe(false);
    expect(db.subscription.create).not.toHaveBeenCalled();
  });
});

describe("cancelSubscription — ยกเลิกแล้วสิทธิ์ต้องไม่ถูกตัดกลางคัน", () => {
  it("ยกเลิกรอบที่ยังไม่หมด → ตั้ง CANCELLED แต่ไม่แตะ Membership", async () => {
    const expiresAt = new Date(now.getTime() + 20 * DAY);
    db.subscription.findFirst.mockResolvedValue({ id: 7n, expiresAt });
    db.subscription.updateMany.mockResolvedValue({ count: 1 });

    const res = await cancelSubscription({ userId: "42", now });

    expect(res).toEqual({ ok: true, usableUntil: expiresAt });
    expect(db.subscription.updateMany).toHaveBeenCalledWith({
      where: { userId: 42n, status: "ACTIVE", expiresAt: { gt: now } },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    // 🔑 สิทธิ์ที่ได้มาแล้วห้ามถูกยึดกลางทาง (กติกาเดียวกับ docs/20 §5)
    expect(db.membership.upsert).not.toHaveBeenCalled();
  });

  it("❌ ไม่มีแพ็กเกจที่ใช้งานอยู่ → error ไม่เขียน DB", async () => {
    db.subscription.findFirst.mockResolvedValue(null);

    const res = await cancelSubscription({ userId: "42", now });

    expect(res).toEqual({ ok: false, error: "ไม่มีแพ็กเกจที่กำลังใช้งานอยู่" });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });
});
