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

// Lua script: hold หลายที่นั่งแบบ atomic all-or-nothing (Codex §2 #8)
//   เดิม loop SET NX ทีละที่ = ไม่ atomic → ยิง [A,B] + [B,A] พร้อมกัน ต่างคนคว้าได้คนละที่ แล้ว rollback ทั้งคู่
//   = ล้มทั้งคู่ (griefing/livelock) ทั้งที่ที่นั่งว่างจริง. Lua รันจบทั้งสคริปต์โดยไม่มี request อื่นแทรกกลาง
//   → เช็คว่าทุกที่ว่าง (หรือเป็นของเราเอง) "ก่อน" แล้วค่อย set ทั้งหมด: คนแรกที่รันได้ครบชุด คนหลังเห็นชนแล้วถอย
//   ที่นั่งที่คนอื่นถืออยู่คืนกลับเป็น seatId (ARGV[i+2] ขนานกับ KEYS[i]) ให้ caller เอาไปรายงาน
const HOLD_MULTI_SCRIPT = `
local failed = {}
for i = 1, #KEYS do
  local cur = redis.call("get", KEYS[i])
  if cur and cur ~= ARGV[1] then
    failed[#failed + 1] = ARGV[i + 2]
  end
end
if #failed > 0 then
  return failed
end
for i = 1, #KEYS do
  redis.call("set", KEYS[i], ARGV[1], "EX", tonumber(ARGV[2]))
end
return {}
`;

export interface HoldResult {
  success: boolean;
  heldSeats: string[]; // seatId ที่ hold สำเร็จ
  failedSeats: string[]; // seatId ที่คนอื่น hold ไปแล้ว
}

// พยายาม hold หลายที่นั่งพร้อมกันแบบ atomic all-or-nothing (ผ่าน Lua — กัน partial/griefing)
//   สำเร็จ → ได้ทุกที่, ไม่สำเร็จ → ไม่ได้ที่เลย + failedSeats = ที่นั่งที่คนอื่นถืออยู่
export async function holdSeats(params: {
  seatIds: string[];
  userId: string;
}): Promise<HoldResult> {
  const { seatIds, userId } = params;
  if (seatIds.length === 0) return { success: true, heldSeats: [], failedSeats: [] };

  const keys = seatIds.map(lockKey);
  // eval: KEYS = lock keys, ARGV[1]=userId, ARGV[2]=ttl, ARGV[3..]=seatIds (ขนานกับ KEYS)
  const failed = (await redis.eval(
    HOLD_MULTI_SCRIPT,
    keys.length,
    ...keys,
    userId,
    String(HOLD_TTL_SECONDS),
    ...seatIds
  )) as string[];

  if (failed.length > 0) {
    return { success: false, heldSeats: [], failedSeats: failed };
  }
  return { success: true, heldSeats: seatIds, failedSeats: [] };
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
