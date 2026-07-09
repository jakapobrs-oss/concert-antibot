// Unit tests — Behavior Analyzer (Layer 2 anti-bot)
// ทดสอบว่าแยกแยะ human vs bot ได้ถูกต้อง + ไม่ block คนจริง (false positive)
import { describe, it, expect } from "vitest";
import { analyzeBehavior } from "@/lib/behavior";

describe("analyzeBehavior", () => {
  it("มนุษย์ปกติ (เมาส์เยอะ, สุ่ม, dwell นาน) → score ต่ำ ไม่ใช่บอท", () => {
    const result = analyzeBehavior({
      mouseMoveCount: 120,
      keyPressCount: 15,
      mouseTimingVariance: 850,
      mousePathEntropy: 0.72,
      dwellTimeMs: 8500,
    });
    expect(result.behaviorScore).toBe(0);
    expect(result.isLikelyBot).toBe(false);
  });

  it("บอท simulate เมาส์เส้นตรง (variance ต่ำ + entropy ต่ำ + เร็ว) → จับได้", () => {
    const result = analyzeBehavior({
      mouseMoveCount: 50,
      keyPressCount: 0,
      mouseTimingVariance: 8,
      mousePathEntropy: 0.05,
      dwellTimeMs: 400,
    });
    expect(result.behaviorScore).toBeGreaterThanOrEqual(60);
    expect(result.isLikelyBot).toBe(true);
  });

  it("คนใช้ keyboard navigation (ไม่ขยับเมาส์) → น่าสงสัยแต่ไม่ฟันธงว่าบอท (กัน false positive)", () => {
    const result = analyzeBehavior({
      mouseMoveCount: 0,
      keyPressCount: 20, // พิมพ์เยอะ — เป็นคนจริงที่ใช้คีย์บอร์ด
      mouseTimingVariance: 0,
      mousePathEntropy: 0,
      dwellTimeMs: 5000, // อยู่นาน = มนุษย์
    });
    // ไม่ขยับเมาส์ +30 แต่ dwell นานไม่โดน +25 → score 30 < 60
    expect(result.isLikelyBot).toBe(false);
  });

  it("entropy/variance ไม่ถูกนับถ้าขยับเมาส์น้อยกว่า threshold (กัน noise)", () => {
    const result = analyzeBehavior({
      mouseMoveCount: 2, // น้อยกว่า MIN_MOUSE_MOVES(5)
      keyPressCount: 0,
      mouseTimingVariance: 0,
      mousePathEntropy: 0,
      dwellTimeMs: 5000,
    });
    // เฉพาะ "ขยับน้อย" +30 — ไม่นับ variance/entropy เพราะ move < 5
    expect(result.behaviorScore).toBe(30);
  });

  it("บอทนิ่งสนิท (ไม่ขยับเมาส์ + ไม่พิมพ์ + ผ่านหน้าเร็ว) → ฟันธงว่าบอท (Codex §3 #4)", () => {
    const result = analyzeBehavior({
      mouseMoveCount: 0,
      keyPressCount: 0,
      mouseTimingVariance: 0,
      mousePathEntropy: 0,
      dwellTimeMs: 0,
    });
    // 30 (ไม่ขยับ) + 25 (เร็ว) + 15 (ไม่มี interaction เลย) = 70 >= 60
    expect(result.behaviorScore).toBe(70);
    expect(result.isLikelyBot).toBe(true);
  });

  it("มือถือ (ไม่มี mousemove) แต่อยู่หน้านานพอ → ไม่ฟันธงว่าบอท (กัน false positive)", () => {
    const result = analyzeBehavior({
      mouseMoveCount: 0,
      keyPressCount: 0,
      mouseTimingVariance: 0,
      mousePathEntropy: 0,
      dwellTimeMs: 5000, // dwell >= MIN(800) → ไม่โดนทั้ง +25 และ +15 → score 30
    });
    expect(result.behaviorScore).toBe(30);
    expect(result.isLikelyBot).toBe(false);
  });

  it("score ไม่เกิน 100 (clamp)", () => {
    const result = analyzeBehavior({
      mouseMoveCount: 50,
      keyPressCount: 0,
      mouseTimingVariance: 1,
      mousePathEntropy: 0.01,
      dwellTimeMs: 50,
    });
    expect(result.behaviorScore).toBeLessThanOrEqual(100);
  });
});
