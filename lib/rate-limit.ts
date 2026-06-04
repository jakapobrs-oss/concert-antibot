// ============================================================
// Rate Limiter — Redis sliding window (Phase 6)
// ============================================================
// กันยิงรัว (บอทพยายามเข้าคิว/จองหลายครั้งเร็ว ๆ)
// อัลกอริทึม: sliding window log ด้วย Redis Sorted Set
//   - แต่ละ request เก็บ timestamp ใน ZSET (member=unique, score=now)
//   - นับจำนวน request ในช่วง window ล่าสุด → เกิน limit = block
//   - ตัด entry เก่ากว่า window ออก (ZREMRANGEBYSCORE)
// แม่นกว่า fixed-window (ไม่มีปัญหา burst ตอนขอบ window)
import { redis } from "@/lib/redis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number; // เหลือกี่ครั้งใน window
  limit: number;
  retryAfterMs: number; // ต้องรอกี่ ms ถ้าโดน limit
}

// ตรวจ rate limit
// key: identifier (เช่น "queue_join:ip:1.2.3.4" หรือ "queue_join:user:5")
export async function checkRateLimit(params: {
  key: string;
  limit: number; // จำนวน request สูงสุด
  windowMs: number; // ขนาด window
}): Promise<RateLimitResult> {
  const { key, limit, windowMs } = params;
  const now = Date.now();
  const windowStart = now - windowMs;
  const redisKey = `ratelimit:${key}`;

  // ใช้ unique member กัน collision เมื่อ 2 request มาใน ms เดียวกัน
  const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;

  const pipeline = redis.pipeline();
  // 1. ลบ entry เก่ากว่า window
  pipeline.zremrangebyscore(redisKey, 0, windowStart);
  // 2. เพิ่ม request ปัจจุบัน
  pipeline.zadd(redisKey, now, member);
  // 3. นับจำนวนใน window
  pipeline.zcard(redisKey);
  // 4. ตั้ง TTL = window (auto cleanup)
  pipeline.pexpire(redisKey, windowMs);
  const results = await pipeline.exec();

  // ผลของ zcard อยู่ index 2
  const count = (results?.[2]?.[1] as number) ?? 0;
  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);

  // ถ้าเกิน หา timestamp เก่าสุดเพื่อบอกว่าต้องรอนานเท่าไหร่
  let retryAfterMs = 0;
  if (!allowed) {
    const oldest = await redis.zrange(redisKey, 0, 0, "WITHSCORES");
    if (oldest.length >= 2) {
      retryAfterMs = Math.max(0, Number(oldest[1]) + windowMs - now);
    }
  }

  return { allowed, remaining, limit, retryAfterMs };
}
