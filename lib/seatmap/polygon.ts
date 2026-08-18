// ============================================================
// อ่านค่า polygon ที่เก็บเป็น Json ใน DB ให้ปลอดภัย (Phase 2)
// ============================================================
// Prisma คืน Json มาเป็น unknown — ถ้าโยนเข้า component ตรง ๆ แล้วข้อมูลผิดรูป
// (แก้มือใน DB / ของเก่าคนละเวอร์ชัน) หน้าเว็บจะพังตอน render ซึ่งดีบักยาก
// จึงตรวจรูปร่างที่ชั้นนี้ครั้งเดียว แล้วคืน null ให้ผู้เรียกตัดสินใจว่าจะ fallback ยังไง

export type Point = [number, number];

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
