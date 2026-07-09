// Regression: admin-guard — re-check role กับ DB จริง ไม่เชื่อ role ใน JWT (Codex §4 #2 / F2)
import { describe, it, expect, vi, beforeEach } from "vitest";

const { auth, userFindUnique } = vi.hoisted(() => ({ auth: vi.fn(), userFindUnique: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: userFindUnique } } }));

import { isVerifiedAdmin, assertVerifiedAdmin } from "@/lib/admin-guard";

beforeEach(() => vi.clearAllMocks());

describe("isVerifiedAdmin", () => {
  it("ไม่ login → false โดยไม่ query DB", async () => {
    auth.mockResolvedValue(null);
    expect(await isVerifiedAdmin()).toBe(false);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("JWT ค้างบอก ADMIN แต่ DB role=USER (เพิ่งถูก demote) → false (เชื่อ DB)", async () => {
    auth.mockResolvedValue({ user: { id: "7", role: "ADMIN" } }); // role ใน JWT ยัง ADMIN
    userFindUnique.mockResolvedValue({ role: "USER" }); // แต่ DB จริง = USER
    expect(await isVerifiedAdmin()).toBe(false);
    expect(userFindUnique).toHaveBeenCalledWith({ where: { id: BigInt("7") }, select: { role: true } });
  });

  it("DB role=ADMIN → true", async () => {
    auth.mockResolvedValue({ user: { id: "7" } });
    userFindUnique.mockResolvedValue({ role: "ADMIN" });
    expect(await isVerifiedAdmin()).toBe(true);
  });
});

describe("assertVerifiedAdmin", () => {
  it("ไม่ใช่ admin → throw", async () => {
    auth.mockResolvedValue({ user: { id: "7" } });
    userFindUnique.mockResolvedValue({ role: "USER" });
    await expect(assertVerifiedAdmin()).rejects.toThrow();
  });

  it("admin จริง → คืน session", async () => {
    const session = { user: { id: "7" } };
    auth.mockResolvedValue(session);
    userFindUnique.mockResolvedValue({ role: "ADMIN" });
    expect(await assertVerifiedAdmin()).toBe(session);
  });
});
