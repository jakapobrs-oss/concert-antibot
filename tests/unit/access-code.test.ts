// Unit tests — โค้ดสิทธิ์รอบพาร์ทเนอร์ + โค้ดลงทะเบียนล่วงหน้า (Phase 2.1, docs/21)
// ส่วน transaction (นับโควต้า/กัน race) ทดสอบจริงบนเครื่อง — ที่นี่คุมส่วนที่ทำให้ "โค้ดที่ถูกกลับใช้ไม่ได้"
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { normalizeCode, remainingUses } from "@/lib/access-code";
import { generatePreRegCode } from "@/lib/pre-registration";

describe("normalizeCode — ผู้ใช้พิมพ์โค้ดไม่ตรงเป๊ะเป็นเรื่องปกติ", () => {
  it("ตัดช่องว่างหน้า-หลัง และแปลงเป็นตัวพิมพ์ใหญ่", () => {
    expect(normalizeCode("  mastercard2026 ")).toBe("MASTERCARD2026");
  });

  it("ตัดช่องว่างกลางโค้ดด้วย (ก๊อปมาจากอีเมล/ใบเสร็จมักติดมา)", () => {
    expect(normalizeCode("UOB 2026 VIP")).toBe("UOB2026VIP");
  });

  it("โค้ดที่ normalize แล้วเท่ากัน = โค้ดเดียวกัน", () => {
    expect(normalizeCode("uob-2026")).toBe(normalizeCode(" UOB-2026 "));
  });
});

describe("remainingUses — จำนวนสิทธิ์ที่เหลือของโค้ด", () => {
  it("โค้ดโควต้าจำกัด → เหลือ = maxUses - usedCount", () => {
    expect(remainingUses({ maxUses: 100, usedCount: 37 })).toBe(63);
  });

  it("ใช้ครบแล้ว → 0 (ไม่ติดลบแม้ข้อมูลเพี้ยน)", () => {
    expect(remainingUses({ maxUses: 10, usedCount: 10 })).toBe(0);
    expect(remainingUses({ maxUses: 10, usedCount: 12 })).toBe(0);
  });

  it("โค้ดรวมแบบไม่จำกัด (maxUses = null) → null", () => {
    expect(remainingUses({ maxUses: null, usedCount: 9999 })).toBeNull();
  });
});

describe("generatePreRegCode — โค้ดที่ผู้ใช้ต้องอ่านจากหน้าจอ", () => {
  it("รูปแบบ PR-XXXXXXXX และไม่มีตัวอักษรที่สับสน (I, O, 0, 1)", () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePreRegCode();
      expect(code).toMatch(/^PR-[A-HJ-NP-Z2-9]{8}$/);
    }
  });

  it("สุ่มจริง — 200 ครั้งไม่ซ้ำกันเลย", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generatePreRegCode()));
    expect(codes.size).toBe(200);
  });
});
