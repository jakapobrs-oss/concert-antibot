// Unit tests — lib/concert-display.ts: สถานะที่แสดงต้องเทียบความจริง (โซน/ช่วงขาย) ไม่ใช่เชื่อ status ใน DB อย่างเดียว
// บั๊กที่จับ (user-test 2026-08-26 #40): คอนเสิร์ต ON_SALE ที่ไม่มีโซนและเลยช่วงขาย โชว์ "กำลังขาย ฿∞"
import { describe, it, expect } from "vitest";
import { deriveDisplayStatus, minZonePrice, DISPLAY_STATUS_LABEL, publicStatusHint } from "@/lib/concert-display";

const now = new Date("2026-08-27T12:00:00+07:00");
const past = new Date("2026-08-19T00:00:00+07:00");
const future = new Date("2026-09-30T00:00:00+07:00");

describe("deriveDisplayStatus", () => {
  it("ON_SALE + มีโซน + อยู่ในช่วงขาย → ON_SALE", () => {
    expect(deriveDisplayStatus({ status: "ON_SALE", saleStartAt: past, saleEndAt: future, zoneCount: 3, now })).toBe("ON_SALE");
  });

  it("ON_SALE แต่ไม่มีโซน → NOT_READY (ไม่ใช่กำลังขาย ไม่ให้เข้าคิว)", () => {
    expect(deriveDisplayStatus({ status: "ON_SALE", saleStartAt: past, saleEndAt: future, zoneCount: 0, now })).toBe("NOT_READY");
  });

  it("ON_SALE แต่เลยช่วงขาย (saleEndAt ผ่านไปแล้ว รวมเท่ากันพอดี) → ENDED", () => {
    expect(deriveDisplayStatus({ status: "ON_SALE", saleStartAt: past, saleEndAt: past, zoneCount: 2, now })).toBe("ENDED");
    expect(deriveDisplayStatus({ status: "ON_SALE", saleStartAt: past, saleEndAt: now, zoneCount: 2, now })).toBe("ENDED");
  });

  it("ON_SALE แต่ยังไม่ถึงเวลาเริ่มขาย → SCHEDULED", () => {
    expect(deriveDisplayStatus({ status: "ON_SALE", saleStartAt: future, saleEndAt: future, zoneCount: 2, now })).toBe("SCHEDULED");
  });

  it("SOLD_OUT / SCHEDULED จาก DB คงเดิม · status อื่น (CANCELLED ฯลฯ) → ENDED", () => {
    expect(deriveDisplayStatus({ status: "SOLD_OUT", saleStartAt: past, saleEndAt: future, zoneCount: 2, now })).toBe("SOLD_OUT");
    expect(deriveDisplayStatus({ status: "SCHEDULED", saleStartAt: future, saleEndAt: future, zoneCount: 0, now })).toBe("SCHEDULED");
    expect(deriveDisplayStatus({ status: "CANCELLED", saleStartAt: past, saleEndAt: future, zoneCount: 2, now })).toBe("ENDED");
  });

  it("วันงาน (eventAt) ผ่านไปแล้ว → ENDED เสมอ แม้ saleEndAt ยังไม่ถึง / DB ยัง ON_SALE หรือ SOLD_OUT (2026-08-27)", () => {
    // คอนเสิร์ต #48: งาน 10:00 วันนี้ แต่ปิดขายพรุ่งนี้ → เคยขึ้น "กำลังขาย" ทั้งวันหลังงานจบ
    const eventDone = new Date("2026-08-27T10:00:00+07:00");
    expect(deriveDisplayStatus({ status: "ON_SALE", saleStartAt: past, saleEndAt: future, zoneCount: 6, eventAt: eventDone, now })).toBe("ENDED");
    expect(deriveDisplayStatus({ status: "SOLD_OUT", saleStartAt: past, saleEndAt: future, zoneCount: 6, eventAt: eventDone, now })).toBe("ENDED");
    // วันงานยังไม่ถึง → ไม่กระทบ
    expect(deriveDisplayStatus({ status: "ON_SALE", saleStartAt: past, saleEndAt: future, zoneCount: 6, eventAt: future, now })).toBe("ON_SALE");
    // ไม่ส่ง eventAt = พฤติกรรมเดิม (ผู้เรียกเก่าไม่พัง)
    expect(deriveDisplayStatus({ status: "ON_SALE", saleStartAt: past, saleEndAt: future, zoneCount: 6, now })).toBe("ON_SALE");
  });

  it("ทุกสถานะมีป้ายภาษาไทย", () => {
    for (const s of ["ON_SALE", "SCHEDULED", "SOLD_OUT", "ENDED", "NOT_READY"] as const) {
      expect(DISPLAY_STATUS_LABEL[s]).toBeTruthy();
    }
  });
});

describe("minZonePrice", () => {
  it("ไม่มีโซน → null (เดิม Infinity)", () => {
    expect(minZonePrice([])).toBeNull();
  });

  it("มีโซน → ราคาต่ำสุด (รับ Decimal-like ที่มี toString)", () => {
    expect(minZonePrice([{ price: "8500" }, { price: { toString: () => "3500.00" } }, { price: "5500" }])).toBe(3500);
  });
});

describe("publicStatusHint — หน้าแอดมินต้องบอกเมื่อป้ายที่ตั้งกับที่ผู้ชมเห็นไม่ตรงกัน", () => {
  it("ON_SALE ที่ขายได้จริง → null (ไม่มีอะไรต้องเตือน)", () => {
    expect(publicStatusHint({ status: "ON_SALE", saleStartAt: past, saleEndAt: future, zoneCount: 3, eventAt: future, now })).toBeNull();
  });

  it("ON_SALE แต่ยังไม่ถึงเวลาเริ่มขาย → บอกว่าผู้ชมเห็น 'เร็ว ๆ นี้' + เวลาเปิดขาย", () => {
    const hint = publicStatusHint({ status: "ON_SALE", saleStartAt: future, saleEndAt: future, zoneCount: 3, now });
    expect(hint).toContain("เร็ว ๆ นี้");
    expect(hint).toContain("เปิดขาย");
  });

  it("ON_SALE แต่ไม่มีโซน → 'ยังไม่พร้อมขาย' · วันงานผ่านแล้ว → 'ปิดการขาย — วันงานผ่านไปแล้ว'", () => {
    expect(publicStatusHint({ status: "ON_SALE", saleStartAt: past, saleEndAt: future, zoneCount: 0, now })).toContain("ยังไม่พร้อมขาย");
    const ended = publicStatusHint({ status: "ON_SALE", saleStartAt: past, saleEndAt: future, zoneCount: 3, eventAt: past, now });
    expect(ended).toContain("ปิดการขาย");
    expect(ended).toContain("วันงานผ่านไปแล้ว");
  });

  it("DRAFT/ENDED (ไม่ถูก list ให้ผู้ชมอยู่แล้ว) → null", () => {
    expect(publicStatusHint({ status: "DRAFT", saleStartAt: past, saleEndAt: future, zoneCount: 0, now })).toBeNull();
    expect(publicStatusHint({ status: "ENDED", saleStartAt: past, saleEndAt: past, zoneCount: 3, now })).toBeNull();
  });
});
