// Unit tests — F3: ตัดสินว่า order ค้างเกินเวลาควรถูกกวาดทิ้งไหม
// (ส่วน DB ของ expireStaleOrders เป็น integration — ทดสอบ logic การตัดสินใจตรงนี้)
import { describe, it, expect } from "vitest";
import { isOrderStale } from "@/lib/order-sweeper";

describe("isOrderStale — order ค้างควรกวาดไหม", () => {
  const now = new Date("2026-06-04T10:00:00+07:00");

  it("❌ กวาด: PENDING และหมดเวลาแล้ว (เลย expiresAt)", () => {
    const expiresAt = new Date("2026-06-04T09:55:00+07:00"); // หมดไป 5 นาที
    expect(isOrderStale({ status: "PENDING", expiresAt, now })).toBe(true);
  });

  it("ไม่กวาด: PENDING แต่ยังไม่หมดเวลา", () => {
    const expiresAt = new Date("2026-06-04T10:03:00+07:00"); // เหลืออีก 3 นาที
    expect(isOrderStale({ status: "PENDING", expiresAt, now })).toBe(false);
  });

  it("ไม่กวาด: จ่ายแล้ว (PAID) แม้ expiresAt จะเลยมาแล้ว", () => {
    const expiresAt = new Date("2026-06-04T09:00:00+07:00");
    expect(isOrderStale({ status: "PAID", expiresAt, now })).toBe(false);
  });

  it("ไม่กวาด: ยกเลิกไปแล้ว (CANCELLED)", () => {
    const expiresAt = new Date("2026-06-04T09:00:00+07:00");
    expect(isOrderStale({ status: "CANCELLED", expiresAt, now })).toBe(false);
  });

  it("ขอบเขต: expiresAt = now พอดี ยังไม่ถือว่าหมด (ต้องเลยจริง)", () => {
    expect(isOrderStale({ status: "PENDING", expiresAt: now, now })).toBe(false);
  });

  it("default now = เวลาปัจจุบัน: order ที่หมดตั้งแต่อดีตถูกกวาด", () => {
    const expiresAt = new Date("2020-01-01T00:00:00+07:00");
    expect(isOrderStale({ status: "PENDING", expiresAt })).toBe(true);
  });
});
