// ============================================================
// Load Shedding — global in-flight gate (Phase 9 / peak-load)
// ============================================================
// ปัญหา: ตอน flash-crowd (เปิดขายพร้อมกันเป็นหมื่น) ถ้ารับทุก request
//   request จะกองใน event loop จนช้าหมด → ระบบล่มทั้งหมด (cascading failure)
// แนวคิด load shedding: "ยอมทิ้งโหลดส่วนเกินเร็ว ๆ" ดีกว่า "พยายามรับทุกอันแล้วตายยกแผง"
//   นับจำนวน request ที่กำลังทำพร้อมกัน (in-flight) ผ่าน Redis counter
//   เกินเพดาน → ปฏิเสธทันที (ให้ caller ตอบ 503 + Retry-After) กัน DB/CPU saturate
import { redis } from "@/lib/redis";

// safety TTL — กัน counter ค้างถ้า process ตายกลางคันก่อน release
// (request จริงใช้เวลาไม่ถึงวินาที 15s เผื่อเหลือเฟือ)
const INFLIGHT_TTL_SECONDS = 15;

// พยายามจอง 1 slot — คืน true ถ้ายังไม่เกินเพดาน, false ถ้าเต็ม (ต้อง shed)
export async function acquireInflight(bucket: string, max: number): Promise<boolean> {
  const key = `inflight:${bucket}`;
  const n = await redis.incr(key);
  // ตั้ง TTL ครั้งแรกที่สร้าง key (กัน leak ถ้า release ไม่ถูกเรียก)
  if (n === 1) await redis.expire(key, INFLIGHT_TTL_SECONDS);
  if (n > max) {
    await redis.decr(key); // ไม่ได้ slot — ถอยคืน
    return false;
  }
  return true;
}

// คืน slot เมื่อทำเสร็จ (เรียกใน finally เสมอ)
export async function releaseInflight(bucket: string): Promise<void> {
  const key = `inflight:${bucket}`;
  const n = await redis.decr(key);
  // กัน counter ติดลบ (เผื่อ release เกินจาก TTL ที่ reset ไปแล้ว)
  if (n < 0) await redis.set(key, "0");
}
