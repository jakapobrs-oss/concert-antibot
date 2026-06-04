// ============================================================
// Queue Service — Virtual Waiting Room (Phase 4)
// ============================================================
// เป้าหมายหลัก: FAIRNESS — ผู้ใช้จริงที่กดพร้อมกันมีโอกาสเท่ากัน ไม่ลำเอียง
//
// หลักการความเป็นธรรม (เขียนใน thesis ได้):
//   ปัญหา: ถ้าจัดคิวด้วย timestamp ระดับ millisecond ตรง ๆ →
//          คนเน็ตเร็ว / อยู่ใกล้ server / กดเร็วกว่าเสี้ยววินาที ได้เปรียบ = ไม่ยุติธรรม
//   วิธีแก้: แบ่งเวลาเป็น "bucket" (เช่น ทุก 2 วินาที) ทุกคนที่เข้าคิวใน bucket เดียวกัน
//          ถือว่า "มาพร้อมกัน" → ตัดสินลำดับภายใน bucket ด้วย "เลขสุ่ม" (randomScore)
//   ผลลัพธ์: score = timeBucket * 1e6 + randomScore
//          - คนมาก่อน bucket → ได้คิวก่อนเสมอ (กันคนมาทีหลังแซง = ยังยุติธรรมเชิงเวลาหยาบ)
//          - คนใน bucket เดียวกัน → สุ่มล้วน (ความเร็วระดับ ms ไม่มีผล = ยุติธรรมเชิงละเอียด)
//
// โครงสร้างข้อมูลใน Redis:
//   queue:{concertId}            → Sorted Set (member=token, score=fairScore) = ลำดับคิว
//   queue:{concertId}:admitted   → Sorted Set (member=token, score=expireAt) = คนที่ปล่อยเข้าแล้ว
//   queue:token:{token}          → Hash (concertId, userId, status) + TTL
// ============================================================
import crypto from "node:crypto";
import { redis } from "@/lib/redis";

// ---- ค่าคงที่ของระบบคิว (ดึงบางส่วนจาก env ได้) ----
const BUCKET_SIZE_MS = 2000; // ขนาด time-window: คนเข้าคิวภายใน 2 วิ ถือว่าเสมอภาคกัน
const RANDOM_RANGE = 1_000_000; // ช่วงเลขสุ่มภายใน bucket (0 ถึง 999,999)
const ADMIT_TTL_SECONDS = 300; // ปล่อยเข้าแล้วมีเวลา 5 นาทีเลือกที่นั่ง
const TOKEN_TTL_SECONDS = 3600; // token อยู่ในระบบได้สูงสุด 1 ชม

// key builders — รวมไว้ที่เดียวกันเปลี่ยนง่าย
const keys = {
  queue: (concertId: string) => `queue:${concertId}`,
  admitted: (concertId: string) => `queue:${concertId}:admitted`,
  token: (token: string) => `queue:token:${token}`,
  // dedup key — ผูก 1 identity (user/device) ต่อ 1 slot ในคอนเสิร์ตหนึ่ง
  // กันเปิดหลายแท็บ/หลายหน้าจอด้วย account เดียวเพื่อรุมกดบัตร (Sybil/multi-tab)
  userSlot: (concertId: string, userId: string) => `queue:${concertId}:user:${userId}`,
  fpSlot: (concertId: string, fp: string) => `queue:${concertId}:fp:${fp}`,
};

export interface QueuePosition {
  token: string;
  status: "WAITING" | "ADMITTED" | "EXPIRED" | "NOT_FOUND";
  position: number; // ตำแหน่งในคิว (1-based) — 0 ถ้า admitted แล้ว
  ahead: number; // มีกี่คนอยู่ข้างหน้า
  total: number; // จำนวนคนในคิวทั้งหมด
  admitExpiresAt?: number; // epoch ms ที่ admit window จะหมด (ถ้า ADMITTED)
}

// คำนวณ fairScore — หัวใจความเป็นธรรม
// score น้อย = อยู่หน้าคิว
function computeFairScore(now: number): { bucket: number; random: number; score: number } {
  const bucket = Math.floor(now / BUCKET_SIZE_MS);
  // ใช้ crypto random (ไม่ใช่ Math.random) เพื่อกัน predict + กระจายสม่ำเสมอ
  const random = crypto.randomInt(0, RANDOM_RANGE);
  // score = bucket * RANGE + random → bucket สำคัญกว่า, random ตัดสินภายใน bucket
  const score = bucket * RANDOM_RANGE + random;
  return { bucket, random, score };
}

// เข้าคิว — คืน token ให้ client ถือไว้ poll สถานะ
// ⚖️ FAIRNESS: 1 identity (user/device) = 1 slot ต่อคอนเสิร์ต
//   ถ้าเข้าคิวซ้ำ (เปิดหลายแท็บ/รีเฟรช) จะคืน token เดิม ไม่สร้าง slot ใหม่
//   → คนเปิด 10 หน้าจอด้วย account เดียว ได้คิวเดียว = ยุติธรรมกับคนมือเดียว
//   field `deduped` บอกว่าเป็น token เดิมที่มีอยู่แล้วหรือไม่ (ใช้สื่อสารกับ user)
export async function joinQueue(params: {
  concertId: string;
  userId?: string;
  fingerprintHash?: string;
  ip?: string;
}): Promise<{ token: string; score: number; bucket: number; random: number; deduped: boolean }> {
  const now = Date.now();

  // 1. เช็ค dedup — ถ้า identity นี้มี slot อยู่แล้ว คืน token เดิม
  //    เลือก key ตามลำดับ: userId (แม่นสุด ถ้า login) > fingerprint (ถ้าไม่ login)
  const slotKey = params.userId
    ? keys.userSlot(params.concertId, params.userId)
    : params.fingerprintHash
      ? keys.fpSlot(params.concertId, params.fingerprintHash)
      : null;

  if (slotKey) {
    const existingToken = await redis.get(slotKey);
    if (existingToken) {
      // ยืนยันว่า token เดิมยัง active จริง (อยู่ในคิวหรือ admitted)
      const meta = await redis.hgetall(keys.token(existingToken));
      if (meta && meta.concertId) {
        return {
          token: existingToken,
          score: Number(meta.bucket) * RANDOM_RANGE + Number(meta.random),
          bucket: Number(meta.bucket),
          random: Number(meta.random),
          deduped: true, // เป็น slot เดิม ไม่ได้สร้างใหม่
        };
      }
      // token หายไปแล้ว (expire) → ปล่อยให้สร้างใหม่ด้านล่าง
    }
  }

  // 2. สร้าง slot ใหม่
  const token = crypto.randomBytes(32).toString("hex");
  const { bucket, random, score } = computeFairScore(now);

  const pipeline = redis.pipeline();
  pipeline.zadd(keys.queue(params.concertId), score, token);
  pipeline.hset(keys.token(token), {
    concertId: params.concertId,
    userId: params.userId ?? "",
    fingerprintHash: params.fingerprintHash ?? "",
    ip: params.ip ?? "",
    status: "WAITING",
    enteredAt: now.toString(),
    bucket: bucket.toString(),
    random: random.toString(),
  });
  pipeline.expire(keys.token(token), TOKEN_TTL_SECONDS);
  // ผูก slot key → token (NX กัน race จาก 2 แท็บที่ยิงพร้อมกันเป๊ะ)
  if (slotKey) {
    pipeline.set(slotKey, token, "EX", TOKEN_TTL_SECONDS, "NX");
  }
  const results = await pipeline.exec();

  // ถ้า set NX ล้มเหลว (มีแท็บอื่นชิงสร้าง slot ไปแล้วเสี้ยววินาทีก่อน) → ถอย token นี้ คืนของเดิม
  if (slotKey) {
    const setResult = results?.[results.length - 1]?.[1];
    if (setResult === null) {
      // มีคนชิง slot ไปแล้ว — ลบ token ที่เพิ่งสร้าง แล้วคืน token เดิม
      await redis.del(keys.token(token));
      await redis.zrem(keys.queue(params.concertId), token);
      const winnerToken = await redis.get(slotKey);
      if (winnerToken) {
        const meta = await redis.hgetall(keys.token(winnerToken));
        return {
          token: winnerToken,
          score: Number(meta.bucket) * RANDOM_RANGE + Number(meta.random),
          bucket: Number(meta.bucket),
          random: Number(meta.random),
          deduped: true,
        };
      }
    }
  }

  return { token, score, bucket, random, deduped: false };
}

// ดูสถานะคิว — client poll ทุก ๆ 2-3 วิ
export async function getQueueStatus(token: string): Promise<QueuePosition> {
  const meta = await redis.hgetall(keys.token(token));
  if (!meta || !meta.concertId) {
    return { token, status: "NOT_FOUND", position: 0, ahead: 0, total: 0 };
  }

  const concertId = meta.concertId;

  // ถ้า admitted แล้ว → เช็คว่า window ยังไม่หมด
  if (meta.status === "ADMITTED") {
    const expireScore = await redis.zscore(keys.admitted(concertId), token);
    if (expireScore && Number(expireScore) > Date.now()) {
      return {
        token,
        status: "ADMITTED",
        position: 0,
        ahead: 0,
        total: await redis.zcard(keys.queue(concertId)),
        admitExpiresAt: Number(expireScore),
      };
    }
    // หมดเวลา admit แล้ว
    return { token, status: "EXPIRED", position: 0, ahead: 0, total: 0 };
  }

  // ยัง WAITING → หาตำแหน่งจาก rank ใน sorted set (0-based → +1)
  const rank = await redis.zrank(keys.queue(concertId), token);
  if (rank === null) {
    // ไม่อยู่ในคิวแล้ว (อาจ expire)
    return { token, status: "EXPIRED", position: 0, ahead: 0, total: 0 };
  }
  const total = await redis.zcard(keys.queue(concertId));
  return {
    token,
    status: "WAITING",
    position: rank + 1,
    ahead: rank,
    total,
  };
}

// ปล่อยคน N คนแรกจากคิวเข้าห้องเลือกที่นั่ง (เรียกเป็นรอบ ๆ — cron หรือ on-demand)
// คืนจำนวนที่ปล่อยจริง
export async function admitNext(concertId: string, batchSize: number): Promise<number> {
  // ดึง N token แรก (score ต่ำสุด = หน้าคิวสุด = ยุติธรรม)
  const tokens = await redis.zrange(keys.queue(concertId), 0, batchSize - 1);
  if (tokens.length === 0) return 0;

  const now = Date.now();
  const expireAt = now + ADMIT_TTL_SECONDS * 1000;

  const pipeline = redis.pipeline();
  for (const token of tokens) {
    // ย้ายออกจากคิวหลัก → ใส่ admitted set (score = เวลาหมดอายุ admit)
    pipeline.zrem(keys.queue(concertId), token);
    pipeline.zadd(keys.admitted(concertId), expireAt, token);
    pipeline.hset(keys.token(token), { status: "ADMITTED", admittedAt: now.toString() });
    pipeline.expire(keys.token(token), ADMIT_TTL_SECONDS);
  }
  await pipeline.exec();
  return tokens.length;
}

// ออกจากคิวเอง (user กดยกเลิก)
export async function leaveQueue(token: string): Promise<void> {
  const meta = await redis.hgetall(keys.token(token));
  if (meta?.concertId) {
    const pipeline = redis.pipeline();
    pipeline.zrem(keys.queue(meta.concertId), token);
    pipeline.zrem(keys.admitted(meta.concertId), token);
    pipeline.del(keys.token(token));
    // ปลด slot key ด้วย (เฉพาะถ้าชี้มาที่ token นี้จริง) เพื่อให้เข้าคิวใหม่ได้
    if (meta.userId) {
      const sk = keys.userSlot(meta.concertId, meta.userId);
      if ((await redis.get(sk)) === token) pipeline.del(sk);
    }
    if (meta.fingerprintHash) {
      const sk = keys.fpSlot(meta.concertId, meta.fingerprintHash);
      if ((await redis.get(sk)) === token) pipeline.del(sk);
    }
    await pipeline.exec();
  }
}

// ตรวจว่า token ถูก admit + ยังไม่หมดเวลา (ใช้ gate หน้าเลือกที่นั่ง)
// F4: ถ้าส่ง userId มาด้วย จะเช็คว่า token นี้เป็น "ของ user คนนี้จริง" (ผูกตอน joinQueue)
//     กันเอา token ของคนอื่น (ที่ถูก admit แล้ว) มาใช้ข้ามคิว/แชร์กัน
export async function isAdmitted(
  token: string,
  concertId: string,
  userId?: string
): Promise<boolean> {
  const expireScore = await redis.zscore(keys.admitted(concertId), token);
  if (!expireScore || Number(expireScore) <= Date.now()) return false;

  // ผูก token ↔ เจ้าของ: token meta เก็บ userId ไว้ตอนเข้าคิว ต้องตรงกับผู้ใช้ปัจจุบัน
  if (userId !== undefined) {
    const owner = await redis.hget(keys.token(token), "userId");
    if (owner !== userId) return false;
  }
  return true;
}

// สถิติคิว (สำหรับ admin dashboard + thesis evaluation)
export async function getQueueStats(concertId: string): Promise<{
  waiting: number;
  admitted: number;
}> {
  const [waiting, admitted] = await Promise.all([
    redis.zcard(keys.queue(concertId)),
    redis.zcard(keys.admitted(concertId)),
  ]);
  return { waiting, admitted };
}

// ค่าคงที่ export ให้ที่อื่นใช้
export const QUEUE_CONFIG = {
  BUCKET_SIZE_MS,
  ADMIT_TTL_SECONDS,
  TOKEN_TTL_SECONDS,
};
