// ============================================================
// Regression: holdSeats ต้อง atomic all-or-nothing (Codex §2 #8) — กัน griefing/partial (Redis จริง)
// ============================================================
// รัน: npx tsx --env-file=.env scripts/test-seat-hold-atomic.ts   (ต้องมี Redis ขึ้นก่อน)
//
// เดิม loop SET NX ทีละที่ = ไม่ atomic → ยิง [A,B] + [B,A] พร้อมกัน ต่างคนคว้าได้คนละที่ แล้ว rollback
//   ทั้งคู่ = ล้มทั้งคู่ (griefing) ทั้งที่ว่างจริง. fix: Lua เดียว check-all-then-set-all → มีผู้ชนะเดียวเสมอ
import { redis } from "../lib/redis";
import { holdSeats, releaseSeats, isHeldBy, getHeldSeats } from "../lib/seat-hold";

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
  const tag = `sh-${Date.now()}`;
  const A = `${tag}-A`;
  const B = `${tag}-B`;
  const C = `${tag}-C`;
  console.log(`\n🧪 seat-hold atomic regression (${tag})\n`);

  try {
    // 1) hold ที่ว่าง → success ได้ครบทุกที่
    const r1 = await holdSeats({ seatIds: [A, B], userId: "u1" });
    check("1. hold ที่ว่าง → success ได้ครบ 2 ที่", r1.success && r1.heldSeats.length === 2, JSON.stringify(r1));
    check("   ทั้ง A,B ถูก lock โดย u1", (await isHeldBy(A, "u1")) && (await isHeldBy(B, "u1")));

    // 2) คนอื่น hold ทับ (A ชน, C ว่าง) → fail + failedSeats ระบุ A + ไม่แตะ C (all-or-nothing)
    const r2 = await holdSeats({ seatIds: [A, C], userId: "u2" });
    check("2. hold ทับที่ u1 ถือ → fail", !r2.success);
    check("   failedSeats ระบุที่ที่ชน (A)", r2.failedSeats.includes(A), JSON.stringify(r2.failedSeats));
    check("   🔑 ที่ C ไม่ถูก u2 ยึด (ไม่มี partial hold)", (await isHeldBy(C, "u2")) === false);
    check("   ไม่มี lock ค้างที่ C เลย", (await redis.get(`seat:lock:${C}`)) === null);

    // 3) idempotent: u1 hold ซ้ำที่ตัวเองถืออยู่ → success (refresh TTL)
    const r3 = await holdSeats({ seatIds: [A, B], userId: "u1" });
    check("3. u1 hold ซ้ำที่ตัวเองถือ → success (idempotent)", r3.success);
    await releaseSeats([A, B], "u1");
    check("   release แล้วที่ว่างจริง", (await getHeldSeats([A, B])).size === 0);

    // 4) 🔑 griefing race: [A,B] vs [B,A] พร้อมกัน N รอบ → ต้องมีผู้ชนะเดียวได้ครบ 2 ที่ทุกรอบ (ไม่ล้มคู่)
    const ROUNDS = 40;
    let bothFailed = 0;
    let exactlyOneWon = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const a = `${tag}-r${i}-A`;
      const b = `${tag}-r${i}-B`;
      const [ra, rb] = await Promise.all([
        holdSeats({ seatIds: [a, b], userId: "ua" }),
        holdSeats({ seatIds: [b, a], userId: "ub" }),
      ]);
      const winners = [ra, rb].filter((r) => r.success);
      if (winners.length === 0) bothFailed++;
      if (winners.length === 1 && winners[0].heldSeats.length === 2) exactlyOneWon++;
      await redis.del(`seat:lock:${a}`, `seat:lock:${b}`);
    }
    check(`4. 🔑 ${ROUNDS} รอบ griefing → มีผู้ชนะเดียวได้ครบ 2 ที่ทุกรอบ`, exactlyOneWon === ROUNDS, `won-exactly-1=${exactlyOneWon}/${ROUNDS}`);
    check("   ไม่มีรอบไหนล้มทั้งคู่ (griefing ถูกกำจัด)", bothFailed === 0, `bothFailed=${bothFailed}`);

    await redis.del(`seat:lock:${A}`, `seat:lock:${B}`, `seat:lock:${C}`);
  } finally {
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
    await redis.quit();
  }
  process.exit(fail === 0 ? 0 : 1);
}

void main();
