// Unit tests — กติกาแต่งตั้ง/ถอน STAFF (rev 42)
// พิสูจน์: ADMIN แตะไม่ได้ทั้งสองทิศ · USER→STAFF · STAFF→USER · ทำซ้ำไม่พัง (idempotent)
import { describe, it, expect } from "vitest";
import { decideStaffRoleChange } from "@/lib/staff-role";

describe("decideStaffRoleChange", () => {
  it("บัญชี ADMIN — แต่งตั้ง/ถอนจากหน้านี้ไม่ได้ทั้งคู่", () => {
    expect(decideStaffRoleChange("ADMIN", true).ok).toBe(false);
    expect(decideStaffRoleChange("ADMIN", false).ok).toBe(false);
  });

  it("USER → STAFF (changed)", () => {
    const r = decideStaffRoleChange("USER", true);
    expect(r).toMatchObject({ ok: true, role: "STAFF", changed: true });
  });

  it("STAFF แต่งตั้งซ้ำ → ok แต่ไม่เปลี่ยน (แอดมินกดสองทีไม่พัง)", () => {
    const r = decideStaffRoleChange("STAFF", true);
    expect(r).toMatchObject({ ok: true, role: "STAFF", changed: false });
  });

  it("STAFF → USER (ถอนสิทธิ์)", () => {
    const r = decideStaffRoleChange("STAFF", false);
    expect(r).toMatchObject({ ok: true, role: "USER", changed: true });
  });

  it("ถอนคนที่เป็น USER อยู่แล้ว → ok ไม่เปลี่ยน", () => {
    const r = decideStaffRoleChange("USER", false);
    expect(r).toMatchObject({ ok: true, role: "USER", changed: false });
  });

  it("ไม่มีทางได้ role ADMIN ออกมาจากฟังก์ชันนี้", () => {
    for (const cur of ["USER", "STAFF"] as const) {
      for (const make of [true, false]) {
        const r = decideStaffRoleChange(cur, make);
        if (r.ok) expect(r.role).not.toBe("ADMIN");
      }
    }
  });
});
