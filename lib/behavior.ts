// ============================================================
// Behavior Analyzer — Layer 2 (Phase 6)
// ============================================================
// วิเคราะห์ feature พฤติกรรมที่ client ส่งมา → คะแนน behavior 0-100
//
// หลักการ (เขียนใน thesis ได้):
//   มนุษย์ vs บอท ต่างกันที่ "ความเป็นธรรมชาติ" ของการเคลื่อนไหว:
//   - มนุษย์: ขยับเมาส์เป็นเส้นโค้ง, timing ไม่สม่ำเสมอ (variance สูง), มี dwell time
//   - บอท: เคลื่อนเป็นเส้นตรง/teleport, timing สม่ำเสมอเป๊ะ (variance ต่ำ), เร็วผิดมนุษย์
//
//   เราไม่ block จาก behavior อย่างเดียว — เป็น "signal เสริม" รวมกับ Layer 1
//   (กัน false positive: คนพิการ/ใช้ keyboard navigation อาจมี pattern ต่าง)

export interface BehaviorFeatures {
  mouseMoveCount: number;
  keyPressCount: number;
  mouseTimingVariance: number; // variance ของ inter-event time (ms²)
  mousePathEntropy: number; // 0-1 (0=เส้นตรง, 1=สุ่มมาก)
  dwellTimeMs: number; // เวลาบนหน้า
}

export interface BehaviorAssessment {
  behaviorScore: number; // 0-100 (สูง = น่าจะบอท)
  isLikelyBot: boolean;
  reasons: string[];
}

// threshold สำหรับตัดสิน (ปรับจากการทดลองได้)
const THRESHOLDS = {
  MIN_MOUSE_MOVES: 5, // น้อยกว่านี้ในเวลาที่ผ่านมา = น่าสงสัย (บอทไม่ขยับ)
  MIN_DWELL_MS: 800, // เร็วกว่านี้ = เร็วผิดมนุษย์
  LOW_VARIANCE: 50, // variance ต่ำกว่านี้ = timing สม่ำเสมอผิดธรรมชาติ
  LOW_ENTROPY: 0.15, // entropy ต่ำกว่านี้ = เส้นตรงเกินไป
  BOT_SCORE: 60, // behaviorScore เกินนี้ = isLikelyBot
};

export function analyzeBehavior(f: BehaviorFeatures): BehaviorAssessment {
  let score = 0;
  const reasons: string[] = [];

  // 1. ไม่ขยับเมาส์เลย / น้อยมาก (บอทมักไม่ขยับ)
  if (f.mouseMoveCount < THRESHOLDS.MIN_MOUSE_MOVES) {
    score += 30;
    reasons.push("ขยับเมาส์น้อยผิดปกติ");
  }

  // 2. อยู่บนหน้าเร็วเกินมนุษย์
  if (f.dwellTimeMs < THRESHOLDS.MIN_DWELL_MS) {
    score += 25;
    reasons.push("ใช้เวลาบนหน้าน้อยผิดปกติ");
  }

  // 3. timing สม่ำเสมอเกินไป (variance ต่ำ) — แต่เฉพาะเมื่อมีการขยับพอควร
  if (f.mouseMoveCount >= THRESHOLDS.MIN_MOUSE_MOVES && f.mouseTimingVariance < THRESHOLDS.LOW_VARIANCE) {
    score += 25;
    reasons.push("จังหวะการเคลื่อนไหวสม่ำเสมอผิดธรรมชาติ");
  }

  // 4. เส้นทางเมาส์ตรงเกินไป (entropy ต่ำ)
  if (f.mouseMoveCount >= THRESHOLDS.MIN_MOUSE_MOVES && f.mousePathEntropy < THRESHOLDS.LOW_ENTROPY) {
    score += 20;
    reasons.push("เส้นทางเมาส์เป็นเส้นตรงผิดธรรมชาติ");
  }

  score = Math.min(100, score);

  return {
    behaviorScore: score,
    isLikelyBot: score >= THRESHOLDS.BOT_SCORE,
    reasons,
  };
}

export const BEHAVIOR_CONFIG = THRESHOLDS;
