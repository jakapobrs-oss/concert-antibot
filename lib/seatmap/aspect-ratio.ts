// พิกัดกรอบเป็นสัดส่วนของรูป จึงทนต่อการเปลี่ยนความละเอียดแต่ไม่ทนต่อการเปลี่ยนรูปร่างรูป
// เก็บตรรกะนี้เป็นฟังก์ชันบริสุทธิ์เพื่อให้ขอบเขต 2% ไม่ขึ้นกับฐานข้อมูลหรือ Server Action

export const ASPECT_RATIO_WARNING_THRESHOLD = 0.02;

/** คืนสัดส่วนความต่างเทียบกับอัตราส่วนเดิม เช่น 0.025 = ต่าง 2.5% */
export function aspectRatioDifference(
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
): number | null {
  const dimensions = [oldWidth, oldHeight, newWidth, newHeight];
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) return null;

  const oldRatio = oldWidth / oldHeight;
  const newRatio = newWidth / newHeight;
  return Math.abs(newRatio - oldRatio) / oldRatio;
}

export function hasSignificantAspectRatioChange(
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
  threshold = ASPECT_RATIO_WARNING_THRESHOLD,
): boolean {
  const difference = aspectRatioDifference(oldWidth, oldHeight, newWidth, newHeight);
  // กัน floating-point ทำให้ค่าที่เท่ากับ 2% พอดีกลายเป็น 2.000000000000001% แล้วเตือนเกินจริง
  return difference !== null && difference - threshold > 1e-12;
}
