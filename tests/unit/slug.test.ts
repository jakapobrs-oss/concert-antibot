// Unit tests — lib/slug.ts: slug ของคอนเสิร์ตต้องไม่ว่างเปล่าแม้ชื่อเป็นไทยล้วน
// บั๊กที่จับ (2026-08-27): "คอนพี่เจี๊ยบ" → slug "" → การ์ดลิงก์ไป /concerts กดเข้าคอนเสิร์ตไม่ได้ทั้งที่ขึ้น "กำลังขาย"
import { describe, it, expect } from "vitest";
import { slugifyTitle, fallbackSlug, resolveConcertSlug } from "@/lib/slug";

describe("slugifyTitle", () => {
  it("ชื่ออังกฤษ → lowercase + dash (พฤติกรรมเดิม)", () => {
    expect(slugifyTitle("BTS World Tour Bangkok 2026")).toBe("bts-world-tour-bangkok-2026");
    expect(slugifyTitle("  Ed Sheeran -- Live!  ")).toBe("ed-sheeran-live");
  });

  it("ชื่อผสม: เหลือเฉพาะส่วน ASCII", () => {
    expect(slugifyTitle("[TEST] ราชมังคลากีฬาสถาน — ทดสอบจ่ายจริง")).toBe("test");
    expect(slugifyTitle("[TEST] UT คอนเสิร์ตทดสอบ 26 ส.ค.")).toBe("test-ut-26");
  });

  it("ชื่อไทยล้วน/สัญลักษณ์ล้วน → ว่าง (ผู้เรียกต้องใช้ fallback)", () => {
    expect(slugifyTitle("คอนพี่เจี๊ยบ")).toBe("");
    expect(slugifyTitle("!!! ***")).toBe("");
  });
});

describe("resolveConcertSlug", () => {
  it("ชื่อไทยล้วน → concert-<id> (ไม่มีทางว่าง)", () => {
    expect(resolveConcertSlug({ title: "คอนพี่เจี๊ยบ", id: 48n, slugTaken: false })).toBe("concert-48");
    expect(fallbackSlug("48")).toBe("concert-48");
  });

  it("ชื่อแปลงได้ + ยังไม่มีใครใช้ → ใช้ตามชื่อ", () => {
    expect(resolveConcertSlug({ title: "Ed Sheeran", id: 7n, slugTaken: false })).toBe("ed-sheeran");
  });

  it("ชื่อซ้ำกับคอนเสิร์ตเดิม → เติม -<id> (deterministic ไม่ใช่ timestamp)", () => {
    expect(resolveConcertSlug({ title: "Ed Sheeran", id: 9n, slugTaken: true })).toBe("ed-sheeran-9");
  });

  it("ผลลัพธ์ทุกกรณีไม่ว่างและไม่ขึ้นต้น/ลงท้ายด้วย dash", () => {
    for (const title of ["คอนพี่เจี๊ยบ", "---", "A", "  งานใหญ่ 2026  "]) {
      const slug = resolveConcertSlug({ title, id: 1n, slugTaken: false });
      expect(slug.length).toBeGreaterThan(0);
      expect(slug).not.toMatch(/^-|-$/);
    }
  });
});
