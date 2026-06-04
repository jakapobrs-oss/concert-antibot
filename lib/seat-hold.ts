// ============================================================
// Seat Hold Service — Distributed Lock (Phase 7)
// ============================================================
// หัวใจ: กัน RACE CONDITION — 2 คนกดที่นั่งเดียวกันพร้อมกัน ต้องได้แค่คนเดียว
//
// กลไก: Redis SET NX (set if not exists) = atomic compare-and-set
//   - hold ที่นั่ง: SET seat:lock:{seatId} = userId NX EX 300
//     → ถ้าคนอื่น hold อยู่แล้ว NX จะ fail (คืน null) = คนนั้นได้ที่นั่งไป
//   - TTL 5 นาที → ถ้าไม่จ่ายใน 5 นาที lock หลุดเอง ที่นั่งกลับมาว่าง (กันที่นั่งค้าง)
//   - release: DEL เฉพาะถ้า value = userId ตัวเอง (กันปล่อย lock คนอื่น) ผ่าน Lua script
//
// ทำไมใช้ Redis ไม่ใช่ DB lock?
//   - เร็วกว่ามาก (in-memory, ~0.1ms vs DB ~10ms) — สำคัญตอน peak
//   - TTL auto-expire (DB ต้องมี cron clean)
//   - atomic ในตัว (SET NX) ไม่ต้อง transaction
//   DB (SeatStatus) sync ตอน confirm จ่ายเงินจริงเท่านั้น
import { redis } from "@/lib/redis";

const HOLD_TTL_SECONDS = 300; // 5 นาที

const lockKey = (seatId: string) => `seat:lock:${seatId}`;

// Lua script: release lock เฉพาะถ้าเป็นของเราจริง (atomic check-and-del)
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface HoldResult {
  success: boolean;
  heldSeats: string[]; // seatId ที่ hold สำเร็จ
  failedSeats: string[]; // seatId ที่คนอื่น hold ไปแล้ว
}

// พยายาม hold หลายที่นั่งพร้อมกัน (atomic ต่อที่นั่ง)
// ถ้าที่นั่งใดที่นั่งหนึ่ง fail → rollback hold ทั้งหมด (all-or-nothing)
export async function holdSeats(params: {
  seatIds: string[];
  userId: string;
}): Promise<HoldResult> {
  const { seatIds, userId } = params;
  const held: string[] = [];
  const failed: string[] = [];

  // พยายาม hold ทีละที่ (SET NX)
  for (const seatId of seatIds) {
    const ok = await redis.set(lockKey(seatId), userId, "EX", HOLD_TTL_SECONDS, "NX");
    if (ok === "OK") {
      held.push(seatId);
    } else {
      failed.push(seatId);
    }
  }

  // ถ้ามีที่นั่ง fail → rollback (ปล่อยที่ hold ไปแล้ว) = all-or-nothing
  if (failed.length > 0) {
    for (const seatId of held) {
      await redis.eval(RELEASE_SCRIPT, 1, lockKey(seatId), userId);
    }
    return { success: false, heldSeats: [], failedSeats: failed };
  }

  return { success: true, heldSeats: held, failedSeats: [] };
}

// ปล่อย hold (เมื่อ user ยกเลิก หรือ จ่ายเงินเสร็จแล้ว seat เป็น SOLD)
export async function releaseSeats(seatIds: string[], userId: string): Promise<void> {
  for (const seatId of seatIds) {
    await redis.eval(RELEASE_SCRIPT, 1, lockKey(seatId), userId);
  }
}

// เช็คว่าที่นั่งถูก hold โดย user คนนี้อยู่ไหม (gate ตอน confirm payment)
export async function isHeldBy(seatId: string, userId: string): Promise<boolean> {
  const holder = await redis.get(lockKey(seatId));
  return holder === userId;
}

// ดูว่าที่นั่งไหนถูก hold อยู่บ้าง (สำหรับแสดงผล seat map real-time)
export async function getHeldSeats(seatIds: string[]): Promise<Set<string>> {
  if (seatIds.length === 0) return new Set();
  const keys = seatIds.map(lockKey);
  const values = await redis.mget(...keys);
  const held = new Set<string>();
  seatIds.forEach((id, i) => {
    if (values[i] !== null) held.add(id);
  });
  return held;
}

export const SEAT_HOLD_CONFIG = { HOLD_TTL_SECONDS };
