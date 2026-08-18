// ============================================================
// Seat Map Generator — โปรยที่นั่งลงในกรอบโซนที่แอดมินวาดทับรูปผัง
// ============================================================
// ที่มา: แต่ละสถานที่จัดคอนเสิร์ตพื้นที่ใช้สอยไม่เหมือนกัน จะ hardcode แถว A-E ไม่ได้
//   -> แอดมินอัปโหลดรูปผังจริง แล้วคลิกวาดกรอบ (polygon) ทับโซน + สั่งจำนวนที่นั่ง
//   -> ไฟล์นี้เจนพิกัดที่นั่งให้เต็มกรอบ "เป๊ะตามจำนวนที่สั่ง"
//
// 🔑 พิกัดทุกตัวเป็น "สัดส่วน 0-1" ของขนาดรูป ไม่ใช่พิกเซล
//    เปิดคนละจอ/รูปคนละความละเอียด ผังก็ไม่เพี้ยน
//
// ตั้งใจเขียนเป็น pure function ล้วน (ไม่มี random / ไม่มีเวลา / ไม่แตะ DB)
//   -> เทสได้ตรง ๆ และผลลัพธ์คงที่ (deterministic) เอาไปอ้างอิงในเล่มได้

/** จุดบนผัง — [x, y] เป็นสัดส่วน 0-1 ของความกว้าง/สูงรูป */
export type Point = [number, number];

/** กรอบโซนที่แอดมินคลิกวาด (ต้องมีอย่างน้อย 3 จุด) */
export type Polygon = Point[];

export interface GeneratedSeat {
  x: number;
  y: number;
  rowLabel: string; // A, B, ... Z, AA, AB (ไล่จากแถวบนสุดลงล่าง)
  seatNumber: number; // เริ่มที่ 1 ไล่ซ้ายไปขวาในแถวเดียวกัน
}

export interface FillOptions {
  /** จำนวนที่นั่งที่ต้องการเป๊ะ ๆ */
  targetCount: number;
  /**
   * อัตราส่วนรูป (กว้าง/สูง) — ใช้ชดเชยให้ระยะห่างที่นั่ง "บนจอจริง" เท่ากันทั้งสองแกน
   * เพราะพิกัดเก็บเป็นสัดส่วน 0-1 ทั้งสองแกน ถ้าไม่ชดเชย
   * รูปที่กว้างกว่าสูงจะได้ที่นั่งห่างแนวนอนเกินจริง
   * ไม่ส่ง = 1 (ถือว่ารูปจัตุรัส)
   */
  aspectRatio?: number;
}

// จำนวนรอบ binary search — 40 รอบพอให้ลู่เข้าจนความต่างต่ำกว่าความละเอียดที่ใช้จริงมาก
const BINARY_SEARCH_ROUNDS = 40;
// เพดานกันกริดระเบิด (กรณีสั่งจำนวนมหาศาลหรือกรอบผอมมาก) — เกินนี้ถือว่า "แน่นเกินไป"
const MAX_GRID_POINTS = 250_000;
// ปัดพิกัดกี่ตำแหน่งทศนิยม — ละเอียดพอสำหรับรูป 1600px และทำให้ค่าที่เก็บลง DB สะอาด
const COORD_PRECISION = 6;

/**
 * เช็คว่าจุดอยู่ในกรอบไหม ด้วยวิธี ray casting
 * (ยิงรังสีไปทางขวา นับว่าตัดขอบกี่ครั้ง — คี่ = อยู่ข้างใน)
 * ใช้ได้กับกรอบเว้า (concave) เช่นผังรูปตัว L ด้วย ไม่ต้องพึ่ง library
 */
export function isPointInPolygon(point: Point, polygon: Polygon): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    // ขอบเส้นนี้คร่อมระดับ y ของจุดหรือไม่
    const straddles = yi > py !== yj > py;
    if (straddles && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** พื้นที่กรอบ ด้วยสูตร shoelace — ใช้เดาระยะห่างเริ่มต้นก่อน binary search */
function polygonArea(polygon: Polygon): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += (polygon[j][0] + polygon[i][0]) * (polygon[j][1] - polygon[i][1]);
  }
  return Math.abs(sum) / 2;
}

interface BoundingBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function boundingBoxOf(polygon: Polygon): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

interface GridPoint {
  x: number;
  y: number;
  row: number;
}

/**
 * วางกริดทับ bounding box แล้วเก็บเฉพาะจุดที่ตกอยู่ในกรอบ
 * คืน null ถ้ากริดแน่นเกินเพดาน (ให้ผู้เรียกตีความว่า "ได้จำนวนเกินเป้าแน่นอน")
 */
function collectGridPoints(
  polygon: Polygon,
  box: BoundingBox,
  spacingY: number,
  aspectRatio: number,
): GridPoint[] | null {
  const spacingX = spacingY / aspectRatio;
  const cols = Math.floor(box.width / spacingX) + 1;
  const rows = Math.floor(box.height / spacingY) + 1;
  if (cols * rows > MAX_GRID_POINTS) return null;

  // จัดกริดให้อยู่กึ่งกลางกรอบ — เศษที่เหลือกระจายเท่ากันสองข้าง ไม่เบียดไปด้านเดียว
  const offsetX = box.minX + (box.width - (cols - 1) * spacingX) / 2;
  const offsetY = box.minY + (box.height - (rows - 1) * spacingY) / 2;

  const points: GridPoint[] = [];
  for (let r = 0; r < rows; r++) {
    const y = offsetY + r * spacingY;
    for (let c = 0; c < cols; c++) {
      const x = offsetX + c * spacingX;
      if (isPointInPolygon([x, y], polygon)) points.push({ x, y, row: r });
    }
  }
  return points;
}

/** จำนวนจุดที่ระยะห่างค่าหนึ่ง — null (แน่นเกินเพดาน) นับเป็น Infinity */
function countAtSpacing(
  polygon: Polygon,
  box: BoundingBox,
  spacingY: number,
  aspectRatio: number,
): number {
  const points = collectGridPoints(polygon, box, spacingY, aspectRatio);
  return points === null ? Infinity : points.length;
}

/**
 * หา "ระยะห่างที่มากที่สุด" ที่ยังได้จำนวนที่นั่งไม่น้อยกว่าเป้า
 * ระยะห่างยิ่งมาก จำนวนยิ่งน้อย -> ใช้ binary search ได้
 * เริ่มจากค่าประมาณเชิงพื้นที่ (จำนวน ~ พื้นที่ หารด้วยระยะห่างยกกำลังสอง) แล้วขยายขอบถ้าเดาพลาด
 */
function findSpacingFor(
  polygon: Polygon,
  box: BoundingBox,
  target: number,
  aspectRatio: number,
): number {
  const area = polygonArea(polygon);
  const estimate = Math.sqrt((area * aspectRatio) / target);

  // lo = ต้องได้ "เยอะกว่าเป้า", hi = ต้องได้ "น้อยกว่าเป้า"
  let lo = estimate / 4;
  let hi = estimate * 4;

  // เดาพลาด: lo ยังได้ไม่ถึงเป้า -> บีบให้ถี่ขึ้นเรื่อย ๆ (กรอบผอม/เว้ามากจะเข้าเคสนี้)
  let guard = 0;
  while (countAtSpacing(polygon, box, lo, aspectRatio) < target && guard++ < 20) {
    lo /= 2;
  }
  // เดาพลาด: hi ยังได้เกินเป้า -> ถ่างให้ห่างขึ้นเรื่อย ๆ
  guard = 0;
  while (countAtSpacing(polygon, box, hi, aspectRatio) >= target && guard++ < 20) {
    hi *= 2;
  }

  for (let i = 0; i < BINARY_SEARCH_ROUNDS; i++) {
    const mid = (lo + hi) / 2;
    if (countAtSpacing(polygon, box, mid, aspectRatio) >= target) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** 0 ได้ A, 25 ได้ Z, 26 ได้ AA, 27 ได้ AB (เลขฐาน 26 แบบ bijective — ไม่มีแถวชื่อซ้ำ) */
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

function round(value: number): number {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(value * factor) / factor;
}

/**
 * โปรยที่นั่งให้เต็มกรอบ ได้จำนวนเป๊ะตามที่สั่ง
 *
 * ขั้นตอน: หา bounding box -> binary search หาระยะห่าง -> คัดเฉพาะจุดในกรอบ
 *          -> ตัดส่วนเกินจากท้าย (แถวล่างสุด ขวาสุด) -> ตั้งชื่อแถว/เลขที่นั่งใหม่
 */
export function fillPolygonWithSeats(polygon: Polygon, options: FillOptions): GeneratedSeat[] {
  const target = Math.floor(options.targetCount);
  const aspectRatio = options.aspectRatio && options.aspectRatio > 0 ? options.aspectRatio : 1;
  if (target <= 0 || polygon.length < 3) return [];

  const box = boundingBoxOf(polygon);
  if (box.width <= 0 || box.height <= 0) return [];

  const spacing = findSpacingFor(polygon, box, target, aspectRatio);
  const points = collectGridPoints(polygon, box, spacing, aspectRatio) ?? [];

  // จัดกลุ่มตามแถว (แถวบนสุดก่อน) เพื่อเลือกทีละแถวจนครบจำนวนที่สั่ง
  const rows = new Map<number, GridPoint[]>();
  for (const point of points) {
    const bucket = rows.get(point.row);
    if (bucket) bucket.push(point);
    else rows.set(point.row, [point]);
  }
  const orderedRows = [...rows.entries()].sort((a, b) => a[0] - b[0]);

  // เก็บแถวเต็มไปเรื่อย ๆ จนเหลือไม่พอ แถวสุดท้ายจึงเป็นแถวที่ไม่เต็ม
  const selectedRows: GridPoint[][] = [];
  let remaining = target;
  for (const [, pointsInRow] of orderedRows) {
    if (remaining <= 0) break;
    pointsInRow.sort((a, b) => a.x - b.x);
    if (pointsInRow.length <= remaining) {
      selectedRows.push(pointsInRow);
      remaining -= pointsInRow.length;
    } else {
      // แถวสุดท้ายที่ไม่เต็ม — เลือก "ช่วงกลางแถว" ไม่ใช่กองชิดซ้าย
      // เพราะแถวหลังของโรงมหรสพจริงจะเว้นสองข้างเท่ากัน ถ้าชิดซ้ายจะดูเหมือนระบบเจนพลาด
      const start = Math.floor((pointsInRow.length - remaining) / 2);
      selectedRows.push(pointsInRow.slice(start, start + remaining));
      remaining = 0;
    }
  }

  // ตั้งชื่อแถวใหม่แบบเรียงต่อเนื่อง (ต้องทำหลังเลือกเสร็จ ไม่งั้นชื่อแถวขาดช่วง เช่น A, B, D)
  const seats: GeneratedSeat[] = [];
  selectedRows.forEach((pointsInRow, rowIndex) => {
    pointsInRow.forEach((point, seatIndex) => {
      seats.push({
        x: round(point.x),
        y: round(point.y),
        rowLabel: rowLabelFor(rowIndex),
        seatNumber: seatIndex + 1,
      });
    });
  });

  return seats;
}
