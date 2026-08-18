// Unit tests — สิทธิ์สมาชิก (Phase 2)
//
// จุดที่ต้องพิสูจน์: **หมดอายุถูกตัดสินสดจากเวลาปัจจุบัน ไม่พึ่ง cron มาพลิกสถานะ**
// ถ้าตรรกะนี้พลาด คนที่หมดสิทธิ์ไปแล้วจะยังเข้ารอบสมาชิกได้ (= สิทธิ์รั่ว)
// และคนที่ยังมีสิทธิ์อยู่อาจโดนกันออกจากรอบที่ควรเข้าได้ (= สิทธิ์หาย)
import { describe, it, expect } from "vitest";
import {
  isMembershipActive,
  describeMembership,
  addDays,
  type MembershipLike,
} from "@/lib/membership";

const NOW = new Date("2026-08-19T12:00:00.000Z");

const active = (expiresAt: Date | null): MembershipLike => ({ status: "ACTIVE", expiresAt });
const revoked = (expiresAt: Date | null): MembershipLike => ({ status: "REVOKED", expiresAt });

describe("isMembershipActive — ตัดสินสิทธิ์ ณ เวลาที่ถาม", () => {
  it("ไม่มีแถวสมาชิกเลย (null/undefined) = ไม่ใช่สมาชิก", () => {
    expect(isMembershipActive(null, NOW)).toBe(false);
    expect(isMembershipActive(undefined, NOW)).toBe(false);
  });

  it("ACTIVE + ไม่มีวันหมดอายุ = เป็นสมาชิก (สิทธิ์ถาวรที่แอดมินให้)", () => {
    expect(isMembershipActive(active(null), NOW)).toBe(true);
  });

  it("ACTIVE + ยังไม่ถึงวันหมดอายุ = เป็นสมาชิก", () => {
    expect(isMembershipActive(active(addDays(NOW, 1)), NOW)).toBe(true);
  });

  it("ACTIVE + เลยวันหมดอายุแล้ว = ไม่ใช่สมาชิก แม้สถานะในตารางยังเขียนว่า ACTIVE", () => {
    // นี่คือเหตุผลทั้งหมดที่ไม่เก็บสถานะ EXPIRED ในตาราง — ตารางไม่มีวันตามเวลาไม่ทัน
    expect(isMembershipActive(active(addDays(NOW, -1)), NOW)).toBe(false);
  });

  it("ตรงวินาทีหมดอายุพอดี = หมดแล้ว (ช่วงเวลาเป็นแบบ [เริ่ม, จบ) เหมือนรอบขาย)", () => {
    expect(isMembershipActive(active(NOW), NOW)).toBe(false);
  });

  it("ถูกเพิกถอน = ไม่ใช่สมาชิก แม้วันหมดอายุยังอยู่ในอนาคต", () => {
    expect(isMembershipActive(revoked(addDays(NOW, 30)), NOW)).toBe(false);
  });

  it("ถูกเพิกถอน + ไม่มีวันหมดอายุ = ไม่ใช่สมาชิก (การเพิกถอนชนะเสมอ)", () => {
    expect(isMembershipActive(revoked(null), NOW)).toBe(false);
  });

  it("สิทธิ์เดียวกันให้ผลต่างกันได้ตามเวลาที่ถาม — พิสูจน์ว่าตัดสินสด ไม่ได้อ่านค่าที่ค้างไว้", () => {
    const membership = active(new Date("2026-09-01T00:00:00.000Z"));
    expect(isMembershipActive(membership, new Date("2026-08-31T23:59:59.000Z"))).toBe(true);
    expect(isMembershipActive(membership, new Date("2026-09-01T00:00:01.000Z"))).toBe(false);
  });
});

describe("describeMembership — บอกเหตุผลให้ผู้ใช้เห็นบนหน้าสถานะ", () => {
  it("ไม่เคยสมัคร -> NONE", () => {
    expect(describeMembership(null, NOW)).toEqual({ active: false, reason: "NONE" });
  });

  it("หมดอายุ -> EXPIRED (ไม่ใช่ NONE) เพื่อให้ผู้ใช้รู้ว่าเคยมีสิทธิ์และต่ออายุได้", () => {
    expect(describeMembership(active(addDays(NOW, -5)), NOW)).toEqual({
      active: false,
      reason: "EXPIRED",
    });
  });

  it("ถูกเพิกถอน -> REVOKED (ต่างจากหมดอายุ เพราะผู้ใช้ต้องรู้ว่าไม่ใช่แค่ต่ออายุแล้วจบ)", () => {
    expect(describeMembership(revoked(addDays(NOW, 30)), NOW)).toEqual({
      active: false,
      reason: "REVOKED",
    });
  });

  it("ยังใช้ได้ -> คืนวันหมดอายุมาแสดงด้วย", () => {
    const expiresAt = addDays(NOW, 10);
    expect(describeMembership(active(expiresAt), NOW)).toEqual({ active: true, expiresAt });
  });

  it("ยังใช้ได้แบบไม่มีกำหนด -> expiresAt เป็น null", () => {
    expect(describeMembership(active(null), NOW)).toEqual({ active: true, expiresAt: null });
  });

  it("ผลของ describeMembership ต้องสอดคล้องกับ isMembershipActive เสมอ", () => {
    const cases: Array<MembershipLike | null> = [
      null,
      active(null),
      active(addDays(NOW, 1)),
      active(addDays(NOW, -1)),
      revoked(null),
      revoked(addDays(NOW, 1)),
    ];
    for (const c of cases) {
      expect(describeMembership(c, NOW).active).toBe(isMembershipActive(c, NOW));
    }
  });
});

describe("addDays", () => {
  it("บวกวันได้ถูกต้องและไม่แก้ค่าเดิม", () => {
    const from = new Date("2026-08-19T12:00:00.000Z");
    expect(addDays(from, 1).toISOString()).toBe("2026-08-20T12:00:00.000Z");
    expect(from.toISOString()).toBe("2026-08-19T12:00:00.000Z");
  });

  it("รับค่าติดลบได้ (ใช้ในเทสย้อนเวลา)", () => {
    expect(addDays(new Date("2026-08-19T00:00:00.000Z"), -2).toISOString()).toBe(
      "2026-08-17T00:00:00.000Z"
    );
  });
});
