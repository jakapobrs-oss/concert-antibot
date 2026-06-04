// Unit tests — F6: parse เวลาในสลิปให้ถูก timezone (กันเพี้ยน 7 ชม.)
import { describe, it, expect } from "vitest";
import { parseSlipDate } from "@/lib/slip-date";

describe("parseSlipDate — กันเวลาสลิปเพี้ยนตาม TZ ของ server", () => {
  it("string ไม่มี TZ → ถือเป็นเวลาไทย (+07:00)", () => {
    // ผลต้องเท่ากับการตีความเป็นเวลาไทย ไม่ว่า test runner จะอยู่ TZ ไหน
    const got = parseSlipDate("2026-06-04T10:00:00");
    expect(got?.getTime()).toBe(new Date("2026-06-04T10:00:00+07:00").getTime());
  });

  it("พิสูจน์ผลต่าง: เวลาไม่มี TZ ต้อง = ไทย ไม่ใช่ UTC (ห่างกัน 7 ชม.)", () => {
    const got = parseSlipDate("2026-06-04T10:00:00")!.getTime();
    expect(got).toBe(Date.parse("2026-06-04T10:00:00+07:00"));
    expect(got).not.toBe(Date.parse("2026-06-04T10:00:00Z")); // ถ้าพลาดเป็น UTC จะเพี้ยน
  });

  it("รูปแบบเว้นวรรค 'YYYY-MM-DD HH:mm:ss' → parse ได้ (ถือเป็นเวลาไทย)", () => {
    const got = parseSlipDate("2026-06-04 10:00:00");
    expect(got?.getTime()).toBe(new Date("2026-06-04T10:00:00+07:00").getTime());
  });

  it("string ที่มี TZ (Z) อยู่แล้ว → ใช้ตามนั้น ไม่เติมไทยซ้ำ", () => {
    const got = parseSlipDate("2026-06-04T03:00:00Z");
    expect(got?.getTime()).toBe(Date.parse("2026-06-04T03:00:00Z"));
  });

  it("string ที่มี offset +07:00 อยู่แล้ว → ใช้ตามนั้น", () => {
    const got = parseSlipDate("2026-06-04T10:00:00+07:00");
    expect(got?.getTime()).toBe(Date.parse("2026-06-04T10:00:00+07:00"));
  });

  it("รองรับ offset แบบไม่มี colon (+0700)", () => {
    const got = parseSlipDate("2026-06-04T10:00:00+0700");
    expect(got?.getTime()).toBe(Date.parse("2026-06-04T10:00:00+07:00"));
  });

  it("epoch ms (number) → ใช้ตรง ๆ", () => {
    const ms = Date.parse("2026-06-04T03:00:00Z");
    expect(parseSlipDate(ms)?.getTime()).toBe(ms);
  });

  it("คืน undefined เมื่อ parse ไม่ได้ / ว่าง / null", () => {
    expect(parseSlipDate("ไม่ใช่เวลา")).toBeUndefined();
    expect(parseSlipDate("")).toBeUndefined();
    expect(parseSlipDate("   ")).toBeUndefined();
    expect(parseSlipDate(null)).toBeUndefined();
    expect(parseSlipDate(undefined)).toBeUndefined();
  });
});
