// ============================================================
// เลือกขนาดและคุณภาพรูปผังให้พอดีกับเพดาน Server Action
// ============================================================
// แยกการตัดสินใจออกจาก Canvas เพราะ Vitest ฝั่ง Node ไม่มี API วาดรูป
// ผู้เรียกจึงฉีดตัววัดความยาว base64 เข้ามา แล้วฟังก์ชันนี้รับผิดชอบเฉพาะ
// ลำดับการลดคุณภาพ/ความละเอียดและการรักษาอัตราส่วนของรูป

export const IMAGE_FIT_WIDTHS = [2600, 2200, 1800, 1500, 1200] as const;
export const IMAGE_FIT_QUALITIES = [0.82, 0.74, 0.66] as const;
export const MAX_LAYOUT_IMAGE_UPLOAD_BASE64_LEN = 2_700_000;

export interface ImageFitPlan {
  width: number;
  height: number;
  quality: number;
}

export type MeasureBase64Length = (plan: ImageFitPlan) => number;

/**
 * คืนแผนแรกที่พอดีเพดาน โดยลองคุณภาพสูงของความกว้างใหญ่ก่อนเสมอ
 * รูปที่เล็กกว่าเป้าจะใช้ขนาดเดิม และตัด candidate ซ้ำเพื่อไม่ encode รูปเดิมหลายรอบ
 */
export function selectImageFitPlan(
  sourceWidth: number,
  sourceHeight: number,
  measureBase64Length: MeasureBase64Length,
  maxBase64Length = MAX_LAYOUT_IMAGE_UPLOAD_BASE64_LEN,
): ImageFitPlan | null {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error("ขนาดรูปต้องเป็นจำนวนบวก");
  }

  const measured = new Set<string>();

  for (const targetWidth of IMAGE_FIT_WIDTHS) {
    // ห้ามขยายรูปเล็ก เพราะไม่ได้เพิ่มรายละเอียดจริงและทำให้ payload ใหญ่ขึ้นเปล่า ๆ
    const scale = Math.min(1, targetWidth / sourceWidth);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    for (const quality of IMAGE_FIT_QUALITIES) {
      const key = `${width}x${height}@${quality}`;
      if (measured.has(key)) continue;
      measured.add(key);

      const plan = { width, height, quality };
      if (measureBase64Length(plan) <= maxBase64Length) return plan;
    }
  }

  return null;
}
