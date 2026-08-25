// Unit tests — sliding admit window (ต่ออายุสิทธิ์เลือกที่นั่งตามการใช้งานจริง)
// พิสูจน์ computeAdmitExtension: ต่อครั้งละ TTL / ไม่ทะลุเพดานแข็ง / ไม่หดเวลาเดิม / token เก่าไม่ต่อ
// เป็น pure function เทสตรงได้โดยไม่ต้องเปิด Redis (แบบเดียวกับ admit-capacity.test.ts)
import { describe, it, expect } from "vitest";
import { computeAdmitExtension } from "@/lib/admit-policy";

const MINUTE = 60_000;
const TTL = 5 * MINUTE; // ADMIT_TTL = 5 นาที
const HARD_CAP = 15 * MINUTE; // เพดานแข็ง = 15 นาทีนับจากถูกปล่อยเข้า
const ADMITTED_AT = 1_000_000; // เวลาอ้างอิงตอนถูกปล่อยเข้า (epoch ms สมมติ)

/** ตัวช่วยสร้าง params — ทุกเทสต่างกันแค่ "ตอนนี้กี่นาทีหลังถูกปล่อยเข้า" กับเวลาหมดอายุปัจจุบัน */
function extend(minutesAfterAdmit: number, currentExpireAt: number, admittedAt: number | null = ADMITTED_AT) {
  return computeAdmitExtension({
    now: ADMITTED_AT + minutesAfterAdmit * MINUTE,
    currentExpireAt,
    admittedAt,
    ttlMs: TTL,
    hardCapMs: HARD_CAP,
  });
}

describe("computeAdmitExtension — sliding admit window", () => {
  it("ใช้งานตอนนาที 4 (ยังไม่ชนเพดาน) → ต่อเป็น now + TTL เต็มช่วง", () => {
    // เดิมจะหมดตอนนาที 5 — ผู้ใช้เปิดดูโซนตอนนาที 4 → เลื่อนไปหมดตอนนาที 9
    expect(extend(4, ADMITTED_AT + 5 * MINUTE)).toBe(ADMITTED_AT + 9 * MINUTE);
  });

  it("ใช้งานตอนนาที 12 → ต่อได้แค่ถึงเพดานแข็ง (นาที 15) ไม่ใช่ now + TTL (นาที 17)", () => {
    expect(extend(12, ADMITTED_AT + 13 * MINUTE)).toBe(ADMITTED_AT + HARD_CAP);
  });

  it("ชนเพดานแล้ว (current = cap) → คืนค่าเดิม ไม่งอกต่อไม่ว่าจะกดถี่แค่ไหน", () => {
    expect(extend(14, ADMITTED_AT + HARD_CAP)).toBe(ADMITTED_AT + HARD_CAP);
  });

  it("ไม่มีทาง 'หด' เวลาที่ถืออยู่: current ยาวกว่าค่าที่คำนวณได้ → คงค่าเดิม", () => {
    // current ถูกตั้งไว้ไกลกว่า now + TTL (เช่นเพิ่งต่อไปหยกๆ แล้วเรียกซ้ำทันที)
    const current = ADMITTED_AT + 9 * MINUTE;
    expect(extend(1, current)).toBe(current); // ideal = นาที 6 < current นาที 9 → คงเดิม
  });

  it("token รุ่นเก่าไม่มี admittedAt → ไม่ต่อ (คำนวณเพดานไม่ได้ ปลอดภัยไว้ก่อน)", () => {
    const current = ADMITTED_AT + 5 * MINUTE;
    expect(extend(4, current, null)).toBe(current);
  });

  it("เรียกซ้ำกี่รอบก็ไม่มีทางทะลุเพดานแข็ง (จำลองผู้ใช้แอคทีฟตลอด)", () => {
    // ผู้ใช้เปิดโซนใหม่ทุก 1 นาทีตั้งแต่นาที 1 ถึง 20 — เวลาหมดอายุต้องไม่เกิน cap เลยสักครั้ง
    let expireAt = ADMITTED_AT + 5 * MINUTE;
    for (let minute = 1; minute <= 20; minute++) {
      expireAt = extend(minute, expireAt);
      expect(expireAt).toBeLessThanOrEqual(ADMITTED_AT + HARD_CAP);
    }
    expect(expireAt).toBe(ADMITTED_AT + HARD_CAP); // สุดท้ายไปจอดที่เพดานพอดี
  });

  it("ผู้ใช้แอคทีฟต่อเนื่องไม่โดนตัดกลางมือ: ทุกครั้งที่ต่อ เวลาที่เหลือ ≥ ที่มีอยู่เดิม", () => {
    let expireAt = ADMITTED_AT + 5 * MINUTE;
    for (let minute = 2; minute <= 14; minute += 2) {
      const next = extend(minute, expireAt);
      expect(next).toBeGreaterThanOrEqual(expireAt);
      expireAt = next;
    }
  });
});
