// Unit tests — F2: ลิมิตตั๋วต่อ user ต่อคอนเสิร์ต (นับยอดรวม)
// พิสูจน์ว่าการ "เข้าคิวใหม่แล้วสั่งซ้ำเพื่อกักตุน" ถูกบล็อกด้วยยอดสะสม
import { describe, it, expect } from "vitest";
import { exceedsTicketLimit, remainingTicketAllowance } from "@/lib/ticket-limit";

describe("exceedsTicketLimit — นับยอดรวมต่อ user ต่อคอนเสิร์ต", () => {
  it("ผ่าน: ยังไม่เคยจอง จองเท่าเพดานพอดี", () => {
    expect(exceedsTicketLimit({ committed: 0, requested: 4, max: 4 })).toBe(false);
  });

  it("ผ่าน: เคยจอง 2 จองเพิ่ม 2 = เท่าเพดานพอดี", () => {
    expect(exceedsTicketLimit({ committed: 2, requested: 2, max: 4 })).toBe(false);
  });

  it("❌ บล็อก: เคยจอง 4 ครบเพดานแล้ว จะจองเพิ่มอีก 1", () => {
    // นี่คือเคสกักตุน — order เดียวผ่านเพราะ requested=1 แต่ยอดรวม 5 > 4
    expect(exceedsTicketLimit({ committed: 4, requested: 1, max: 4 })).toBe(true);
  });

  it("❌ บล็อก: เคยจอง 3 จองเพิ่ม 2 = 5 เกินเพดาน 4", () => {
    expect(exceedsTicketLimit({ committed: 3, requested: 2, max: 4 })).toBe(true);
  });

  it("❌ บล็อก: ยอดเดิมเกินเพดานอยู่แล้ว (ข้อมูลเก่า/แก้เพดานลง)", () => {
    expect(exceedsTicketLimit({ committed: 5, requested: 1, max: 4 })).toBe(true);
  });
});

describe("remainingTicketAllowance — สิทธิ์ที่เหลือ", () => {
  it("ยังไม่เคยจอง = เหลือเต็มเพดาน", () => {
    expect(remainingTicketAllowance({ committed: 0, max: 4 })).toBe(4);
  });

  it("จองไป 3 จาก 4 = เหลือ 1", () => {
    expect(remainingTicketAllowance({ committed: 3, max: 4 })).toBe(1);
  });

  it("ครบเพดานแล้ว = เหลือ 0", () => {
    expect(remainingTicketAllowance({ committed: 4, max: 4 })).toBe(0);
  });

  it("ยอดเกินเพดาน = ไม่ติดลบ คืน 0", () => {
    expect(remainingTicketAllowance({ committed: 6, max: 4 })).toBe(0);
  });
});
