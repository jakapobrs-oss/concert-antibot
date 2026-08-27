// Regression: staff guard (rev 42) — STAFF/ADMIN ผ่าน, USER ไม่ผ่าน, เชื่อ role ใน DB ไม่ใช่ JWT
import { describe, it, expect, vi, beforeEach } from "vitest";

const { auth, userFindUnique } = vi.hoisted(() => ({ auth: vi.fn(), userFindUnique: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: userFindUnique } } }));

import { isVerifiedStaff, assertVerifiedStaff, isVerifiedAdmin, STAFF_ROLES } from "@/lib/admin-guard";

beforeEach(() => vi.clearAllMocks());

describe("isVerifiedStaff", () => {
  it("ไม่ login → false โดยไม่ query DB", async () => {
    auth.mockResolvedValue(null);
    expect(await isVerifiedStaff()).toBe(false);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("DB role=STAFF → true · ADMIN → true · USER → false", async () => {
    auth.mockResolvedValue({ user: { id: "7" } });
    userFindUnique.mockResolvedValueOnce({ role: "STAFF" });
    expect(await isVerifiedStaff()).toBe(true);
    userFindUnique.mockResolvedValueOnce({ role: "ADMIN" });
    expect(await isVerifiedStaff()).toBe(true);
    userFindUnique.mockResolvedValueOnce({ role: "USER" });
    expect(await isVerifiedStaff()).toBe(false);
  });

  it("JWT บอก STAFF แต่ DB เป็น USER (เพิ่งถูกถอน) → false ทันที", async () => {
    auth.mockResolvedValue({ user: { id: "7", role: "STAFF" } });
    userFindUnique.mockResolvedValue({ role: "USER" });
    expect(await isVerifiedStaff()).toBe(false);
  });

  it("user หายจาก DB → false", async () => {
    auth.mockResolvedValue({ user: { id: "7", role: "STAFF" } });
    userFindUnique.mockResolvedValue(null);
    expect(await isVerifiedStaff()).toBe(false);
  });
});

describe("assertVerifiedStaff", () => {
  it("USER → throw", async () => {
    auth.mockResolvedValue({ user: { id: "7" } });
    userFindUnique.mockResolvedValue({ role: "USER" });
    await expect(assertVerifiedStaff()).rejects.toThrow();
  });

  it("STAFF → คืน session (เอา id ไปบันทึกคนสแกน)", async () => {
    const session = { user: { id: "7" } };
    auth.mockResolvedValue(session);
    userFindUnique.mockResolvedValue({ role: "STAFF" });
    expect(await assertVerifiedStaff()).toBe(session);
  });
});

describe("ขอบเขต STAFF ≠ ADMIN", () => {
  it("STAFF ไม่ผ่าน isVerifiedAdmin (เจ้าหน้าที่ต้องไม่เห็นหน้าแอดมิน)", async () => {
    auth.mockResolvedValue({ user: { id: "7" } });
    userFindUnique.mockResolvedValue({ role: "STAFF" });
    expect(await isVerifiedAdmin()).toBe(false);
  });

  it("STAFF_ROLES มีแค่ STAFF และ ADMIN", () => {
    expect([...STAFF_ROLES].sort()).toEqual(["ADMIN", "STAFF"]);
  });
});
