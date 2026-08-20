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
// เอียงน้อยกว่านี้ถือว่าตรงแนวอยู่แล้ว — ไม่หมุน เพื่อให้ผังที่วาดตรงแนวได้ผลเดิมเป๊ะ
const MIN_ROTATE_RAD = (5 * Math.PI) / 180;
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

/**
 * พื้นที่กรอบ ด้วยสูตร shoelace — ใช้เดาระยะห่างเริ่มต้นก่อน binary search
 * และฝั่งแอดมินใช้ประมาณระยะห่างที่นั่งเพื่อเลือกขนาดจุดที่วาดบนผัง
 */
export function polygonArea(polygon: Polygon): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += (polygon[j][0] + polygon[i][0]) * (polygon[j][1] - polygon[i][1]);
  }
  return Math.abs(sum) / 2;
}

/**
 * convex hull ด้วยวิธี monotone chain — ใช้เป็นวัตถุดิบของการหามุมเอียง
 * (กรอบเว้าอย่างบล็อกที่มีช่องทางเดินเว้า ถ้าไม่ทำ hull ก่อน มุมจะเพี้ยนไปตามรอยเว้า)
 */
function convexHull(points: Polygon): Polygon {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (src: Polygon): Polygon => {
    const out: Point[] = [];
    for (const p of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/**
 * มุมเอียงของโซน = มุมด้านของ "สี่เหลี่ยมล้อมเล็กสุด" (rotating calipers)
 *
 * ที่มา: ผังสนามจริงมีบล็อกวางเอียงตามความโค้งของอัฒจันทร์ ถ้าโปรยที่นั่งด้วยกริดแนวนอนตายตัว
 * ขอบโซนจะออกมาเป็นบันไดหยัก และแถวจะพาดเฉียงขวางบล็อก ไม่เหมือนผังจริงที่แถวขนานไปกับบล็อก
 *
 * คืนค่าเป็นเรเดียนในช่วง (-45°, 45°] เพราะหมุนครบ 90° ได้สี่เหลี่ยมอันเดิม
 * -> เลือกตัวแทนที่ใกล้แนวนอนที่สุด กริดจะได้ไม่พลิกแกนโดยไม่จำเป็น
 */
function orientationOf(polygon: Polygon): number {
  const hull = convexHull(polygon);
  if (hull.length < 3) return 0;

  let bestArea = Infinity;
  let bestAngle = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of hull) {
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea) {
      bestArea = area;
      bestAngle = angle;
    }
  }

  const quarter = Math.PI / 2;
  let normalized = bestAngle % quarter;
  if (normalized > quarter / 2) normalized -= quarter;
  if (normalized <= -quarter / 2) normalized += quarter;
  return normalized;
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

/**
 * ลำดับ "อ่านผัง" — แถวบนลงล่าง ในแถวเรียงซ้ายไปขวา (A1, A2, …, B1, …, Z10, AA1)
 *
 * ใช้ตอนจับคู่ที่นั่งเดิมในฐานข้อมูลกับตำแหน่งใหม่บนกรอบที่แอดมินวาด
 * ต้องเทียบ "ความยาวชื่อแถว" ก่อนตัวอักษร เพราะชื่อแถวไล่ A..Z แล้วขึ้น AA
 * ถ้าเรียงแบบ string ล้วน AA จะไปแทรกระหว่าง A กับ B → ที่นั่งเลื่อนผิดตำแหน่งยกโซน
 * ผลคือตั๋วที่ลูกค้าถืออยู่ชี้จุดผิดบนผัง (ชื่อแถว/เลขที่นั่งบนตั๋วไม่เปลี่ยน เปลี่ยนแค่จุดบนรูป)
 */
export function compareSeatOrder<T extends { rowLabel: string; seatNumber: number }>(
  a: T,
  b: T
): number {
  return (
    a.rowLabel.length - b.rowLabel.length ||
    a.rowLabel.localeCompare(b.rowLabel) ||
    a.seatNumber - b.seatNumber
  );
}

function round(value: number): number {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(value * factor) / factor;
}

/**
 * โปรยที่นั่งให้เต็มกรอบ ได้จำนวนเป๊ะตามที่สั่ง
 *
 * ขั้นตอน: แปลงเป็นพิกัดตามสัดส่วนจอจริง -> หามุมเอียงของกรอบแล้วหมุนกริดให้ตรงแนวบล็อก
 *          -> หา bounding box (ในแกนที่หมุนแล้ว) -> binary search หาระยะห่าง
 *          -> คัดเฉพาะจุดในกรอบ -> เก็บทีละแถวจนครบ (แถวสุดท้ายที่ไม่เต็มจัดไว้กลางแถว)
 *          -> หมุนพิกัดกลับ + ตั้งชื่อแถว/เลขที่นั่งใหม่
 *
 * กรอบที่วางตรงแนวอยู่แล้ว (เอียงน้อยกว่า MIN_ROTATE_RAD) ข้ามขั้นหมุนทั้งหมด
 * -> ผังเดิมที่เคยเจนไว้ได้ผลลัพธ์เหมือนเดิมทุกจุด
 */
export function fillPolygonWithSeats(polygon: Polygon, options: FillOptions): GeneratedSeat[] {
  const target = Math.floor(options.targetCount);
  const aspectRatio = options.aspectRatio && options.aspectRatio > 0 ? options.aspectRatio : 1;
  if (target <= 0 || polygon.length < 3) return [];

  // ทำงานบนพิกัด "ตามสัดส่วนจอจริง" (ยืดแกน X ตามอัตราส่วนรูป)
  // -> ระยะห่างที่นั่งเท่ากันทั้งสองแกนจริง ๆ และหมุนกรอบได้โดยรูปทรงไม่บิด
  const screenPolygon: Polygon = polygon.map(([x, y]) => [x * aspectRatio, y]);

  // หมุนกริดให้ตรงแนวบล็อก เฉพาะบล็อกที่เอียงจริง (บล็อกตรงแนวได้ผลเหมือนเดิมทุกจุด)
  const angle = orientationOf(screenPolygon);
  const theta = Math.abs(angle) < MIN_ROTATE_RAD ? 0 : angle;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const intoGrid = ([x, y]: Point): Point => [x * cos + y * sin, -x * sin + y * cos];

  const gridPolygon: Polygon = theta === 0 ? screenPolygon : screenPolygon.map(intoGrid);
  const box = boundingBoxOf(gridPolygon);
  if (box.width <= 0 || box.height <= 0) return [];

  // ในระบบพิกัดที่หมุนแล้ว สองแกนมีมาตราเดียวกัน จึงไม่ต้องชดเชยอัตราส่วนซ้ำ
  const spacing = findSpacingFor(gridPolygon, box, target, 1);
  const points = collectGridPoints(gridPolygon, box, spacing, 1) ?? [];

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
  // แล้วหมุนพิกัดกลับ + ยุบแกน X คืนเป็นสัดส่วน 0-1 ของรูป
  const seats: GeneratedSeat[] = [];
  selectedRows.forEach((pointsInRow, rowIndex) => {
    pointsInRow.forEach((point, seatIndex) => {
      const gx = theta === 0 ? point.x : point.x * cos - point.y * sin;
      const gy = theta === 0 ? point.y : point.x * sin + point.y * cos;
      seats.push({
        x: round(gx / aspectRatio),
        y: round(gy),
        rowLabel: rowLabelFor(rowIndex),
        seatNumber: seatIndex + 1,
      });
    });
  });

  return seats;
}
