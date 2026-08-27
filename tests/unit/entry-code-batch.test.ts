// Unit tests — ชุด QR ล่วงหน้า (rev 42) — หน้าตั๋วขอ code หลายช่วงแล้วหมุนเองตอนเน็ตหาย
// พิสูจน์: ชุดเรียงต่อกันช่วงละ 30 วิ · ทุกภาพในชุดผ่านตรวจ ณ เวลาของมัน (และ ±1) · ภาพช่วงที่ 3 ขึ้นไปไม่ผ่านตอนนี้
//          · เพดานจำนวนแข็ง · msLeft ตรงกับ currentEntryCode
import { describe, it, expect } from "vitest";
import {
  ENTRY_CODE_WINDOW_MS,
  ENTRY_PREFETCH_WINDOWS,
  entryCodeBatch,
  entryCodeForWindow,
  currentEntryCode,
  verifyEntryCode,
} from "@/lib/entry-code";

const SECRET = "c".repeat(64);
const T0 = 1_800_000_000_000;

describe("entryCodeBatch", () => {
  it("ค่าเริ่มต้น = ENTRY_PREFETCH_WINDOWS ช่วง เริ่มที่ช่วงปัจจุบัน เรียงต่อกัน", () => {
    const b = entryCodeBatch(SECRET, undefined, T0 + 7_000);
    expect(b.codes).toHaveLength(ENTRY_PREFETCH_WINDOWS);
    const idx = Math.floor((T0 + 7_000) / ENTRY_CODE_WINDOW_MS);
    expect(b.startIndex).toBe(idx);
    b.codes.forEach((c, i) => expect(c).toBe(entryCodeForWindow(SECRET, idx + i)));
  });

  it("ภาพแรก = code เดียวกับ currentEntryCode และ msLeft เท่ากัน", () => {
    const now = T0 + 12_345;
    const b = entryCodeBatch(SECRET, 5, now);
    const cur = currentEntryCode(SECRET, now);
    expect(b.codes[0]).toBe(cur.code);
    expect(b.msLeft).toBe(cur.msLeft);
  });

  it("ทุกภาพในชุดผ่านการตรวจ ณ เวลาของช่วงนั้น (หมุนออฟไลน์ 5 นาทีแล้วยังเข้าได้)", () => {
    const b = entryCodeBatch(SECRET, undefined, T0);
    b.codes.forEach((code, i) => {
      const at = T0 + i * ENTRY_CODE_WINDOW_MS + 1_000;
      expect(verifyEntryCode(SECRET, code, at)).toBe(true);
    });
  });

  it("ภาพของช่วงที่ 3 ขึ้นไป ไม่ผ่านตรวจ ณ ตอนนี้ (ล่วงหน้าไม่ได้เปิดหน้าต่างตรวจให้กว้างขึ้น)", () => {
    const b = entryCodeBatch(SECRET, undefined, T0);
    expect(verifyEntryCode(SECRET, b.codes[1], T0)).toBe(true); // +1 ช่วง = ยอมรับอยู่แล้ว
    expect(verifyEntryCode(SECRET, b.codes[2], T0)).toBe(false);
    expect(verifyEntryCode(SECRET, b.codes[ENTRY_PREFETCH_WINDOWS - 1], T0)).toBe(false);
  });

  it("เพดานแข็ง: ขอเกิน ENTRY_PREFETCH_WINDOWS ได้แค่เพดาน · ขอ 0/ติดลบ ได้อย่างน้อย 1", () => {
    expect(entryCodeBatch(SECRET, 1_000, T0).codes).toHaveLength(ENTRY_PREFETCH_WINDOWS);
    expect(entryCodeBatch(SECRET, 0, T0).codes).toHaveLength(1);
    expect(entryCodeBatch(SECRET, -5, T0).codes).toHaveLength(1);
  });

  it("เพดาน 10 ช่วง = 5 นาที (ถ้าใครแก้ค่านี้ต้องมาแก้เทส + docs/19)", () => {
    expect(ENTRY_PREFETCH_WINDOWS * ENTRY_CODE_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});
