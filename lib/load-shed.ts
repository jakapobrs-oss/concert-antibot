// ============================================================
// Load Shedding — global in-flight gate (Phase 9 / peak-load)
// ============================================================
// ปัญหา: ตอน flash-crowd (เปิดขายพร้อมกันเป็นหมื่น) ถ้ารับทุก request
//   request จะกองใน event loop จนช้าหมด → ระบบล่มทั้งหมด (cascading failure)
// แนวคิด load shedding: "ยอมทิ้งโหลดส่วนเกินเร็ว ๆ" ดีกว่า "พยายามรับทุกอันแล้วตายยกแผง"
//   นับจำนวน request ที่กำลังทำพร้อมกัน (in-flight) แล้วเกินเพดาน → ปฏิเสธทันที (503 + Retry-After)
//
// ⚠️ Codex §2 #5 — ทำไมไม่ใช้ INCR/DECR + expire ทั้ง key:
//   ของเดิมนับด้วย counter ก้อนเดียว ตั้ง TTL 15s แค่ตอนสร้าง key. พอ key หมดอายุ "ระหว่างที่ยังมี
//   request active" (โหลดค้างต่อเนื่องเกิน 15s) Redis ลบทั้ง counter → INCR รอบใหม่เริ่มนับจาก 1
//   ทั้งที่ของจริงยังมี N ตัวข้างใน = generation ปนกัน → ปล่อยเกินเพดาน (เลี่ยง load-shed) + DECR ของ
//   generation เก่ามาลบ counter ใหม่จนติดลบ. แก้ = sorted-set sliding window: แต่ละ request เป็น
//   member (score = เวลาเข้า) หมดอายุ "รายตัว" ด้วยการ prune by score ทุกครั้งที่ acquire — request ที่
//   ตายกลางคัน (ไม่ได้ release) หลุดเองใน TTL, request ที่ยัง active ไม่ถูกลบทิ้งพร้อมกันทั้งก้อน
import { redis } from "@/lib/redis";
import { randomUUID } from "node:crypto";

// safety TTL — request ที่ค้าง (process ตายก่อน release) หลุดเองหลังเวลานี้ (request จริงใช้ < 1s)
const INFLIGHT_TTL_MS = 15_000;

// atomic acquire: prune ตัวหมดอายุ → นับ → ถ้ายังไม่เต็มค่อยเพิ่มตัวเรา (กัน race นับพร้อมกันแล้วทะลุเพดาน)
//   KEYS[1]=zset key · ARGV[1]=now(ms) · ARGV[2]=ttl(ms) · ARGV[3]=max · ARGV[4]=memberId
//   คืน 1 = ได้ slot, 0 = เต็ม (ต้อง shed)
const ACQUIRE_SCRIPT = `
redis.call("zremrangebyscore", KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
local n = redis.call("zcard", KEYS[1])
if n >= tonumber(ARGV[3]) then
  return 0
end
redis.call("zadd", KEYS[1], ARGV[1], ARGV[4])
redis.call("pexpire", KEYS[1], tonumber(ARGV[2]))
return 1
`;

// พยายามจอง 1 slot — คืน memberId (ส่งต่อให้ releaseInflight) ถ้าได้, คืน null ถ้าเต็ม (ต้อง shed)
export async function acquireInflight(bucket: string, max: number): Promise<string | null> {
  const key = `inflight:${bucket}`;
  const member = randomUUID();
  const now = Date.now();
  const ok = await redis.eval(
    ACQUIRE_SCRIPT,
    1,
    key,
    String(now),
    String(INFLIGHT_TTL_MS),
    String(max),
    member
  );
  return Number(ok) === 1 ? member : null;
}

// คืน slot เมื่อทำเสร็จ (เรียกใน finally เสมอ) — ลบเฉพาะ member ของ request นี้ (idempotent, ไม่แตะตัวอื่น)
export async function releaseInflight(bucket: string, member: string | null): Promise<void> {
  if (!member) return;
  await redis.zrem(`inflight:${bucket}`, member);
}
