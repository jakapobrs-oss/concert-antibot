// Unit tests — นโยบายผู้ถือบัตร (named ticket, docs/19)
import { describe, it, expect } from "vitest";
import { isHolderAccountOldEnough, exceedsHolderCap } from "@/lib/holder-policy";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-07-04T12:00:00+07:00");

describe("isHolderAccountOldEnough — อายุบัญชีขั้นต่ำของผู้ถือ (กันบัญชีเพิ่งสมัครมารับบัตร)", () => {
  it("ผ่านเมื่อบัญชีเก่ากว่าเกณฑ์ (30 วัน)", () => {
    expect(
      isHolderAccountOldEnough({ createdAt: new Date(now.getTime() - 45 * DAY), minDays: 30, now })
    ).toBe(true);
  });

  it("ผ่านพอดีเป๊ะที่ 30 วัน", () => {
    expect(
      isHolderAccountOldEnough({ createdAt: new Date(now.getTime() - 30 * DAY), minDays: 30, now })
    ).toBe(true);
  });

  it("❌ บัญชีเพิ่งสมัคร (5 วัน) → ไม่ผ่าน", () => {
    expect(
      isHolderAccountOldEnough({ createdAt: new Date(now.getTime() - 5 * DAY), minDays: 30, now })
    ).toBe(false);
  });

  it("minDays = 0 → ปิดเช็ค ผ่านเสมอ (โหมด dev/demo)", () => {
    expect(isHolderAccountOldEnough({ createdAt: now, minDays: 0, now })).toBe(true);
  });
});

describe("exceedsHolderCap — เพดานรับบัตรฝั่งผู้ถือ (นับข้ามทุกผู้ซื้อ)", () => {
  it("ยังไม่ถึงเพดาน → ไม่เกิน", () => {
    expect(exceedsHolderCap({ committed: 2, requested: 1, limit: 4 })).toBe(false);
    expect(exceedsHolderCap({ committed: 3, requested: 1, limit: 4 })).toBe(false); // ครบพอดี
  });

  it("❌ เกินเพดาน — กันขบวนการหลายผู้ซื้อตั้งผู้ถือคนเดียว", () => {
    expect(exceedsHolderCap({ committed: 4, requested: 1, limit: 4 })).toBe(true);
  });

  it("limit ≤ 0 = ปิด cap", () => {
    expect(exceedsHolderCap({ committed: 99, requested: 5, limit: 0 })).toBe(false);
  });
});
