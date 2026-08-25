// Unit tests — สมาชิก (Phase 2, docs/20)
//   ส่วน pure: สถานะ/วันหมดอายุ/ด่านตรวจ — เทสตรง ๆ
//   ส่วน DB: mock @/lib/prisma (แพทเทิร์นเดียวกับ cron-sweep.test.ts) เพื่อคุมเวลา + ไม่ต้องมี Postgres
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    membership: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  MEMBERSHIP_DEFAULT_DAYS,
  isMembershipActive,
  membershipState,
  nextExpiresAt,
  daysLeft,
  canStartNewPeriod,
  monthsBetween,
  MAX_PREPAID_MONTHS,
  requiresActiveMembership,
  isIdentityVerified,
  getActiveMembership,
  isActiveMember,
  getMembershipView,
  selfSignupMembership,
  grantMembership,
  revokeMembership,
} from "@/lib/membership";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-08-20T12:00:00+07:00");
const future = new Date(now.getTime() + 30 * DAY);
const past = new Date(now.getTime() - 1 * DAY);

beforeEach(() => {
  vi.clearAllMocks();
  // ค่า default ให้ getMembershipView ที่ถูกเรียกท้าย write action ไม่ระเบิด
  db.membership.findUnique.mockResolvedValue(null);
});

// ============================================================
// 1. pure — สถานะสมาชิก
// ============================================================
describe("isMembershipActive — หมดอายุคำนวณสดจาก expiresAt (ไม่มี cron มาพลิก status)", () => {
  it("ACTIVE + ยังไม่ถึงวันหมดอายุ → เป็นสมาชิก", () => {
    expect(isMembershipActive({ status: "ACTIVE", expiresAt: future }, now)).toBe(true);
  });

  it("ACTIVE + ไม่มีวันหมดอายุ (null) → เป็นสมาชิก", () => {
    expect(isMembershipActive({ status: "ACTIVE", expiresAt: null }, now)).toBe(true);
  });

  it("❌ ACTIVE แต่เลยวันหมดอายุแล้ว → ไม่ใช่สมาชิก (นี่คือบั๊กที่ระบบ status EXPIRED มักพลาด)", () => {
    expect(isMembershipActive({ status: "ACTIVE", expiresAt: past }, now)).toBe(false);
  });

  it("ขอบเขต: expiresAt = now เป๊ะ → หมดแล้ว (ช่วงสิทธิ์เป็นปลายเปิด)", () => {
    expect(isMembershipActive({ status: "ACTIVE", expiresAt: now }, now)).toBe(false);
    expect(isMembershipActive({ status: "ACTIVE", expiresAt: new Date(now.getTime() + 1) }, now)).toBe(true);
  });

  it("❌ ถูกเพิกถอน (REVOKED) → ไม่ใช่สมาชิก ต่อให้ยังไม่ถึงวันหมดอายุ", () => {
    expect(isMembershipActive({ status: "REVOKED", expiresAt: future }, now)).toBe(false);
  });

  it("ไม่มีแถวเลย (null) → ไม่ใช่สมาชิก", () => {
    expect(isMembershipActive(null, now)).toBe(false);
  });
});

describe("membershipState — สถานะที่หน้าจอต้องแยกให้ออก", () => {
  it("ยังไม่เคยสมัคร → NONE", () => {
    expect(membershipState(null, now)).toBe("NONE");
  });
  it("ยังไม่หมด → ACTIVE", () => {
    expect(membershipState({ status: "ACTIVE", expiresAt: future }, now)).toBe("ACTIVE");
  });
  it("เลยวันหมดอายุ → EXPIRED (ต่ออายุเองได้)", () => {
    expect(membershipState({ status: "ACTIVE", expiresAt: past }, now)).toBe("EXPIRED");
  });
  it("ถูกเพิกถอน → REVOKED (ต่างจากหมดอายุ: สมัครเองใหม่ไม่ได้)", () => {
    expect(membershipState({ status: "REVOKED", expiresAt: future }, now)).toBe("REVOKED");
  });
});

// ============================================================
// 2. pure — คำนวณวันหมดอายุตอนสมัคร/ต่ออายุ
// ============================================================
describe("nextExpiresAt — ต่ออายุแล้ววันที่เหลือต้องไม่หาย", () => {
  it("ยัง active อยู่ → ต่อท้ายของเดิม (30 วันที่เหลือ + 365)", () => {
    const got = nextExpiresAt({ current: future, days: 365, now, active: true });
    expect(got?.getTime()).toBe(future.getTime() + 365 * DAY);
  });

  it("หมดอายุไปแล้ว → เริ่มนับใหม่จากวันนี้ (ไม่ย้อนไปต่อจากอดีต)", () => {
    const got = nextExpiresAt({ current: past, days: 365, now, active: false });
    expect(got?.getTime()).toBe(now.getTime() + 365 * DAY);
  });

  it("ยังไม่เคยสมัคร (current = null) → นับจากวันนี้", () => {
    const got = nextExpiresAt({ current: null, days: MEMBERSHIP_DEFAULT_DAYS, now });
    expect(got?.getTime()).toBe(now.getTime() + MEMBERSHIP_DEFAULT_DAYS * DAY);
  });

  it("days <= 0 → null = ไม่มีวันหมดอายุ (แอดมินเท่านั้น)", () => {
    expect(nextExpiresAt({ current: null, days: 0, now })).toBeNull();
    expect(nextExpiresAt({ current: future, days: -5, now })).toBeNull();
  });

  it("active = false บังคับให้เริ่มจากวันนี้ แม้ current จะยังอยู่ในอนาคต (เคสปลดเพิกถอน)", () => {
    const got = nextExpiresAt({ current: future, days: 10, now, active: false });
    expect(got?.getTime()).toBe(now.getTime() + 10 * DAY);
  });
});

describe("monthsBetween — สิทธิ์คงเหลือเป็นเดือน (ใช้คิดเพดานสมัครล่วงหน้า)", () => {
  it("เหลือ 30 วัน → 1 เดือน", () => {
    expect(monthsBetween(now, future)).toBe(1);
  });
  it("หมดแล้ว → 0", () => {
    expect(monthsBetween(now, past)).toBe(0);
  });
  it("ไม่มีวันหมดอายุ → นับเป็นเต็มเพดาน (ไม่ต้องให้สมัครเพิ่มอีก)", () => {
    expect(monthsBetween(now, null)).toBe(MAX_PREPAID_MONTHS);
  });
});

describe("canStartNewPeriod — เพดานสิทธิ์ที่สะสมล่วงหน้าได้ (Phase 2.2)", () => {
  it("ยังไม่เคยสมัคร / หมดอายุแล้ว → เริ่มรอบใหม่ได้เสมอ", () => {
    expect(canStartNewPeriod({ state: "NONE", expiresAt: null, now })).toBe(true);
    expect(canStartNewPeriod({ state: "EXPIRED", expiresAt: past, now })).toBe(true);
  });

  it("❌ ถูกเพิกถอน → กดเองไม่ได้ (ต้องให้แอดมินปลด)", () => {
    expect(canStartNewPeriod({ state: "REVOKED", expiresAt: future, now })).toBe(false);
  });

  it("เหลือ 1 เดือน + ซื้อเพิ่ม 12 เดือน → ยังไม่ชนเพดาน 24 เดือน", () => {
    expect(canStartNewPeriod({ state: "ACTIVE", expiresAt: future, now, addMonths: 12 })).toBe(true);
  });

  it("❌ เหลือ 24 เดือนอยู่แล้ว → สมัครเพิ่มไม่ได้ (กันกดรัวสะสมสิทธิ์ยาวเกินจริง)", () => {
    const far = new Date(now.getTime() + 24 * 30 * DAY);
    expect(canStartNewPeriod({ state: "ACTIVE", expiresAt: far, now, addMonths: 1 })).toBe(false);
  });

  it("❌ สิทธิ์ไม่มีวันหมดอายุ → ไม่ต้องสมัครเพิ่ม", () => {
    expect(canStartNewPeriod({ state: "ACTIVE", expiresAt: null, now })).toBe(false);
  });
});

describe("daysLeft — ตัวเลขที่โชว์บนหน้าสถานะ", () => {
  it("เหลือ 30 วัน", () => {
    expect(daysLeft(future, now)).toBe(30);
  });
  it("เศษวันปัดขึ้น (เหลือ 12 ชม. = 1 วัน)", () => {
    expect(daysLeft(new Date(now.getTime() + DAY / 2), now)).toBe(1);
  });
  it("หมดแล้ว → 0 (ไม่ติดลบ)", () => {
    expect(daysLeft(past, now)).toBe(0);
  });
  it("ไม่มีวันหมดอายุ → null", () => {
    expect(daysLeft(null, now)).toBeNull();
  });
});

// ============================================================
// 3. pure — ด่านตรวจสิทธิ์ (สัญญากับสาย sale-round)
// ============================================================
describe("requiresActiveMembership — ตรวจแค่ขาเข้า ไม่ตรวจย้อนหลัง (D5)", () => {
  it("ขอเข้ารอบสมาชิก → ต้องเป็นสมาชิก", () => {
    expect(requiresActiveMembership("ROUND_ENTRY")).toBe(true);
  });
  it("สร้าง order → ต้องเป็นสมาชิก", () => {
    expect(requiresActiveMembership("ORDER_CREATE")).toBe(true);
  });
  it("🔑 ยืนยันการจ่ายเงิน → ไม่ตรวจ (order ที่ผ่านด่านแล้วต้องจ่ายจบได้)", () => {
    expect(requiresActiveMembership("PAYMENT_CONFIRM")).toBe(false);
  });
});

describe("isIdentityVerified — ต้องยืนยันตัวตนก่อนสมัครสมาชิกเอง (กันปั๊มบัญชียึดรอบสมาชิก)", () => {
  it("ยืนยันอีเมลแล้ว → ผ่าน", () => {
    expect(isIdentityVerified({ emailVerified: past, oauthAccountCount: 0 })).toBe(true);
  });
  it("ล็อกอิน Google (emailVerified = null แต่มี oauth account) → ผ่าน", () => {
    expect(isIdentityVerified({ emailVerified: null, oauthAccountCount: 1 })).toBe(true);
  });
  it("❌ ยังไม่ยืนยันอีเมล และไม่มี oauth → ไม่ผ่าน", () => {
    expect(isIdentityVerified({ emailVerified: null, oauthAccountCount: 0 })).toBe(false);
  });
});

// ============================================================
// 4. DB — getActiveMembership / isActiveMember (สัญญาหลักกับคนที่ 3)
// ============================================================
describe("getActiveMembership — กรองวันหมดอายุใน where ไม่ใช่ใน JS", () => {
  it("คืนข้อมูลสมาชิก + แปลง BigInt เป็น string ให้ส่งข้าม server→client ได้", async () => {
    db.membership.findFirst.mockResolvedValue({
      id: 7n,
      userId: 42n,
      source: "SELF_SIGNUP",
      startedAt: past,
      expiresAt: future,
    });

    const got = await getActiveMembership("42", now);

    expect(got).toEqual({
      id: "7",
      userId: "42",
      source: "SELF_SIGNUP",
      startedAt: past,
      expiresAt: future,
    });
    // where ต้องมีทั้ง status ACTIVE และเงื่อนไขวันหมดอายุ (ไม่งั้นคนหมดอายุจะหลุดเข้ารอบสมาชิก)
    const where = db.membership.findFirst.mock.calls[0][0].where;
    expect(where.userId).toBe(42n);
    expect(where.status).toBe("ACTIVE");
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: now } }]);
  });

  it("ไม่เจอแถวที่ยัง active → null", async () => {
    db.membership.findFirst.mockResolvedValue(null);
    expect(await getActiveMembership(42n, now)).toBeNull();
    expect(await isActiveMember(42n, now)).toBe(false);
  });

  it("isActiveMember = true เมื่อมีแถว active", async () => {
    db.membership.findFirst.mockResolvedValue({
      id: 1n,
      userId: 1n,
      source: "ADMIN_GRANT",
      startedAt: past,
      expiresAt: null,
    });
    expect(await isActiveMember(1n, now)).toBe(true);
  });
});

describe("getMembershipView — ข้อมูลหน้าสถานะของผู้ใช้", () => {
  it("ยังไม่เคยสมัคร → NONE ทุกช่องว่าง", async () => {
    db.membership.findUnique.mockResolvedValue(null);
    expect(await getMembershipView("42", now)).toEqual({
      state: "NONE",
      source: null,
      tier: null,
      startedAt: null,
      expiresAt: null,
      revokedAt: null,
      daysLeft: null,
      canRenew: true,
    });
  });

  it("สมาชิกที่ยังใช้ได้ → ACTIVE + เหลือ 30 วัน", async () => {
    db.membership.findUnique.mockResolvedValue({
      status: "ACTIVE",
      source: "SELF_SIGNUP",
      startedAt: past,
      expiresAt: future,
      revokedAt: null,
    });
    const view = await getMembershipView("42", now);
    expect(view.state).toBe("ACTIVE");
    expect(view.daysLeft).toBe(30);
  });

  it("หมดอายุ → EXPIRED และไม่โชว์วันคงเหลือ", async () => {
    db.membership.findUnique.mockResolvedValue({
      status: "ACTIVE",
      source: "SELF_SIGNUP",
      startedAt: past,
      expiresAt: past,
      revokedAt: null,
    });
    const view = await getMembershipView("42", now);
    expect(view.state).toBe("EXPIRED");
    expect(view.daysLeft).toBeNull();
  });
});

// ============================================================
// 5. DB — สมัครเอง (D4)
// ============================================================
describe("selfSignupMembership — ผู้ใช้กดสมัคร/ต่ออายุเอง", () => {
  it("สมัครครั้งแรก → ACTIVE + หมดอายุ 365 วันนับจากวันนี้", async () => {
    db.user.findUnique.mockResolvedValue({
      emailVerified: past,
      _count: { accounts: 0 },
      membership: null,
    });

    const res = await selfSignupMembership("42", now);

    expect(res.ok).toBe(true);
    const arg = db.membership.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: 42n });
    expect(arg.create.status).toBe("ACTIVE");
    expect(arg.create.source).toBe("SELF_SIGNUP");
    expect((arg.create.expiresAt as Date).getTime()).toBe(now.getTime() + MEMBERSHIP_DEFAULT_DAYS * DAY);
  });

  it("❌ ยังไม่ยืนยันอีเมล → สมัครไม่ได้ และต้องไม่เขียน DB", async () => {
    db.user.findUnique.mockResolvedValue({
      emailVerified: null,
      _count: { accounts: 0 },
      membership: null,
    });

    const res = await selfSignupMembership("42", now);

    expect(res).toEqual({ ok: false, error: "กรุณายืนยันอีเมลก่อนสมัครสมาชิก" });
    expect(db.membership.upsert).not.toHaveBeenCalled();
  });

  it("❌ ถูกแอดมินเพิกถอน → สมัครเองใหม่ไม่ได้ (ไม่งั้นการเพิกถอนไม่มีความหมาย)", async () => {
    db.user.findUnique.mockResolvedValue({
      emailVerified: past,
      _count: { accounts: 0 },
      membership: { status: "REVOKED", expiresAt: future },
    });

    const res = await selfSignupMembership("42", now);

    expect(res.ok).toBe(false);
    expect(db.membership.upsert).not.toHaveBeenCalled();
  });

  it("ต่ออายุตอนยังไม่หมด → ต่อท้ายของเดิม และไม่รีเซ็ตวันเริ่มเป็นสมาชิก", async () => {
    db.user.findUnique.mockResolvedValue({
      emailVerified: past,
      _count: { accounts: 0 },
      membership: { status: "ACTIVE", expiresAt: future },
    });

    await selfSignupMembership("42", now);

    const update = db.membership.upsert.mock.calls[0][0].update;
    expect((update.expiresAt as Date).getTime()).toBe(future.getTime() + MEMBERSHIP_DEFAULT_DAYS * DAY);
    expect(update.startedAt).toBeUndefined(); // คงวันเริ่มเดิม
  });

  it("ต่ออายุหลังหมดอายุ → เริ่มรอบใหม่จากวันนี้ + รีเซ็ต startedAt", async () => {
    db.user.findUnique.mockResolvedValue({
      emailVerified: past,
      _count: { accounts: 0 },
      membership: { status: "ACTIVE", expiresAt: past },
    });

    await selfSignupMembership("42", now);

    const update = db.membership.upsert.mock.calls[0][0].update;
    expect((update.expiresAt as Date).getTime()).toBe(now.getTime() + MEMBERSHIP_DEFAULT_DAYS * DAY);
    expect(update.startedAt).toEqual(now);
  });
});

// ============================================================
// 6. DB — แอดมินให้/เพิกถอนสิทธิ์ (D3)
// ============================================================
describe("grantMembership — แอดมินให้สิทธิ์", () => {
  it("ให้สิทธิ์ 30 วัน + บันทึกว่าแอดมินคนไหนเป็นคนให้", async () => {
    db.user.findUnique.mockResolvedValue({ membership: null });

    const res = await grantMembership({ userId: "42", days: 30, grantedByUserId: "1", now });

    expect(res.ok).toBe(true);
    const arg = db.membership.upsert.mock.calls[0][0];
    expect(arg.create.source).toBe("ADMIN_GRANT");
    expect(arg.create.grantedByUserId).toBe(1n);
    expect((arg.create.expiresAt as Date).getTime()).toBe(now.getTime() + 30 * DAY);
  });

  it("days = 0 → ไม่มีวันหมดอายุ (expiresAt = null)", async () => {
    db.user.findUnique.mockResolvedValue({ membership: null });

    await grantMembership({ userId: "42", days: 0, grantedByUserId: "1", now });

    expect(db.membership.upsert.mock.calls[0][0].create.expiresAt).toBeNull();
  });

  it("ปลดเพิกถอนได้: ล้าง revokedAt แล้วเริ่มนับใหม่จากวันนี้", async () => {
    db.user.findUnique.mockResolvedValue({
      membership: { status: "REVOKED", expiresAt: future },
    });

    await grantMembership({ userId: "42", days: 10, grantedByUserId: "1", now });

    const update = db.membership.upsert.mock.calls[0][0].update;
    expect(update.status).toBe("ACTIVE");
    expect(update.revokedAt).toBeNull();
    expect(update.startedAt).toEqual(now);
    expect((update.expiresAt as Date).getTime()).toBe(now.getTime() + 10 * DAY);
  });

  it("❌ ไม่พบผู้ใช้ → ไม่เขียน DB", async () => {
    db.user.findUnique.mockResolvedValue(null);
    const res = await grantMembership({ userId: "999", grantedByUserId: "1", now });
    expect(res).toEqual({ ok: false, error: "ไม่พบบัญชีผู้ใช้" });
    expect(db.membership.upsert).not.toHaveBeenCalled();
  });
});

describe("revokeMembership — แอดมินเพิกถอนสิทธิ์", () => {
  it("ตั้ง REVOKED + เวลาที่ถอน (เก็บแถวไว้ ไม่ลบ เพื่อให้ตามหลังได้)", async () => {
    db.membership.findUnique.mockResolvedValueOnce({ id: 7n });

    const res = await revokeMembership("42", now);

    expect(res.ok).toBe(true);
    expect(db.membership.update).toHaveBeenCalledWith({
      where: { userId: 42n },
      data: { status: "REVOKED", revokedAt: now },
    });
  });

  it("❌ ผู้ใช้ที่ไม่เคยเป็นสมาชิก → error ไม่เขียน DB", async () => {
    db.membership.findUnique.mockResolvedValue(null);
    const res = await revokeMembership("42", now);
    expect(res).toEqual({ ok: false, error: "ผู้ใช้รายนี้ยังไม่เป็นสมาชิก" });
    expect(db.membership.update).not.toHaveBeenCalled();
  });
});

// ============================================================
// 7. D5 — เคสยาก: สมาชิกหมดอายุ "ตอนมี order ค้างจ่าย"
// ============================================================
// ไทม์ไลน์: 12:00 เข้ารอบสมาชิกได้ → 12:01 กดจองสร้าง order (สิทธิ์เหลือ 1 นาที)
//           → 12:05 โอนเงิน/อัปสลิป ตอนนั้นสมาชิกหมดอายุไปแล้ว
// ต้องได้: เข้ารอบใหม่ไม่ได้ (สิทธิ์หมดจริง) แต่ order เดิมจ่ายจบได้ ไม่กลายเป็นงานคืนเงิน
describe("D5 — หมดอายุตอนมี order ค้าง", () => {
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000); // หมดอีก 2 นาที
  const atOrder = new Date(now.getTime() + 1 * 60 * 1000); // 12:01 ตอนสร้าง order
  const atPay = new Date(now.getTime() + 5 * 60 * 1000); // 12:05 ตอนจ่ายเงิน (หมดอายุแล้ว)
  const row = { status: "ACTIVE" as const, expiresAt };

  it("ตอนสร้าง order ยังเป็นสมาชิก → ผ่านด่าน ORDER_CREATE", () => {
    expect(requiresActiveMembership("ORDER_CREATE")).toBe(true);
    expect(isMembershipActive(row, atOrder)).toBe(true);
  });

  it("ตอนจ่ายเงินสิทธิ์หมดแล้ว แต่ด่าน PAYMENT_CONFIRM ไม่ตรวจสมาชิก → order เดิมจ่ายจบได้", () => {
    expect(isMembershipActive(row, atPay)).toBe(false); // สิทธิ์หมดจริง
    expect(requiresActiveMembership("PAYMENT_CONFIRM")).toBe(false); // แต่ไม่ถูกใช้เป็นด่าน
  });

  it("จะกดจองรอบสมาชิก 'รอบใหม่' ตอนนั้นไม่ได้แล้ว (สิทธิ์หมดคือหมด)", async () => {
    // getActiveMembership ถาม DB ด้วยเวลา atPay → where กรอง expiresAt > now ทำให้ไม่เจอแถว
    db.membership.findFirst.mockResolvedValue(null);
    expect(await isActiveMember("42", atPay)).toBe(false);
    expect(db.membership.findFirst.mock.calls[0][0].where.OR[1]).toEqual({ expiresAt: { gt: atPay } });
  });

  it("ต่ออายุหลังจากนั้น → ได้ 365 วันนับจากตอนต่อ ไม่ใช่ต่อจากเวลาที่หมดไปแล้ว", async () => {
    db.user.findUnique.mockResolvedValue({
      emailVerified: past,
      _count: { accounts: 0 },
      membership: row,
    });

    await selfSignupMembership("42", atPay);

    const update = db.membership.upsert.mock.calls[0][0].update;
    expect((update.expiresAt as Date).getTime()).toBe(atPay.getTime() + MEMBERSHIP_DEFAULT_DAYS * DAY);
  });
});
