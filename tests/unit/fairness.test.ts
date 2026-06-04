// Unit tests — Fairness scoring logic (หัวใจ thesis)
// พิสูจน์ว่า time-bucket + random ให้ความเป็นธรรม:
//   - คนข้าม bucket: มาก่อนได้ก่อน (ยุติธรรมเชิงเวลาหยาบ)
//   - คนใน bucket เดียวกัน: ลำดับขึ้นกับ random ไม่ใช่เวลา ms (ยุติธรรมเชิงละเอียด)
import { describe, it, expect } from "vitest";

// จำลอง logic เดียวกับ lib/queue.ts computeFairScore
const BUCKET_SIZE_MS = 2000;
const RANDOM_RANGE = 1_000_000;

function fairScore(timeMs: number, random: number): number {
  const bucket = Math.floor(timeMs / BUCKET_SIZE_MS);
  return bucket * RANDOM_RANGE + random;
}

describe("Fairness: time-bucket + random scoring", () => {
  it("คนมาก่อน bucket ได้คิวก่อนเสมอ (ไม่ว่า random เท่าไหร่)", () => {
    // คน A มา bucket แรก (เวลา 0) random สูงสุด
    const scoreA = fairScore(0, 999_999);
    // คน B มา bucket ถัดไป (เวลา 2000) random ต่ำสุด
    const scoreB = fairScore(2000, 0);
    // A ต้องอยู่หน้า B แม้ random A สูงกว่า — bucket สำคัญกว่า
    expect(scoreA).toBeLessThan(scoreB);
  });

  it("คนใน bucket เดียวกัน: ลำดับขึ้นกับ random ไม่ใช่เวลา ms", () => {
    // คน A มาเร็วกว่า (เวลา 100ms) แต่ random สูง
    const scoreA = fairScore(100, 900_000);
    // คน B มาช้ากว่า (เวลา 1900ms ยังใน bucket เดียวกัน) แต่ random ต่ำ
    const scoreB = fairScore(1900, 100_000);
    // ทั้งคู่ bucket 0 → B (random ต่ำ) อยู่หน้า A แม้ B มาช้ากว่า
    // = ความเร็วระดับ ms ไม่มีผล (ยุติธรรม!)
    expect(scoreB).toBeLessThan(scoreA);
    expect(Math.floor(100 / BUCKET_SIZE_MS)).toBe(Math.floor(1900 / BUCKET_SIZE_MS));
  });

  it("คนเวลาเดียวกันเป๊ะ random ต่างกัน → ลำดับต่างกัน (ไม่มี tie)", () => {
    const s1 = fairScore(500, 12345);
    const s2 = fairScore(500, 67890);
    expect(s1).not.toBe(s2);
    expect(s1).toBeLessThan(s2); // random น้อยกว่าอยู่หน้า
  });

  it("การกระจาย random สม่ำเสมอ → ไม่ลำเอียงทางใดทางหนึ่ง (สถิติ)", () => {
    // จำลอง 1000 คนใน bucket เดียวกัน random uniform → ค่าเฉลี่ยควรใกล้ครึ่งช่วง
    const samples = Array.from({ length: 1000 }, () =>
      Math.floor(Math.random() * RANDOM_RANGE)
    );
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // ค่าเฉลี่ยควรอยู่ราว ๆ 500,000 (กลางช่วง) ±10%
    expect(mean).toBeGreaterThan(RANDOM_RANGE * 0.4);
    expect(mean).toBeLessThan(RANDOM_RANGE * 0.6);
  });
});
