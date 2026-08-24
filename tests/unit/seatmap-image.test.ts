import { describe, expect, it, vi } from "vitest";

import {
  IMAGE_FIT_QUALITIES,
  selectImageFitPlan,
  type ImageFitPlan,
} from "@/lib/seatmap/image-fit";
import {
  aspectRatioDifference,
  hasSignificantAspectRatioChange,
} from "@/lib/seatmap/aspect-ratio";

describe("selectImageFitPlan — เลือกรูปคมที่สุดที่ยังส่งผ่าน Server Action ได้", () => {
  it("เลือกความกว้าง 2600 และคุณภาพสูงสุดเมื่อไฟล์พอดีตั้งแต่ครั้งแรก", () => {
    const measure = vi.fn(() => 2_600_000);

    expect(selectImageFitPlan(4000, 2000, measure)).toEqual({
      width: 2600,
      height: 1300,
      quality: 0.82,
    });
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("ลดคุณภาพของขนาดใหญ่ก่อน แล้วจึงลดความกว้าง", () => {
    const attempts: ImageFitPlan[] = [];
    const plan = selectImageFitPlan(4000, 2000, (candidate) => {
      attempts.push(candidate);
      return candidate.width === 2200 && candidate.quality === 0.82 ? 2_000_000 : 3_000_000;
    });

    expect(attempts.slice(0, 4)).toEqual([
      { width: 2600, height: 1300, quality: 0.82 },
      { width: 2600, height: 1300, quality: 0.74 },
      { width: 2600, height: 1300, quality: 0.66 },
      { width: 2200, height: 1100, quality: 0.82 },
    ]);
    expect(plan).toEqual({ width: 2200, height: 1100, quality: 0.82 });
  });

  it("ไม่ขยายรูปที่เล็กกว่าเป้า และไม่วัด candidate ขนาดเดิมซ้ำ", () => {
    const measure = vi.fn((_plan: ImageFitPlan) => 3_000_000);

    expect(selectImageFitPlan(1000, 750, measure)).toBeNull();
    expect(measure).toHaveBeenCalledTimes(IMAGE_FIT_QUALITIES.length);
    for (const [plan] of measure.mock.calls) {
      expect(plan).toMatchObject({ width: 1000, height: 750 });
    }
  });

  it("รักษาอัตราส่วนเมื่อย่อรูปแนวตั้ง", () => {
    const plan = selectImageFitPlan(3000, 4500, () => 1);

    expect(plan).toEqual({ width: 2600, height: 3900, quality: 0.82 });
  });

  it("ยอมรับไฟล์ที่ยาวเท่ากับเพดานพอดี", () => {
    expect(selectImageFitPlan(2600, 1300, () => 1234, 1234)).not.toBeNull();
  });

  it("คืน null เมื่อแผนเล็กสุดยังใหญ่เกินเพดาน", () => {
    expect(selectImageFitPlan(5000, 3000, () => 2_700_001)).toBeNull();
  });
});

describe("aspect ratio warning — เตือนเฉพาะเมื่อรูปร่างรูปเปลี่ยนจริง", () => {
  it("ความละเอียดต่างกันแต่อัตราส่วนเดิมไม่เตือน", () => {
    expect(hasSignificantAspectRatioChange(1600, 900, 3200, 1800)).toBe(false);
    expect(aspectRatioDifference(1600, 900, 3200, 1800)).toBe(0);
  });

  it("ต่างไม่เกิน 2% ยังไม่เตือน", () => {
    expect(hasSignificantAspectRatioChange(1000, 1000, 1020, 1000)).toBe(false);
  });

  it("ต่างเกิน 2% เตือน", () => {
    expect(hasSignificantAspectRatioChange(1000, 1000, 1021, 1000)).toBe(true);
  });

  it("ขนาดที่ใช้คำนวณไม่ได้ไม่สร้างคำเตือนลวง", () => {
    expect(aspectRatioDifference(0, 1000, 1021, 1000)).toBeNull();
    expect(hasSignificantAspectRatioChange(1000, Number.NaN, 1021, 1000)).toBe(false);
  });
});
