// Unit tests — capacity-aware admission logic (queue-runner: ปล่อยคิวตามความจุห้อง + ที่นั่งเหลือ)
// พิสูจน์ computeAdmitLimit = min(batch, cap−inside, seatsLeft) clamp 0 โดยไม่ต้องเปิด Redis
import { describe, it, expect } from "vitest";
import { computeAdmitLimit } from "@/lib/admit-policy";

describe("computeAdmitLimit — capacity-aware admission", () => {
  it("ไม่ส่ง cap/seatsLeft → ปล่อยตาม batch เต็ม (พฤติกรรมเดิม ก่อนทำ capacity-aware)", () => {
    expect(computeAdmitLimit(100, {})).toBe(100);
    expect(computeAdmitLimit(10, {})).toBe(10);
  });

  it("cap เป็นตัวคุม: ปล่อยได้แค่ (cap − inside)", () => {
    // ห้องจุ 200 มีคนอยู่แล้ว 150 → ปล่อยเพิ่มได้แค่ 50 แม้ batch = 100
    expect(computeAdmitLimit(100, { cap: 200, inside: 150 })).toBe(50);
  });

  it("seatsLeft เป็นตัวคุม: ไม่ปล่อยเกินที่นั่งที่เหลือ (กัน over-admission)", () => {
    // ที่นั่งเหลือ 30 แม้ห้องยังว่างเยอะ + batch ใหญ่ → ปล่อยได้แค่ 30
    expect(computeAdmitLimit(100, { cap: 200, inside: 0, seatsLeft: 30 })).toBe(30);
  });

  it("ตัวไหนน้อยสุดเป็นตัวคุมเสมอ (batch เล็กสุด)", () => {
    expect(computeAdmitLimit(5, { cap: 200, inside: 0, seatsLeft: 100 })).toBe(5);
  });

  it("เต็มความจุ (inside = cap) → 0 ไม่ปล่อยเพิ่ม", () => {
    expect(computeAdmitLimit(100, { cap: 200, inside: 200 })).toBe(0);
  });

  it("ที่นั่งหมด (seatsLeft = 0) → 0 ไม่ปล่อยเพิ่ม", () => {
    expect(computeAdmitLimit(100, { cap: 200, inside: 0, seatsLeft: 0 })).toBe(0);
  });

  it("inside ล้น cap (เคย over-admit) → clamp 0 ไม่ติดลบ", () => {
    expect(computeAdmitLimit(100, { cap: 200, inside: 250 })).toBe(0);
  });

  it("self-refill: พอคนข้างในลดลง ความจุคืน → รอบถัดไปปล่อยได้เพิ่ม", () => {
    // รอบแรกเต็ม (inside 200 = cap) → 0
    expect(computeAdmitLimit(100, { cap: 200, inside: 200, seatsLeft: 500 })).toBe(0);
    // มีคนจ่ายเสร็จ/หมดเวลา 40 คน → inside 160 → ปล่อยได้อีก 40 (จนเต็ม cap อีกครั้ง)
    expect(computeAdmitLimit(100, { cap: 200, inside: 160, seatsLeft: 500 })).toBe(40);
  });
});
