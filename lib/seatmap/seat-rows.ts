// ============================================================
// เจนรายชื่อที่นั่งในโซน — A1..A20, B1..B20, ...
// ============================================================
// ที่มา (สำคัญ ถ้าจะเข้าใจว่าทำไมไฟล์นี้ถึงง่ายกว่าของเดิมมาก):
//   รุ่นแรกเจนที่นั่งด้วยการ "โปรยจุดให้เต็มกรอบที่วาด" — ต้องคำนวณพื้นที่กรอบ หาระยะห่าง
//   ด้วย binary search และหมุนกริดตามมุมเอียงของบล็อก เพื่อให้จุดบนผังดูเหมือนผังจริง
//   แต่โจทย์จริงคือ "ผังบอกแค่ว่าเวทีอยู่ไหน โซนไหนอยู่ตรงไหน" ไม่ได้ต้องการจุดรายที่นั่งบนรูป
//   -> ผังหลักเลยแสดงเป็นแผ่นสีระดับโซน ส่วนการเลือกที่นั่งย้ายไปแผงย่อยแบบปุ่ม A1/A2/...
//   -> ที่นั่งจึงต้องการแค่ "ชื่อแถว + เลขที่นั่ง" ไม่ต้องมีพิกัดบนรูปอีกต่อไป
//
// pure function ล้วน (ไม่มี random / ไม่แตะ DB) -> จำนวนเท่าเดิมได้ผลเดิมทุกครั้ง

export interface SeatSpot {
  rowLabel: string; // A, B, ... Z, AA, AB
  seatNumber: number; // เริ่มที่ 1 ในทุกแถว
}

// สัดส่วนความกว้าง:ความลึกของบล็อกที่นั่งที่ใช้ประมาณจำนวนที่นั่งต่อแถว
// บล็อกในโรงมหรสพจริงกว้างกว่าลึกประมาณเท่าตัว -> แถวยาว 2 เท่าของจำนวนแถว
const BLOCK_WIDTH_TO_DEPTH = 2;
// ขอบเขตจำนวนที่นั่งต่อแถว — น้อยกว่านี้แถวจะเยอะจนเลื่อนหาไม่เจอ มากกว่านี้แถวยาวจนล้นจอมือถือ
const MIN_SEATS_PER_ROW = 8;
const MAX_SEATS_PER_ROW = 40;

/** 0 ได้ A, 25 ได้ Z, 26 ได้ AA, 27 ได้ AB (เลขฐาน 26 แบบ bijective — ไม่มีชื่อแถวซ้ำ) */
export function rowLabelFor(index: number): string {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/**
 * ลำดับ "อ่านผัง" — แถวบนลงล่าง ในแถวเรียงซ้ายไปขวา (A1, A2, …, B1, …, Z10, AA1)
 *
 * ใช้ตอนจับคู่ที่นั่งเดิมในฐานข้อมูลกับรายการที่นั่งชุดใหม่
 * ต้องเทียบ "ความยาวชื่อแถว" ก่อนตัวอักษร เพราะชื่อแถวไล่ A..Z แล้วขึ้น AA
 * ถ้าเรียงแบบ string ล้วน AA จะไปแทรกระหว่าง A กับ B → ที่นั่งเลื่อนผิดตำแหน่งยกโซน
 */
export function compareSeatOrder<T extends { rowLabel: string; seatNumber: number }>(
  a: T,
  b: T,
): number {
  return (
    a.rowLabel.length - b.rowLabel.length ||
    a.rowLabel.localeCompare(b.rowLabel) ||
    a.seatNumber - b.seatNumber
  );
}

/**
 * จำนวนที่นั่งต่อแถวที่เหมาะกับขนาดโซน — ให้บล็อกออกมากว้างกว่าลึกเหมือนของจริง
 * เช่น 200 ที่ -> 20 ที่/แถว (10 แถว), 1,000 ที่ -> 40 ที่/แถว (25 แถว)
 */
export function defaultSeatsPerRow(seatCount: number): number {
  const ideal = Math.round(Math.sqrt(seatCount * BLOCK_WIDTH_TO_DEPTH));
  return Math.min(MAX_SEATS_PER_ROW, Math.max(MIN_SEATS_PER_ROW, ideal));
}

/**
 * เจนรายชื่อที่นั่งให้ครบตามจำนวนที่สั่ง
 * แถวสุดท้ายไม่เต็มได้ (โซนจริงก็มีแถวท้ายที่สั้นกว่าเพื่อน)
 */
export function buildSeatRows(seatCount: number, seatsPerRow?: number): SeatSpot[] {
  const total = Math.floor(seatCount);
  if (!Number.isFinite(total) || total <= 0) return [];

  const perRow =
    seatsPerRow && seatsPerRow > 0 ? Math.floor(seatsPerRow) : defaultSeatsPerRow(total);

  const seats: SeatSpot[] = [];
  for (let index = 0; index < total; index++) {
    seats.push({
      rowLabel: rowLabelFor(Math.floor(index / perRow)),
      seatNumber: (index % perRow) + 1,
    });
  }
  return seats;
}
