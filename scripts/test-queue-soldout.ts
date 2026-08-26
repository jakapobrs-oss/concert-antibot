// ============================================================
// Regression: คิวต้องมี "ทางออก" เมื่อบัตรหมด — ไม่ค้างตำแหน่ง 1 ตลอดกาล (Redis จริง)
// ============================================================
// รัน: npx tsx --env-file=.env scripts/test-queue-soldout.ts   (ต้องมี Redis ขึ้นก่อน)
//
// เดิม: คอนเสิร์ตที่ไม่เหลือที่นั่ง (สร้างไว้ 0 ที่นั่ง / ขายหมดแต่ยังไม่ถูกติดป้าย SOLD_OUT)
//   ผู้ใช้เข้าคิวได้ → admitNext เห็น seatsLeft=0 คืน 0 เงียบ ๆ → getQueueStatus ตอบ WAITING ตำแหน่ง 1
//   ไปเรื่อย ๆ จน token หมดอายุ (1 ชม.) → "คิวหมดอายุ กรุณาเข้าคิวใหม่" → กดแล้ววนกลับมาค้างอีก = ไม่มีทางออก
// fix: ผู้ปล่อยคิว (status route ที่ได้ lock) บันทึก snapshot ที่นั่ง {available, held} ลง Redis (TTL สั้น)
//   → getQueueStatus ตอบ SOLD_OUT เมื่อหมดจริง (ว่าง 0 และค้างจ่าย 0) / WAITING+seatsFull เมื่อเต็มชั่วคราว
//   ไม่ลบใครออกจากคิว — snapshot หมดอายุเอง ถ้าแอดมินเปิดขายใหม่คิวไหลต่อได้ทันที
import { redis } from "../lib/redis";
import { joinQueue, admitNext, getQueueStatus, recordSeatAvailability } from "../lib/queue";

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
  const concertId = `soldout-${Date.now()}`;
  const userId = `u-${Date.now()}`;
  const qKey = `queue:${concertId}`;
  const admKey = `queue:${concertId}:admitted`;
  const seatsKey = `queue:${concertId}:seats`;
  console.log(`\n🧪 sold-out queue exit regression (concertId=${concertId})\n`);

  // จำลอง "รอบปล่อยคิว" แบบเดียวกับ /api/queue/status: นับที่นั่ง → บันทึก snapshot → ปล่อยตามที่นั่งที่เหลือ
  async function admitRound(seats: { available: number; held: number }) {
    await recordSeatAvailability(concertId, seats);
    return admitNext(concertId, { batchSize: 10, seatsLeft: seats.available });
  }

  try {
    const { token } = await joinQueue({ concertId, userId });
    const s0 = await getQueueStatus(token);
    check("setup: เข้าคิวแล้วรอที่ตำแหน่ง 1", s0.status === "WAITING" && s0.position === 1);

    // 1) ไม่มี snapshot (เช่นนับที่นั่งจาก DB ไม่ได้) → ต้องรอต่อ ห้ามเดาว่าหมด
    check("1. ไม่มีข้อมูลที่นั่ง → ยัง WAITING (ไม่โกหกว่าหมด)", (await getQueueStatus(token)).status === "WAITING");

    // 2) 🔑 บั๊กเดิม: ปล่อยคิวรอบที่เห็น "ว่าง 0 ค้างจ่าย 0" หลายรอบ ผู้ใช้ยังได้ WAITING/1 ไม่มีทางออก
    for (let i = 0; i < 3; i++) await admitRound({ available: 0, held: 0 });
    const s2 = await getQueueStatus(token);
    check(
      "2. 🔑 บัตรหมดจริง (ว่าง 0 + ค้างจ่าย 0) → สถานะ SOLD_OUT ไม่ใช่ค้าง WAITING/1",
      s2.status === "SOLD_OUT",
      `got ${s2.status} position ${s2.position}`
    );
    check("3. ไม่ถูกเตะออกจากคิว (token ยังอยู่ใน ZSET + hash ยังอยู่)",
      (await redis.zscore(qKey, token)) !== null && (await redis.exists(`queue:token:${token}`)) === 1);
    const ttl = await redis.ttl(seatsKey);
    check("4. snapshot มี TTL สั้น (หมดอายุเองถ้าไม่มีใครปล่อยคิวต่อ)", ttl > 0 && ttl <= 30, `ttl=${ttl}`);

    // 5) เต็มชั่วคราว: ว่าง 0 แต่มีคนค้างจ่าย → ยังรอ (hold อาจหลุดกลับมา) แต่ต้องบอกผู้ใช้ว่าเต็ม
    await admitRound({ available: 0, held: 2 });
    const s5 = await getQueueStatus(token);
    check("5. เต็มชั่วคราว (ว่าง 0 แต่ค้างจ่าย 2) → WAITING + seatsFull=true", s5.status === "WAITING" && s5.seatsFull === true,
      `got ${s5.status} seatsFull=${s5.seatsFull}`);

    // 6) ที่นั่งกลับมา (hold หลุด / แอดมินเปิดขายใหม่) → คิวไหลต่อเองโดยไม่ต้องเข้าคิวใหม่
    await recordSeatAvailability(concertId, { available: 5, held: 0 });
    const s6 = await getQueueStatus(token);
    check("6. ที่นั่งกลับมา → กลับเป็น WAITING ปกติ (ไม่มี seatsFull)", s6.status === "WAITING" && !s6.seatsFull);
    const n = await admitRound({ available: 5, held: 0 });
    check("7. ปล่อยคิวรอบถัดไปได้จริง (admit 1) → ADMITTED", n === 1 && (await getQueueStatus(token)).status === "ADMITTED");

    // 8) คนที่อยู่ข้างในแล้วต้องไม่โดน snapshot "หมด" เตะ — เขาถือที่นั่งอยู่ ให้ซื้อต่อให้จบ
    await recordSeatAvailability(concertId, { available: 0, held: 0 });
    check("8. ADMITTED แล้ว snapshot หมดไม่กระทบ (ยัง ADMITTED)", (await getQueueStatus(token)).status === "ADMITTED");

    await redis.del(qKey, admKey, seatsKey, `queue:token:${token}`, `queue:${concertId}:user:${userId}`);
  } finally {
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
    await redis.quit();
  }
  process.exit(fail === 0 ? 0 : 1);
}

void main();
