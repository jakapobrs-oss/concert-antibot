// Redis client singleton (ioredis) — ใช้สำหรับ queue + distributed lock + rate limit
// pattern เดียวกับ prisma: กัน connection ระเบิดตอน Next dev HMR
import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

// อ่าน REDIS_URL จาก env (docker-compose ตั้ง redis://localhost:6379)
export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    // ไม่ throw ตอน connect ครั้งแรกล้มเหลว — retry เอง (dev เปิด docker ทีหลังได้)
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
