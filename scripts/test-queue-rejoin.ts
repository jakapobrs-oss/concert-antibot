// ============================================================
// Regression: rejoin หลัง admit หมดเวลา ต้องไม่ล็อกผู้ใช้ (Redis จริง)
// ============================================================
// รัน: npx tsx scripts/test-queue-rejoin.ts   (ต้องมี Redis ขึ้นก่อน: docker start concert-redis)
//
// บั๊ก "rejoin lockout": ผู้ใช้ถูก admit → ปล่อยหมดเวลา 5 นาที (token hash หมดอายุ) แต่ slot key
//   (userSlot) ยังค้างถึง 1 ชม. → เดิม joinQueue คืน token ที่ตายแล้วกลับมา = poll ได้ NOT_FOUND
//   เข้าคิวใหม่ไม่ได้จนกว่า slot จะหมดอายุ (~55 นาที) = พลาดรอบขาย
// fix: ตอน dedup เจอ token ตาย ให้ compare-and-delete slot ผีทิ้งก่อนสร้างใหม่
//   + recovery ตอน SET NX fail ยึด slot ให้ token ใหม่แทนการคืน token ตาย
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
  const concertId = `rejoin-${Date.now()}`;
  const userA = `userA-${Date.now()}`;
  const slotKey = `queue:${concertId}:user:${userA}`;
  console.log(`\n🧪 rejoin-lockout regression (concertId=${concertId})\n`);

  try {
    // 1) เข้าคิวครั้งแรก → token1
    const j1 = await joinQueue({ concertId, userId: userA });
    const token1 = j1.token;
    check("1. เข้าคิวครั้งแรกได้ token (deduped=false)", !!token1 && j1.deduped === false);

    // 2) admit เข้าห้องเลือกที่นั่ง
    const n = await admitNext(concertId, { batchSize: 10 });
    check("2. admitNext ปล่อยเข้า 1 คน", n === 1, `got ${n}`);
    check("   token1 = ADMITTED", (await getQueueStatus(token1)).status === "ADMITTED");

    // 3) จำลอง "admit window หมดเวลา 5 นาที" = token hash หายไป (แต่ slot key ยังค้าง 1 ชม.)
    await redis.del(`queue:token:${token1}`);
    check("3. slot key ยังค้างชี้ token ที่ตายแล้ว (สภาพบั๊ก)", (await redis.get(slotKey)) === token1);
    check("   token1 ตายแล้วจริง (NOT_FOUND)", (await getQueueStatus(token1)).status === "NOT_FOUND");

    // 4) เข้าคิวใหม่ (rejoin) — จุดที่เดิมเคยล็อก
    const j2 = await joinQueue({ concertId, userId: userA });
    const token2 = j2.token;
    const s2 = await getQueueStatus(token2);
    check("4. 🔑 rejoin ได้ token ที่ยังมีชีวิต (ไม่ NOT_FOUND)", s2.status !== "NOT_FOUND", `status=${s2.status}`);
    check("   rejoin ได้ token ใหม่ ไม่ใช่ token ตายตัวเดิม", token2 !== token1);
    check("   token ใหม่อยู่ในคิว (WAITING)", s2.status === "WAITING", `got ${s2.status}`);

    // 5) slot ต้องชี้ token ใหม่ + คิวมีสมาชิกเดียว (ไม่ค้างซ้ำ)
    check("5. slot ชี้ token ใหม่แล้ว", (await redis.get(slotKey)) === token2);
    check("   คิวมีสมาชิกเดียว (ไม่มี token ค้างซ้ำ)", (await redis.zcard(`queue:${concertId}`)) === 1);

    // 6) regression: dedup ปกติยังทำงาน — token ยังมีชีวิต rejoin ต้องได้ตัวเดิม
    const j3 = await joinQueue({ concertId, userId: userA });
    check(
      "6. dedup: rejoin ตอน token ยังมีชีวิต → คืน token เดิม (deduped=true)",
      j3.token === token2 && j3.deduped === true,
      `token=${j3.token}, deduped=${j3.deduped}`
    );

    // cleanup keys ของเทสนี้
    await redis.del(slotKey, `queue:token:${token2}`, `queue:${concertId}`, `queue:${concertId}:admitted`);
  } finally {
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
    await redis.quit();
  }
  process.exit(fail === 0 ? 0 : 1);
}

void main();
