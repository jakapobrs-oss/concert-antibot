// ============================================================
// Regression: load-shed sliding-window ไม่รีเซ็ตทั้งก้อน + self-heal (Codex §2 #5) — Redis จริง
// ============================================================
// รัน: npx tsx --env-file=.env scripts/test-load-shed.ts   (ต้องมี Redis ขึ้นก่อน)
//
// เดิม INCR + expire ทั้ง key → พอ TTL หมดระหว่างยังมี request active, counter รีเซ็ตทั้งก้อน =
//   generation ปนกัน → ปล่อยเกินเพดาน. fix: ZSET (member = 1 request, score = เวลาเข้า) prune รายตัว
//   ทุกครั้งที่ acquire → ตัวค้างหลุดเอง ตัว active ไม่ถูกลบพร้อมกัน
import { redis } from "../lib/redis";
import { acquireInflight, releaseInflight } from "../lib/load-shed";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}  ${extra}`);
  }
}

async function main() {
  const bucket = `ls-${Date.now()}`;
  const key = `inflight:${bucket}`;
  console.log(`\n🧪 load-shed sliding-window regression (${bucket})\n`);

  try {
    await redis.del(key);

    // 1) ceiling: max=3 → ได้ 3 ตัวแรก, ตัวที่ 4 ถูก shed
    const m1 = await acquireInflight(bucket, 3);
    const m2 = await acquireInflight(bucket, 3);
    const m3 = await acquireInflight(bucket, 3);
    check("1. ได้ slot 3 ตัวแรก (คืน memberId)", !!m1 && !!m2 && !!m3);
    const m4 = await acquireInflight(bucket, 3);
    check("2. ตัวที่ 4 ถูก shed (null)", m4 === null);
    check("   zcard = 3 (ไม่เกินเพดาน)", (await redis.zcard(key)) === 3);

    // 3) release 1 → มีที่ว่างให้ acquire ได้อีก
    await releaseInflight(bucket, m1);
    check("3. release แล้ว zcard = 2", (await redis.zcard(key)) === 2);
    const m5 = await acquireInflight(bucket, 3);
    check("   acquire ได้อีกหลัง release", !!m5);

    // 4) 🔑 self-heal: member ค้างเกิน TTL ถูก prune รายตัวตอน acquire — ไม่บล็อกเก้อ + ไม่ลบตัว active
    await redis.del(key);
    const now = Date.now();
    // 2 ตัวค้างเกิน TTL 15s (score เก่า) + 1 ตัวสด
    await redis.zadd(key, now - 20_000, "stale-1", now - 16_000, "stale-2", now, "fresh-1");
    check("4. setup: 3 member (2 ค้าง + 1 สด)", (await redis.zcard(key)) === 3);
    // max=2: ถ้าไม่ prune จะ 3>=2 → shed เก้อ; ต้อง prune 2 ตัวค้างก่อน → เหลือ 1 < 2 → ได้ slot
    const m6 = await acquireInflight(bucket, 2);
    check("   🔑 acquire ได้ (ตัวค้างถูก prune ก่อนนับ ไม่ shed เก้อ)", !!m6, `got ${m6}`);
    check("   ตัวค้างถูกกวาดออก (เหลือ fresh-1 + ตัวใหม่ = 2)", (await redis.zcard(key)) === 2);
    check("   stale-1 ถูก prune แล้ว", (await redis.zscore(key, "stale-1")) === null);
    check("   fresh-1 ยัง active (ไม่โดนลบพร้อมก้อนแบบ counter เดิม)", (await redis.zscore(key, "fresh-1")) !== null);

    await redis.del(key);
  } finally {
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
    await redis.quit();
  }
  process.exit(fail === 0 ? 0 : 1);
}

void main();
