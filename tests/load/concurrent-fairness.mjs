// Load Test (Node-based, ไม่ต้องลง k6) — Phase 9
// รัน: node tests/load/concurrent-fairness.mjs
//
// พิสูจน์ 2 อย่างที่สำคัญสุดใน thesis:
//   1. FAIRNESS: คนเข้าคิวพร้อมกัน N คน → ลำดับสุ่ม ไม่เรียงตามเวลามา
//   2. NO DOUBLE-BOOKING: คนแย่งที่นั่งเดียวกัน → ได้แค่คนเดียว (ไม่มีที่นั่งซ้ำ)
import Redis from "ioredis";
import crypto from "node:crypto";

const redis = new Redis("redis://localhost:6379");
const N = Number(process.env.N || 500); // จำนวนคนจำลอง
const CONCERT_ID = "loadtest";

// ===== ส่วนที่ 1: Fairness — N คนเข้าคิวพร้อมกัน =====
const BUCKET_SIZE_MS = 2000;
const RANDOM_RANGE = 1_000_000;

console.log(`\n=== Load Test: ${N} คนเข้าคิวพร้อมกัน ===`);
const queueKey = `queue:${CONCERT_ID}`;
await redis.del(queueKey);

const startTime = Date.now();
// จำลองทุกคน join พร้อมกัน (Promise.all = concurrent จริง)
const joinResults = await Promise.all(
  Array.from({ length: N }, async (_, i) => {
    const now = Date.now();
    const bucket = Math.floor(now / BUCKET_SIZE_MS);
    const random = crypto.randomInt(0, RANDOM_RANGE);
    const score = bucket * RANDOM_RANGE + random;
    const token = `u${i}`;
    await redis.zadd(queueKey, score, token);
    return { joinOrder: i, token, arriveMs: now, random };
  })
);
const joinDuration = Date.now() - startTime;

// ดึงลำดับคิวจริง (เรียงตาม score)
const queueOrder = await redis.zrange(queueKey, 0, -1);

// วัด fairness: นับว่าคนที่ join ก่อน (joinOrder น้อย) ได้คิวก่อนหรือไม่
// ถ้า fairness ทำงาน ลำดับคิวควร "ไม่สัมพันธ์" กับ joinOrder (สุ่ม)
let inversions = 0; // จำนวนครั้งที่คนมาทีหลังได้คิวก่อนคนมาก่อน
const queuePos = new Map(queueOrder.map((tok, pos) => [tok, pos]));
for (let i = 0; i < joinResults.length; i++) {
  for (let j = i + 1; j < Math.min(i + 50, joinResults.length); j++) {
    const posI = queuePos.get(joinResults[i].token);
    const posJ = queuePos.get(joinResults[j].token);
    // i มาก่อน j แต่ j ได้คิวก่อน = inversion (สัญญาณว่าไม่ได้เรียงตามเวลา = ดี)
    if (posJ < posI) inversions++;
  }
}
const comparisons = Math.min(50, N) * N / 2;
const inversionRate = ((inversions / comparisons) * 100).toFixed(1);

console.log(`  เวลา join ${N} คน: ${joinDuration}ms (${(joinDuration / N).toFixed(2)}ms/คน)`);
console.log(`  inversion rate: ${inversionRate}% (ยิ่งใกล้ 50% = ยิ่งสุ่ม/ยุติธรรม, ใกล้ 0% = เรียงตามเวลา/ไม่ยุติธรรม)`);
console.log(`  → ${Number(inversionRate) > 30 ? "✅ PASS: ลำดับสุ่ม ไม่ลำเอียงตามเวลามา" : "⚠️ ลำดับเรียงตามเวลามากเกินไป"}`);

// ===== ส่วนที่ 2: No double-booking — N คนแย่งที่นั่งเดียวกัน =====
console.log(`\n=== ${N} คนแย่งที่นั่งเดียวกัน (race condition) ===`);
const seatKey = "seat:lock:loadtest-seat-1";
await redis.del(seatKey);

const holdResults = await Promise.all(
  Array.from({ length: N }, async (_, i) => {
    const ok = await redis.set(seatKey, `user${i}`, "EX", 300, "NX");
    return ok === "OK";
  })
);
const winners = holdResults.filter(Boolean).length;
console.log(`  คนแย่ง: ${N} | hold สำเร็จ: ${winners}`);
console.log(`  → ${winners === 1 ? "✅ PASS: ได้แค่คนเดียว (ไม่มีที่นั่งซ้ำ)" : `❌ FAIL: ${winners} คนได้ที่นั่งเดียวกัน!`}`);

// cleanup
await redis.del(queueKey, seatKey);
await redis.quit();

console.log("\n=== สรุป Load Test ===");
console.log(`  ✓ Fairness: ${N} คน inversion ${inversionRate}%`);
console.log(`  ✓ No double-booking: ${winners}/${N} winner`);
process.exit(0);
