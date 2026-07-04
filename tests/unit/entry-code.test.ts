// Unit tests — dynamic QR entry code (docs/19 Phase 3)
// พิสูจน์: code หมุนตาม window / verify รับ ±1 window / ภาพแคปเก่าใช้ไม่ได้ / fail-closed
import { describe, it, expect } from "vitest";
import {
  ENTRY_CODE_WINDOW_MS,
  entryCodeForWindow,
  currentEntryCode,
  verifyEntryCode,
  buildEntryQrText,
  parseEntryQrText,
} from "@/lib/entry-code";

const SECRET = "a".repeat(64);
const T0 = 1_800_000_000_000; // เวลาอ้างอิงกลม ๆ (หาร window ลงตัว)

describe("entryCodeForWindow / currentEntryCode", () => {
  it("window เดียวกัน → code เดิมเสมอ (deterministic)", () => {
    expect(entryCodeForWindow(SECRET, 123)).toBe(entryCodeForWindow(SECRET, 123));
  });

  it("คนละ window / คนละ secret → code ต่างกัน", () => {
    expect(entryCodeForWindow(SECRET, 1)).not.toBe(entryCodeForWindow(SECRET, 2));
    expect(entryCodeForWindow(SECRET, 1)).not.toBe(entryCodeForWindow("b".repeat(64), 1));
  });

  it("currentEntryCode คืน msLeft ที่นับถอยหลังใน window", () => {
    const { msLeft } = currentEntryCode(SECRET, T0 + 10_000);
    expect(msLeft).toBe(ENTRY_CODE_WINDOW_MS - 10_000);
  });
});

describe("verifyEntryCode — ตรวจตอนสแกนเข้างาน", () => {
  it("code ของ window ปัจจุบันผ่าน", () => {
    const { code } = currentEntryCode(SECRET, T0);
    expect(verifyEntryCode(SECRET, code, T0 + 5_000)).toBe(true);
  });

  it("ยอมรับ ±1 window (กด QR ตอนรอยต่อ/นาฬิกาเพี้ยนเล็กน้อย)", () => {
    const prev = currentEntryCode(SECRET, T0 - ENTRY_CODE_WINDOW_MS).code;
    const next = currentEntryCode(SECRET, T0 + ENTRY_CODE_WINDOW_MS).code;
    expect(verifyEntryCode(SECRET, prev, T0)).toBe(true);
    expect(verifyEntryCode(SECRET, next, T0)).toBe(true);
  });

  it("❌ ภาพแคป QR เก่ากว่า 1 window → ใช้ไม่ได้ (หัวใจของ dynamic QR)", () => {
    const old = currentEntryCode(SECRET, T0 - 2 * ENTRY_CODE_WINDOW_MS).code;
    expect(verifyEntryCode(SECRET, old, T0)).toBe(false);
  });

  it("รับ code แบบ lowercase/มีช่องว่าง (normalize ก่อนเทียบ)", () => {
    const { code } = currentEntryCode(SECRET, T0);
    expect(verifyEntryCode(SECRET, ` ${code.toLowerCase()} `, T0)).toBe(true);
  });

  it("❌ fail-closed: ไม่มี secret (ตั๋วเก่า) หรือ code ว่าง → ไม่ผ่าน", () => {
    const { code } = currentEntryCode(SECRET, T0);
    expect(verifyEntryCode("", code, T0)).toBe(false);
    expect(verifyEntryCode(SECRET, "", T0)).toBe(false);
    expect(verifyEntryCode(SECRET, "WRONGCODE1", T0)).toBe(false);
  });
});

describe("buildEntryQrText / parseEntryQrText — รูปแบบเนื้อหาใน QR", () => {
  it("round-trip ได้", () => {
    const text = buildEntryQrText("42", "ABCDEF1234");
    expect(parseEntryQrText(text)).toEqual({ ticketId: "42", code: "ABCDEF1234" });
  });

  it("❌ ปฏิเสธรูปแบบแปลก (ไม่ใช่ QR ของระบบ / ticketId ไม่ใช่ตัวเลข)", () => {
    expect(parseEntryQrText("TKT-abcdef")).toBeNull(); // static QR แบบเก่า
    expect(parseEntryQrText("ENT:abc:CODE")).toBeNull();
    expect(parseEntryQrText("ENT:42")).toBeNull();
    expect(parseEntryQrText("")).toBeNull();
  });
});
