// ============================================================
// Regression: /api/queue/status กัน unauth Redis DoS จาก token ปลอม (Redis จริง)
// ============================================================
// รัน: npx tsx --env-file=.env scripts/test-queue-status-dos.ts   (ต้องมี Redis ขึ้นก่อน)
//
// เดิม: rate-limit key ถูกสร้างจาก token ที่ client ส่ง "ก่อน" validate → หมุน token สุ่มทุก request
//   = สร้าง ratelimit:queue_status:token:* ไม่จำกัด (unauth) + เลี่ยง per-token limit
// fix: validate รูปแบบ + ใช้ hgetall เป็นประตู ถ้า token ไม่มีจริงคืน NOT_FOUND โดยไม่แตะ checkRateLimit
import { NextRequest } from "next/server";
import { redis } from "../lib/redis";
import { GET } from "../app/api/queue/status/route";
import { joinQueue } from "../lib/queue";

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

const base = "http://localhost/api/queue/status?token=";
const call = (t: string) => GET(new NextRequest(base + t));

async function main() {
  const bogus = "a".repeat(64); // รูปแบบถูก (hex 64) แต่ไม่มี token จริง
  const garbage = "not-a-valid-token"; // รูปแบบผิด
  const bogusRlKey = `ratelimit:queue_status:token:${bogus}`;
  console.log(`\n🧪 status unauth-DoS regression\n`);

  try {
    await redis.del(bogusRlKey); // เคลียร์ให้สะอาดก่อนวัด

    // 1) รูปแบบ token ผิด → 400 (ไม่แตะ Redis)
    check("1. token รูปแบบผิด → 400", (await call(garbage)).status === 400);

    // 2) token รูปแบบถูกแต่ไม่มีจริง → NOT_FOUND
    const r2 = await call(bogus);
    const b2 = (await r2.json()) as { status?: string };
    check("2. token ปลอม → NOT_FOUND", b2.status === "NOT_FOUND", `got ${b2.status}`);

    // 3) 🔑 หัวใจ fix: token ปลอมต้องไม่สร้าง rate-limit key
    check("3. 🔑 token ปลอมไม่สร้าง rate-limit key", (await redis.exists(bogusRlKey)) === 0);

    // 4) positive control: token จริงยังทำงาน + ยัง rate-limit (key ถูกสร้างให้ token จริงเท่านั้น)
    const concertId = `dos-${Date.now()}`;
    const { token } = await joinQueue({ concertId, userId: `u-${Date.now()}` });
    const realRlKey = `ratelimit:queue_status:token:${token}`;
    await redis.del(realRlKey);
    const r4 = await call(token);
    const b4 = (await r4.json()) as { status?: string };
    check("4. token จริง → ไม่ NOT_FOUND (ทำงานปกติ)", b4.status !== "NOT_FOUND", `got ${b4.status}`);
    check("5. token จริง → สร้าง rate-limit key ปกติ (limit ยังทำงาน)", (await redis.exists(realRlKey)) === 1);

    // cleanup keys ของเทสนี้
    await redis.del(realRlKey, `queue:token:${token}`, `queue:${concertId}`, `queue:${concertId}:admitted`, `queue:${concertId}:admit-lock`);
    const slotKeys = await redis.keys(`queue:${concertId}:user:*`);
    if (slotKeys.length) await redis.del(...slotKeys);
  } finally {
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
    await redis.quit();
  }
  process.exit(fail === 0 ? 0 : 1);
}

void main();
