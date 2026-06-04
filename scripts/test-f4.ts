// ============================================================
// Integration Test (F4) — queue token ผูกกับ userId (Redis จริง)
// ============================================================
// รัน: npx tsx scripts/test-f4.ts   (ต้อง pnpm db:up ให้ Redis ขึ้นก่อน)
// พิสูจน์ว่า token ที่ถูก admit แล้ว ใช้ได้เฉพาะเจ้าของ — คนอื่นเอาไปใช้ข้ามคิวไม่ได้
import { redis } from "../lib/redis";
import { joinQueue, admitNext, isAdmitted } from "../lib/queue";

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
  const concertId = `f4-${Date.now()}`;
  const userA = `userA-${Date.now()}`;
  const userB = `userB-${Date.now()}`;
  console.log(`\n🧪 Integration test F4 (concertId=${concertId})\n`);

  let tokenA = "";
  try {
    // userA เข้าคิว → ได้ token
    const joined = await joinQueue({ concertId, userId: userA });
    tokenA = joined.token;
    check("userA เข้าคิวได้ token", !!tokenA);

    // ปล่อยเข้า (admit) แล้วเช็คสถานะ
    const admittedCount = await admitNext(concertId, 10);
    check("admitNext ปล่อย userA เข้า (1 คน)", admittedCount === 1, `got ${admittedCount}`);

    check("isAdmitted(token) แบบไม่ส่ง userId → true (backward compatible)", await isAdmitted(tokenA, concertId));
    check("isAdmitted(token, ของเจ้าของ A) → true", await isAdmitted(tokenA, concertId, userA));
    check(
      "🔒 F4: isAdmitted(token ของ A, แต่เป็น user B) → false (กันแชร์ token ข้ามคน)",
      (await isAdmitted(tokenA, concertId, userB)) === false
    );
    check(
      "isAdmitted(token ปลอม) → false",
      (await isAdmitted("token-mua-ni-mai-mi-jing", concertId, userA)) === false
    );
  } finally {
    // cleanup redis keys ที่สร้าง
    await redis.del(
      `queue:${concertId}`,
      `queue:${concertId}:admitted`,
      `queue:token:${tokenA}`,
      `queue:${concertId}:user:${userA}`
    );
    console.log("\n🧹 cleanup keys เสร็จ");
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`ผล: ${pass} ผ่าน / ${fail} ไม่ผ่าน`);
  console.log("=".repeat(40));
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("\n💥 test crashed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await redis.quit();
  });
