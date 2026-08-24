// ============================================================
// อ่านค่า polygon ที่เก็บเป็น Json ใน DB ให้ปลอดภัย (Phase 2)
// ============================================================
// Prisma คืน Json มาเป็น unknown — ถ้าโยนเข้า component ตรง ๆ แล้วข้อมูลผิดรูป
// (แก้มือใน DB / ของเก่าคนละเวอร์ชัน) หน้าเว็บจะพังตอน render ซึ่งดีบักยาก
// จึงตรวจรูปร่างที่ชั้นนี้ครั้งเดียว แล้วคืน null ให้ผู้เรียกตัดสินใจว่าจะ fallback ยังไง

export type Point = [number, number];

/** กรอบที่แอดมินคลิกวาด (โซนหรือเวที) — ต้องมีอย่างน้อย 3 จุด */
export type Polygon = Point[];

export interface CappedPolygonUpdate {
  points: Polygon;
  added: boolean;
}

/** เพิ่มจุดโดยคืนผลแยกชัดเจน เพื่อให้ผู้เรียกแจ้งเตือนได้โดยไม่ซ่อน side effect ใน updater */
export function appendPointWithinCap(
  points: Polygon,
  point: Point,
  maxPoints: number,
): CappedPolygonUpdate {
  if (points.length >= maxPoints) return { points, added: false };
  return { points: [...points, point], added: true };
}

/** แทรกกึ่งกลางจากข้อมูลชุดเดียวกัน เพื่อไม่ให้ตำแหน่งกับการเช็กเพดานอ้างคนละ render */
export function insertMidpointWithinCap(
  points: Polygon,
  afterIndex: number,
  maxPoints: number,
): CappedPolygonUpdate {
  if (points.length >= maxPoints) return { points, added: false };

  const nextIndex = (afterIndex + 1) % points.length;
  const start = points[afterIndex];
  const end = points[nextIndex];
  const midpoint: Point = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];

  return {
    points: [...points.slice(0, afterIndex + 1), midpoint, ...points.slice(afterIndex + 1)],
    added: true,
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** ย้ายจุดเดียวและกันพิกัดหลุดรูป โดยไม่แก้ array ต้นฉบับ */
export function movePolygonPoint(polygon: Polygon, index: number, point: Point): Polygon {
  return polygon.map((current, currentIndex) =>
    currentIndex === index ? [clamp01(point[0]), clamp01(point[1])] : current,
  );
}

/**
 * เลื่อนทั้งกรอบด้วย delta เดียวกัน และจำกัด delta ก่อนขยับ
 * การ clamp ทีละจุดจะบิดรูปทรงเมื่อชนขอบ จึงต้องหาช่วงที่ทั้งกรอบเดินได้ก่อน
 */
export function translatePolygonWithinBounds(
  polygon: Polygon,
  deltaX: number,
  deltaY: number,
): Polygon {
  if (polygon.length === 0) return [];

  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const boundedDeltaX = Math.min(1 - maxX, Math.max(-minX, deltaX));
  const boundedDeltaY = Math.min(1 - maxY, Math.max(-minY, deltaY));

  return polygon.map(([x, y]) => [clamp01(x + boundedDeltaX), clamp01(y + boundedDeltaY)]);
}

/** คืน polygon เมื่อรูปร่างถูกต้องจริง (อาเรย์ของคู่ตัวเลข อย่างน้อย 3 จุด) ไม่งั้นคืน null */
export function parsePolygon(value: unknown): Point[] | null {
  if (!Array.isArray(value)) return null;
  const points: Point[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    const [x, y] = item;
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push([x, y]);
  }
  return points.length >= 3 ? points : null;
}

/**
 * พื้นที่กรอบ ด้วยสูตร shoelace — ใช้ประกอบการหาจุดกึ่งกลางและเรียงลำดับโซนตามขนาด
 * คืนค่าเป็นบวกเสมอ (ไม่สนว่าวาดตามเข็มหรือทวนเข็ม)
 */
export function polygonArea(polygon: Polygon): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += (polygon[j][0] + polygon[i][0]) * (polygon[j][1] - polygon[i][1]);
  }
  return Math.abs(sum) / 2;
}

/**
 * จุดกึ่งกลางของกรอบ (ถ่วงน้ำหนักด้วยพื้นที่) — คงไว้สำหรับงานคำนวณทั่วไปและ test เดิม
 *
 * ⚠️ กรอบเว้ามาก ๆ (รูปตัว L / ตัว U) จุดกึ่งกลางอาจตกนอกกรอบได้ตามนิยามของมัน
 *    จึงไม่ควรใช้จุดนี้ปักป้ายหรือวัดระยะของโซนที่อาจเป็นรูปวงแหวน
 *
 * กรอบที่พื้นที่เป็นศูนย์ (จุดทั้งหมดอยู่บนเส้นตรงเดียวกัน) ใช้ค่าเฉลี่ยพิกัดแทน
 */
export function polygonCentroid(polygon: Polygon): Point {
  let doubleArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const cross = polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
    doubleArea += cross;
    x += (polygon[j][0] + polygon[i][0]) * cross;
    y += (polygon[j][1] + polygon[i][1]) * cross;
  }

  if (Math.abs(doubleArea) < 1e-12) {
    const sum = polygon.reduce<Point>((acc, [px, py]) => [acc[0] + px, acc[1] + py], [0, 0]);
    return [sum[0] / polygon.length, sum[1] / polygon.length];
  }
  return [x / (3 * doubleArea), y / (3 * doubleArea)];
}

/** ตรวจว่าจุดอยู่ภายในกรอบด้วยวิธีลากรังสีไปทางขวา */
export function isPointInPolygon(polygon: Polygon, point: Point): boolean {
  const [px, py] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crossesRay =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crossesRay) inside = !inside;
  }

  return inside;
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);

  const projection =
    ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) /
    lengthSquared;
  const boundedProjection = Math.min(1, Math.max(0, projection));
  const closestX = start[0] + boundedProjection * deltaX;
  const closestY = start[1] + boundedProjection * deltaY;
  return Math.hypot(point[0] - closestX, point[1] - closestY);
}

function distanceToPolygonEdges(polygon: Polygon, point: Point): number {
  let shortest = Number.POSITIVE_INFINITY;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    shortest = Math.min(shortest, distanceToSegment(point, polygon[j], polygon[i]));
  }
  return shortest;
}

/**
 * หาจุดภายในกรอบที่ห่างจากขอบมากที่สุดด้วยกริดหยาบ แล้วซูมหาซ้ำรอบจุดที่ดีที่สุด
 * ไม่ใช้ centroid เพราะกรอบเว้าแบบโซนวงแหวนอาจได้จุดกลางรู ทำให้ป้ายทับโซนอื่น
 */
export function polygonPoleOfInaccessibility(polygon: Polygon): Point {
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  const gridSize = 32;
  let bestPoint: Point | null = null;
  let bestDistance = Number.NEGATIVE_INFINITY;

  const considerPoint = (candidate: Point) => {
    if (!isPointInPolygon(polygon, candidate)) return;
    const distance = distanceToPolygonEdges(polygon, candidate);
    if (distance > bestDistance) {
      bestPoint = candidate;
      bestDistance = distance;
    }
  };

  for (let row = 0; row < gridSize; row += 1) {
    for (let column = 0; column < gridSize; column += 1) {
      considerPoint([
        minX + (width * (column + 0.5)) / gridSize,
        minY + (height * (row + 0.5)) / gridSize,
      ]);
    }
  }

  if (!bestPoint) return polygonCentroid(polygon);

  let radiusX = width / gridSize;
  let radiusY = height / gridSize;
  const refineGridSize = 9;
  for (let round = 0; round < 4; round += 1) {
    const center = bestPoint;
    for (let row = 0; row < refineGridSize; row += 1) {
      for (let column = 0; column < refineGridSize; column += 1) {
        considerPoint([
          center[0] - radiusX + (2 * radiusX * column) / (refineGridSize - 1),
          center[1] - radiusY + (2 * radiusY * row) / (refineGridSize - 1),
        ]);
      }
    }
    radiusX /= 2;
    radiusY /= 2;
  }

  return bestPoint;
}

/**
 * ระยะจากจุดภายในโซนถึงจุดภายในเวที
 * ใช้เรียงลำดับโซน "ใกล้เวทีก่อน" ในรายการฝั่งคนซื้อ — ตอบคำถามว่าโซนนี้อยู่ตรงไหนของเวที
 * โดยไม่ต้องให้ผู้ใช้กวาดสายตาหาเองบนรูป
 */
export function distanceFromStage(zone: Polygon, stage: Polygon | null): number {
  if (!stage) return 0;
  const [zx, zy] = polygonPoleOfInaccessibility(zone);
  const [sx, sy] = polygonPoleOfInaccessibility(stage);
  return Math.hypot(zx - sx, zy - sy);
}
