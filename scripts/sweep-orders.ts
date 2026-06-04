// ============================================================
// Cron Script (F3) — กวาด order ค้างทั้งระบบ คืนที่นั่งที่หมดเวลา
// ============================================================
// ใช้คู่กับ on-read sweep ใน holdAndCreateOrder (ที่กวาดเฉพาะคอนเสิร์ตที่มีคนจอง)
// script นี้กวาด "ทุกคอนเสิร์ต" — เหมาะรันเป็น cron (เช่น ทุก 1 นาที)
//
// รัน: pnpm sweep   หรือ   npx tsx scripts/sweep-orders.ts
// cron ตัวอย่าง (ทุกนาที): * * * * * cd /path/to/app && pnpm sweep >> /var/log/sweep.log 2>&1
import { expireStaleOrders } from "../lib/order-sweeper";
import { prisma } from "../lib/prisma";

async function main() {
  const started = Date.now();
  // ไม่ส่ง concertId = กวาดทั้งระบบ
  const cancelled = await expireStaleOrders();
  const ms = Date.now() - started;
  console.log(`[sweep-orders] ยกเลิก order ค้าง ${cancelled} รายการ คืนที่นั่งแล้ว (${ms}ms)`);
}

main()
  .catch((e) => {
    console.error("[sweep-orders] ล้มเหลว:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
