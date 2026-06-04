// Unit tests — Level 2: เวลาโอนในสลิปต้องอยู่ในช่วงของ order
// พิสูจน์ว่า "สลิปเก่า" (โอนก่อนสร้าง order) ถูกปฏิเสธ
import { describe, it, expect } from "vitest";
import { isSlipFresh, DEFAULT_SLIP_SKEW_MS } from "@/lib/slip-freshness";

const MIN = 60 * 1000;

describe("isSlipFresh — กันสลิปเก่ามาใช้ซ้ำ", () => {
  const orderCreatedAt = new Date("2026-06-03T10:00:00+07:00");
  const now = new Date("2026-06-03T10:02:00+07:00"); // 2 นาทีหลังสร้าง order

  it("ผ่าน: โอนหลังสร้าง order ไม่นาน", () => {
    const slipTime = new Date("2026-06-03T10:01:00+07:00");
    expect(isSlipFresh({ slipTime, orderCreatedAt, now })).toBe(true);
  });

  it("❌ ปฏิเสธ: สลิปเก่าจากเมื่อวาน (โอนก่อนสร้าง order)", () => {
    const slipTime = new Date("2026-06-02T10:00:00+07:00");
    expect(isSlipFresh({ slipTime, orderCreatedAt, now })).toBe(false);
  });

  it("❌ ปฏิเสธ: สลิปเก่าจากชั่วโมงก่อน", () => {
    const slipTime = new Date("2026-06-03T09:00:00+07:00");
    expect(isSlipFresh({ slipTime, orderCreatedAt, now })).toBe(false);
  });

  it("ผ่าน: โอนก่อนสร้าง order เล็กน้อยแต่ยังอยู่ใน skew (นาฬิกาต่างกัน)", () => {
    const slipTime = new Date("2026-06-03T09:58:00+07:00"); // ก่อน 2 นาที < skew 5 นาที
    expect(isSlipFresh({ slipTime, orderCreatedAt, now })).toBe(true);
  });

  it("❌ ปฏิเสธ: โอนก่อนสร้าง order เกิน skew", () => {
    const slipTime = new Date("2026-06-03T09:50:00+07:00"); // ก่อน 10 นาที > skew
    expect(isSlipFresh({ slipTime, orderCreatedAt, now })).toBe(false);
  });

  it("❌ ปฏิเสธ: เวลาในสลิปเป็นอนาคตเกิน skew (clock เพี้ยน/ปลอม)", () => {
    const slipTime = new Date("2026-06-03T10:30:00+07:00"); // อนาคต 28 นาที
    expect(isSlipFresh({ slipTime, orderCreatedAt, now })).toBe(false);
  });

  it("❌ ปฏิเสธ: เวลาในสลิป parse ไม่ได้ (Invalid Date)", () => {
    expect(isSlipFresh({ slipTime: new Date("ไม่ใช่เวลา"), orderCreatedAt, now })).toBe(false);
  });

  it("skew ปรับได้", () => {
    const slipTime = new Date("2026-06-03T09:52:00+07:00"); // ก่อน 8 นาที
    expect(isSlipFresh({ slipTime, orderCreatedAt, now, skewMs: 10 * MIN })).toBe(true);
    expect(isSlipFresh({ slipTime, orderCreatedAt, now, skewMs: 5 * MIN })).toBe(false);
  });

  it("ค่า default skew = 5 นาที", () => {
    expect(DEFAULT_SLIP_SKEW_MS).toBe(5 * MIN);
  });
});
