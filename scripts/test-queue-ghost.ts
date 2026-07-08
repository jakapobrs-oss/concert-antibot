// ============================================================
// Regression: admitNext ต้องไม่ admit "ghost" ในคิวรอ (Redis จริง)
// ============================================================
// รัน: npx tsx --env-file=.env scripts/test-queue-ghost.ts   (ต้องมี Redis ขึ้นก่อน)
//
// ghost = member ที่ค้างใน queue ZSET แต่ token hash หมดอายุไปแล้ว (1 ชม.) — queue ZSET ใช้
//   score=fairScore (ไม่ใช่เวลา) prune by score ไม่ได้. เดิม admitNext ดึง member หน้าคิวมา
//   admit ตรง ๆ → ghost ถูก "admit" กินโควตาความจุ 5 นาที/ก้อน ทั้งที่ไม่มีคนจริง = เสียโควตาเปล่า
// fix: เช็ค token hash ก่อน admit — ผีถูกกรองออก + เก็บกวาดออกจากคิว
import { redis } from "../lib/redis";
import { joinQueue, admitNext, getQueueStatus } from "../lib/queue";

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
  const concertId = `ghost-${Date.now()}`;
  const userId = `u-${Date.now()}`;
  const qKey = `queue:${concertId}`;
  const admKey = `queue:${concertId}:admitted`;
  const ghost = `ghosttoken-${Date.now()}`;
  console.log(`\n🧪 ghost-admit regression (concertId=${concertId})\n`);

  try {
    // ghost: ใส่ member ในคิวโดยไม่สร้าง hash (จำลอง token หมดอายุ 1 ชม. แต่ member ค้าง) — score=0 = หน้าคิวสุด
    await redis.zadd(qKey, 0, ghost);
    check("setup: ghost ไม่มี hash", (await redis.exists(`queue:token:${ghost}`)) === 0);

    // คนจริงเข้าคิว (score จริง > 0 → อยู่หลัง ghost)
    const j = await joinQueue({ concertId, userId });
    const liveToken = j.token;
    check("setup: ghost อยู่หน้า live ในคิว", (await redis.zrange(qKey, 0, 0))[0] === ghost);

    // ปล่อยคิว batch 10 (คิวล้วน ไม่ส่ง cap/seatsLeft)
    const n = await admitNext(concertId, { batchSize: 10 });

    check("1. 🔑 admit เฉพาะคนจริง ไม่นับ ghost (คืน 1)", n === 1, `got ${n}`);
    check("2. ghost ไม่ถูก admit (ไม่อยู่ใน admitted set)", (await redis.zscore(admKey, ghost)) === null);
    check("3. ghost ถูกเก็บกวาดออกจากคิวแล้ว", (await redis.zscore(qKey, ghost)) === null);
    check("4. ghost hash ไม่ถูกสร้างขึ้นใหม่", (await redis.exists(`queue:token:${ghost}`)) === 0);
    check("5. live token ถูก admit จริง", (await getQueueStatus(liveToken)).status === "ADMITTED");

    await redis.del(qKey, admKey, `queue:token:${liveToken}`, `queue:${concertId}:user:${userId}`);
  } finally {
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
    await redis.quit();
  }
  process.exit(fail === 0 ? 0 : 1);
}

void main();
