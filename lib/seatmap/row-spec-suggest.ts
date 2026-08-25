// ============================================================
// เสนอ "ที่นั่งต่อแถว" (rowSpec) จากรูปทรงกรอบโซน — ระดับ A: เสนอให้ก่อน แอดมินแก้ทับได้
// ============================================================
// โจทย์: แอดมินมี "จำนวนที่นั่งรวม" จาก Excel + "กรอบโซน" ที่วาดทับรูปแล้ว
// แต่ยังต้องพิมพ์ที่นั่งรายแถว (เช่น 14,14,…,6,6,…,12) เองทั้ง 69 โซน
// ฟังก์ชันนี้แจกที่นั่งรวมลงแถวตาม "ความกว้างของกรอบที่ความลึกแต่ละแถว"
// → ได้แถวที่เป็น "เงา" ของโซนบนรูป (หัวกว้าง กลางคอด ท้ายกว้าง ฯลฯ)
//
// สิ่งที่มันรู้ไม่ได้ (บอกแอดมินตรง ๆ): รูปผังไม่มีเส้นแถว/เลขที่นั่ง
// เครื่องเห็นแค่รูปทรง จึงถูกได้ระดับ ±1–2 ที่ต่อแถว และโซนที่วางเอียง
// (แถวจริงวิ่งเฉียง แต่เราหั่นแนวนอน) จะได้แถวเศษที่หัว-ท้าย — ตัวเลขสุดท้ายต้องเป็นของคน
//
// จำนวนแถว: ถ้าแอดมินไม่บอก ระบบเลือกให้จาก "สัดส่วนความลึกแถว : ความกว้างที่นั่ง"
// ของอารีน่าทั่วไป (แถวลึก ~0.9 ม. ที่นั่งกว้าง ~0.5 ม.) เทียบกับขนาดกรอบบนรูป
// ผลรวมทุกแถวเท่ากับจำนวนที่นั่งรวมเสมอ (ด่าน saveZoneRowSpec บังคับอยู่แล้ว)
//
// เป็น pure function: ใช้ได้ทั้งฝั่งเบราว์เซอร์ (ปุ่มเสนอในหน้า editor) และ server action (ยกชุด)

import { isPointInPolygon, type Polygon, type StageSide } from "@/lib/seatmap/polygon";
import { MAX_ROWS, MAX_SEATS_PER_ZONE } from "@/lib/seatmap/seat-rows";

export interface SuggestRowSpecInput {
  polygon: Polygon | null;
  /** ทิศเวทีของโซน — null = ไม่รู้ ถือว่าเวทีอยู่บน (แถว A = ขอบบนของกรอบ) */
  stageSide: StageSide | null;
  /** จำนวนที่นั่งรวมของโซน (จาก Excel) — ผลลัพธ์ต้องรวมได้เท่านี้เป๊ะ */
  seatCount: number;
  /** ขนาดรูปผัง (px) — พิกัดกรอบเป็นสัดส่วน 0–1 ต้องคูณกลับถึงจะได้รูปทรงจริง */
  imageWidth: number;
  imageHeight: number;
  /** จำนวนแถวที่แอดมินรู้อยู่แล้ว — ไม่ระบุ = ให้ระบบเลือก */
  rowCount?: number;
}

/** ความลึกแถว : ความกว้างที่นั่ง ของอารีน่าทั่วไป (~0.9 ม. : ~0.5 ม.) — ใช้เดาจำนวนแถวเมื่อแอดมินไม่บอก */
const ROW_DEPTH_TO_SEAT_WIDTH = 1.8;
/** ความละเอียดการวัดความกว้างกรอบตามความลึก — ละเอียดกว่าจำนวนแถวสูงสุดพอสมควร */
const DEPTH_SAMPLES = 512;
/** จำนวนจุดสุ่มตามแนวกว้างต่อหนึ่งความลึก — นับจุดที่อยู่ในกรอบ (รองรับรูปทรงที่มีร่อง/แขนหลายท่อน) */
const WIDTH_SAMPLES = 96;

type PixelPoint = [number, number];

/**
 * แปลงกรอบเป็นพิกเซล แล้วหมุน/พลิกให้ "แถวหน้าสุด (A)" อยู่ขอบบนเสมอ
 * → หลังจากนี้ ความลึกของแถว = แกน y ทุกกรณี ไม่ต้องแยกเคสทิศเวทีอีก
 */
function toRowAxisSpace(
  polygon: Polygon,
  stageSide: StageSide | null,
  imageWidth: number,
  imageHeight: number,
): PixelPoint[] {
  const pixels: PixelPoint[] = polygon.map(([x, y]) => [x * imageWidth, y * imageHeight]);
  switch (stageSide) {
    case "left":
      // แถววิ่งตามแกน x (หน้าสุด = ซ้ายสุด) → สลับแกนให้ซ้ายกลายเป็นบน
      return pixels.map(([x, y]) => [y, x]);
    case "right":
      // หน้าสุด = ขวาสุด → สลับแกนแล้วพลิกให้ขวากลายเป็นบน
      return pixels.map(([x, y]) => [y, imageWidth - x]);
    case "bottom":
      return pixels.map(([x, y]) => [x, imageHeight - y]);
    default:
      return pixels;
  }
}

/** ความกว้างของกรอบ (px) ที่แต่ละความลึก 0..1 — วัดโดยนับจุดที่อยู่ในกรอบตามแนวกว้าง */
function measureWidthsByDepth(points: PixelPoint[]): { widths: number[]; boxHeight: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  if (!(boxWidth > 0) || !(boxHeight > 0)) return null;

  const cellWidth = boxWidth / WIDTH_SAMPLES;
  const widths: number[] = [];
  for (let depthIndex = 0; depthIndex < DEPTH_SAMPLES; depthIndex++) {
    const y = minY + ((depthIndex + 0.5) / DEPTH_SAMPLES) * boxHeight;
    let insideCount = 0;
    for (let col = 0; col < WIDTH_SAMPLES; col++) {
      const x = minX + (col + 0.5) * cellWidth;
      if (isPointInPolygon(points, [x, y])) insideCount += 1;
    }
    widths.push(insideCount * cellWidth);
  }
  return { widths, boxHeight };
}

/** ความกว้างเฉลี่ยของแต่ละแถว เมื่อแบ่งความลึกเป็น rowCount ช่วงเท่า ๆ กัน */
function averageWidthPerRow(widths: number[], rowCount: number): number[] {
  const prefix = new Array<number>(widths.length + 1).fill(0);
  widths.forEach((width, index) => {
    prefix[index + 1] = prefix[index] + width;
  });
  const result: number[] = [];
  for (let row = 0; row < rowCount; row++) {
    const from = Math.floor((row / rowCount) * widths.length);
    const to = Math.max(from + 1, Math.floor(((row + 1) / rowCount) * widths.length));
    result.push((prefix[to] - prefix[from]) / (to - from));
  }
  return result;
}

/**
 * เลือกจำนวนแถวที่ทำให้ "ที่นั่งที่กรอบรับได้" ใกล้จำนวนที่นั่งจริงที่สุด
 * ที่นั่งที่รับได้ = Σ ความกว้างแถว / ความกว้างที่นั่ง โดยความกว้างที่นั่ง = ความลึกแถว / 1.8
 */
function chooseRowCount(widths: number[], boxHeight: number, seatCount: number): number {
  const maxRows = Math.min(MAX_ROWS, seatCount);
  let bestRows = 1;
  let bestGap = Infinity;
  for (let rows = 1; rows <= maxRows; rows++) {
    const seatWidth = boxHeight / rows / ROW_DEPTH_TO_SEAT_WIDTH;
    const capacity = averageWidthPerRow(widths, rows).reduce(
      (sum, width) => sum + width / seatWidth,
      0,
    );
    const gap = Math.abs(capacity - seatCount);
    if (gap < bestGap) {
      bestGap = gap;
      bestRows = rows;
    }
    // เกินเป้าไปแล้วและห่างขึ้นเรื่อย ๆ → เลิกวน (ความจุโตตามจำนวนแถวแบบไม่ย้อนกลับ)
    if (capacity > seatCount && gap > bestGap) break;
  }
  return bestRows;
}

/**
 * แจกจำนวนที่นั่งรวมลงแถวตามสัดส่วนความกว้าง ให้ทุกแถว ≥ 1 และรวมเท่ากับ seatCount เป๊ะ
 * ใช้วิธีเศษมากได้ก่อน (largest remainder) — แถวที่ปัดเศษทิ้งมากสุดได้ที่นั่งคืนก่อน
 */
function distributeSeats(rowWidths: number[], seatCount: number): number[] {
  const totalWidth = rowWidths.reduce((sum, width) => sum + width, 0);
  const rowCount = rowWidths.length;
  // กรอบบางจนวัดความกว้างไม่ได้เลย → แจกเท่ากันทุกแถว ดีกว่าเดามั่ว
  const shares =
    totalWidth > 0
      ? rowWidths.map((width) => (width / totalWidth) * seatCount)
      : rowWidths.map(() => seatCount / rowCount);

  const seats = shares.map((share) => Math.max(1, Math.floor(share)));
  let remaining = seatCount - seats.reduce((sum, count) => sum + count, 0);

  if (remaining > 0) {
    // เติมทีละ 1 ให้แถวที่ถูกปัดเศษทิ้งมากสุดก่อน วนจนครบ
    const order = shares
      .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    let cursor = 0;
    while (remaining > 0) {
      seats[order[cursor % rowCount].index] += 1;
      remaining -= 1;
      cursor += 1;
    }
  } else {
    // การบังคับขั้นต่ำ 1 ที่/แถว ทำให้เกินเป้า → หักจากแถวที่ใหญ่สุดทีละ 1
    while (remaining < 0) {
      let largest = 0;
      for (let index = 1; index < rowCount; index++) {
        if (seats[index] > seats[largest]) largest = index;
      }
      if (seats[largest] <= 1) break; // ทุกแถวเหลือ 1 แล้ว (เกิดไม่ได้ถ้า rowCount ≤ seatCount)
      seats[largest] -= 1;
      remaining += 1;
    }
  }
  return seats;
}

/**
 * เสนอที่นั่งต่อแถวจากกรอบโซน — คืน null เมื่อข้อมูลไม่พอ (ไม่มีกรอบ / จำนวนที่นั่งไม่ถูก)
 * ผลลัพธ์: แถว A อยู่ index 0 (หน้าสุดใกล้เวที) ตามรูปแบบ rowSpec เดิมของระบบ
 */
export function suggestRowSpec(input: SuggestRowSpecInput): number[] | null {
  const { polygon, stageSide, seatCount, rowCount } = input;
  if (!polygon || polygon.length < 3) return null;
  if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > MAX_SEATS_PER_ZONE) return null;

  // ไม่รู้ขนาดรูป → ถือว่าจัตุรัส (รูปทรงยังใช้ได้ แค่สัดส่วนกว้าง:ลึกอาจคลาด)
  const imageWidth = input.imageWidth > 0 ? input.imageWidth : 1;
  const imageHeight = input.imageHeight > 0 ? input.imageHeight : 1;

  const measured = measureWidthsByDepth(
    toRowAxisSpace(polygon, stageSide, imageWidth, imageHeight),
  );
  if (!measured) return null;

  // แต่ละแถวต้องมีอย่างน้อย 1 ที่ → จำนวนแถวเกินจำนวนที่นั่งไม่ได้
  const rows =
    rowCount !== undefined && Number.isInteger(rowCount) && rowCount >= 1
      ? Math.min(rowCount, MAX_ROWS, seatCount)
      : chooseRowCount(measured.widths, measured.boxHeight, seatCount);

  return distributeSeats(averageWidthPerRow(measured.widths, rows), seatCount);
}
