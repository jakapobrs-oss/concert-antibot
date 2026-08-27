// Unit tests — server action แต่งตั้ง/ถอน STAFF (rev 42)
// พิสูจน์: ไม่ใช่แอดมิน → ปฏิเสธก่อนแตะ DB · อีเมลไม่มี → บอกให้สมัครก่อน · ADMIN แตะไม่ได้
//          · เขียนแบบมีเงื่อนไข role เดิม (กันสองแอดมินกดชน) · แต่งตั้งซ้ำไม่เขียน DB
//          · รับอีเมล dev ไม่มี TLD + เทียบแบบไม่สนตัวพิมพ์ (ตอนสมัครไม่ได้ normalize)
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, assertVerifiedAdmin, revalidatePath } = vi.hoisted(() => ({
  db: { user: { findFirst: vi.fn(), updateMany: vi.fn() } },
  assertVerifiedAdmin: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/admin-guard", () => ({ assertVerifiedAdmin }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { grantStaffByEmail, revokeStaffById } from "@/app/actions/admin-staff";

beforeEach(() => {
  vi.clearAllMocks();
  assertVerifiedAdmin.mockResolvedValue({ user: { id: "1" } });
  db.user.updateMany.mockResolvedValue({ count: 1 });
});

describe("grantStaffByEmail", () => {
  it("ไม่ใช่แอดมิน → ปฏิเสธ และไม่ query DB", async () => {
    assertVerifiedAdmin.mockRejectedValue(new Error("ต้องเป็น admin เท่านั้น"));
    const res = await grantStaffByEmail({ email: "staff@local" });
    expect(res.ok).toBe(false);
    expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it("อีเมลผิดรูปแบบ → ปฏิเสธก่อนแตะ DB", async () => {
    const res = await grantStaffByEmail({ email: "no-at-sign" });
    expect(res.ok).toBe(false);
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it("รับอีเมลบัญชี dev ที่ไม่มี TLD (user@local) + trim/lowercase + เทียบ DB แบบ insensitive", async () => {
    db.user.findFirst.mockResolvedValue({ id: 5n, role: "USER" });
    const res = await grantStaffByEmail({ email: "  User@Local " });
    expect(res.ok).toBe(true);
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: "user@local", mode: "insensitive" } },
      select: { id: true, role: true },
    });
  });

  it("ไม่พบอีเมล → บอกให้สมัครบัญชีก่อน", async () => {
    db.user.findFirst.mockResolvedValue(null);
    const res = await grantStaffByEmail({ email: "nobody@example.com" });
    expect(res).toMatchObject({ ok: false });
    expect(!res.ok && res.error).toMatch(/สมัครบัญชีก่อน/);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it("USER → STAFF: เขียนแบบมีเงื่อนไข role เดิม + revalidate หน้าแอดมิน", async () => {
    db.user.findFirst.mockResolvedValue({ id: 5n, role: "USER" });
    const res = await grantStaffByEmail({ email: "staff@example.com" });
    expect(res.ok).toBe(true);
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: 5n, role: "USER" },
      data: { role: "STAFF" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/staff");
  });

  it("บัญชี ADMIN → ปฏิเสธ ไม่เขียน DB", async () => {
    db.user.findFirst.mockResolvedValue({ id: 1n, role: "ADMIN" });
    const res = await grantStaffByEmail({ email: "admin@example.com" });
    expect(res.ok).toBe(false);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it("เป็น STAFF อยู่แล้ว → ok แต่ไม่เขียน DB", async () => {
    db.user.findFirst.mockResolvedValue({ id: 5n, role: "STAFF" });
    const res = await grantStaffByEmail({ email: "staff@example.com" });
    expect(res.ok).toBe(true);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it("role ถูกเปลี่ยนระหว่างทาง (updateMany count 0) → แจ้งให้รีเฟรช", async () => {
    db.user.findFirst.mockResolvedValue({ id: 5n, role: "USER" });
    db.user.updateMany.mockResolvedValue({ count: 0 });
    const res = await grantStaffByEmail({ email: "staff@example.com" });
    expect(res.ok).toBe(false);
  });
});

describe("revokeStaffById", () => {
  it("id ไม่ใช่ตัวเลข → ปฏิเสธก่อนแตะ DB", async () => {
    const res = await revokeStaffById({ userId: "abc" });
    expect(res.ok).toBe(false);
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it("STAFF → USER (หาแถวด้วย id ตรง ๆ)", async () => {
    db.user.findFirst.mockResolvedValue({ id: 9n, role: "STAFF" });
    const res = await revokeStaffById({ userId: "9" });
    expect(res.ok).toBe(true);
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { id: 9n }, select: { id: true, role: true } });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: 9n, role: "STAFF" },
      data: { role: "USER" },
    });
  });

  it("ถอนบัญชี ADMIN ไม่ได้ (กันลดสิทธิ์แอดมินกันเองจากหน้านี้)", async () => {
    db.user.findFirst.mockResolvedValue({ id: 1n, role: "ADMIN" });
    const res = await revokeStaffById({ userId: "1" });
    expect(res.ok).toBe(false);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
});
