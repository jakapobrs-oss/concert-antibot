// Regression: หน้าแอดมิน "ให้สิทธิ์ด้วยอีเมล" ต้องรับอีเมลของบัญชี dev ที่ไม่มี TLD ได้
//   เจอตอนรันจริง: ใช้ zod .email() แล้วบัญชี seed "user@local" ถูกปฏิเสธทั้งที่ล็อกอินเข้าระบบได้
//   คอนเวนชันของโปรเจกต์คือไม่ใช้ .email() (ดู lib/auth.ts:16, lib/env-schema.ts:29)
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, assertVerifiedAdmin, grantMembership, revokeMembership } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() } },
  assertVerifiedAdmin: vi.fn(),
  grantMembership: vi.fn(),
  revokeMembership: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/admin-guard", () => ({ assertVerifiedAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/membership", () => ({
  grantMembership,
  revokeMembership,
  MEMBERSHIP_DEFAULT_DAYS: 365,
}));

import { grantMembershipByEmail } from "@/app/actions/admin-membership";

const view = {
  state: "ACTIVE" as const,
  source: "ADMIN_GRANT" as const,
  startedAt: new Date("2026-08-20T00:00:00Z"),
  expiresAt: new Date("2026-09-19T00:00:00Z"),
  revokedAt: null,
  daysLeft: 30,
  canRenew: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  assertVerifiedAdmin.mockResolvedValue({ user: { id: "1" } });
  db.user.findUnique.mockResolvedValue({ id: 2n });
  grantMembership.mockResolvedValue({ ok: true, view });
});

describe("grantMembershipByEmail — ให้สิทธิ์ด้วยอีเมล", () => {
  it("รับอีเมลบัญชี dev ที่ไม่มี TLD (user@local) — zod .email() จะปฏิเสธ จึงห้ามใช้", async () => {
    const res = await grantMembershipByEmail({ email: "user@local", days: 30 });

    expect(res.ok).toBe(true);
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: "user@local" },
      select: { id: true },
    });
    expect(grantMembership).toHaveBeenCalledWith({
      userId: 2n,
      days: 30,
      grantedByUserId: "1",
    });
  });

  it("ตัดช่องว่างและแปลงเป็นตัวพิมพ์เล็กก่อนค้นหา (แอดมินก๊อปอีเมลมาวางมักติดช่องว่าง)", async () => {
    await grantMembershipByEmail({ email: "  User@Local  " });

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: "user@local" },
      select: { id: true },
    });
  });

  it("❌ ข้อความที่ไม่มี @ → ปฏิเสธ ไม่แตะ DB", async () => {
    const res = await grantMembershipByEmail({ email: "ไม่ใช่อีเมล" });

    expect(res).toEqual({ ok: false, error: "อีเมลไม่ถูกต้อง" });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(grantMembership).not.toHaveBeenCalled();
  });

  it("❌ ไม่พบผู้ใช้อีเมลนี้ → ไม่เรียก grantMembership", async () => {
    db.user.findUnique.mockResolvedValue(null);

    const res = await grantMembershipByEmail({ email: "nobody@local" });

    expect(res).toEqual({ ok: false, error: "ไม่พบผู้ใช้อีเมลนี้ในระบบ" });
    expect(grantMembership).not.toHaveBeenCalled();
  });

  it("❌ ไม่ใช่แอดมิน (guard throw) → ปฏิเสธก่อนแตะ DB", async () => {
    assertVerifiedAdmin.mockRejectedValue(new Error("ต้องเป็น admin เท่านั้น"));

    const res = await grantMembershipByEmail({ email: "user@local" });

    expect(res).toEqual({ ok: false, error: "ต้องเป็นแอดมิน" });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("จำนวนวันเกินเพดาน 3650 → ปฏิเสธ (กันพิมพ์หลุด)", async () => {
    const res = await grantMembershipByEmail({ email: "user@local", days: 99999 });

    expect(res.ok).toBe(false);
    expect(grantMembership).not.toHaveBeenCalled();
  });
});
