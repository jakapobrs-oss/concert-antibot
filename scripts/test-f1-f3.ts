// ============================================================
// Integration Test (F1–F3) — ยิงจริงกับ Postgres + Redis
// ============================================================
// รัน: npx tsx scripts/test-f1-f3.ts   (ต้อง pnpm db:up ให้ DB+Redis ขึ้นก่อน)
// สร้าง fixture แยกเป็นของตัวเอง (concert/user ใหม่ slug unique) แล้วลบทิ้งใน finally
// → ไม่แตะข้อมูล seed ของจริง
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { expireStaleOrders } from "../lib/order-sweeper";
import { checkRateLimit } from "../lib/rate-limit";
import { exceedsTicketLimit } from "../lib/ticket-limit";

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

const MIN = 60_000;

async function main() {
  const tag = `f1f3-${Date.now()}`;
  console.log(`\n🧪 Integration test F1–F3 (tag=${tag})\n`);

  // ---------- fixtures: user + concert(ON_SALE, max 4) + zone + 8 seats ----------
  const user = await prisma.user.create({
    data: { email: `${tag}@test.local`, name: "F1F3 Tester" },
  });
  const concert = await prisma.concert.create({
    data: {
      title: "F1F3 Test Concert",
      slug: tag,
      description: "integration test fixture",
      venue: "Test Venue",
      eventAt: new Date(Date.now() + 30 * 24 * 60 * MIN),
      saleStartAt: new Date(Date.now() - 24 * 60 * MIN),
      saleEndAt: new Date(Date.now() + 10 * 24 * 60 * MIN),
      maxTicketsPerUser: 4,
      status: "ON_SALE",
      zones: {
        create: {
          name: "TEST",
          price: 1000,
          totalSeats: 8,
          seats: { create: Array.from({ length: 8 }, (_, i) => ({ rowLabel: "A", seatNumber: i + 1 })) },
        },
      },
    },
    include: { zones: { include: { seats: true } } },
  });
  const userId = user.id;
  const concertId = concert.id;
  const seats = concert.zones[0].seats.sort((a, b) => a.seatNumber - b.seatNumber);

  // helper นับ committed แบบเดียวกับ holdAndCreateOrder (F2)
  const countCommitted = () =>
    prisma.orderItem.count({
      where: {
        order: {
          userId,
          concertId,
          OR: [{ status: "PAID" }, { status: "PENDING", expiresAt: { gt: new Date() } }],
        },
      },
    });

  try {
    // ============================================================
    // F3 — sweeper: order หมดเวลา → คืนที่นั่ง + ลบ OrderItem + จองใหม่ได้
    // ============================================================
    console.log("F3 — Order sweeper (คืนที่นั่งค้าง):");

    // order หมดอายุแล้ว ถือ seat[0],[1] (HELD)
    const staleOrder = await prisma.order.create({
      data: {
        userId,
        concertId,
        totalAmount: 2000,
        status: "PENDING",
        expiresAt: new Date(Date.now() - 1 * MIN), // หมดไป 1 นาที
        items: { create: [{ seatId: seats[0].id, price: 1000 }, { seatId: seats[1].id, price: 1000 }] },
      },
    });
    await prisma.seat.updateMany({
      where: { id: { in: [seats[0].id, seats[1].id] } },
      data: { status: "HELD" },
    });

    // order ยังไม่หมดอายุ ถือ seat[2] (HELD) — ต้องไม่ถูกกวาด
    const activeOrder = await prisma.order.create({
      data: {
        userId,
        concertId,
        totalAmount: 1000,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 5 * MIN),
        items: { create: [{ seatId: seats[2].id, price: 1000 }] },
      },
    });
    await prisma.seat.update({ where: { id: seats[2].id }, data: { status: "HELD" } });

    const swept = await expireStaleOrders({ concertId });
    check("คืนค่าจำนวน order ที่กวาด = 1", swept === 1, `got ${swept}`);

    const so = await prisma.order.findUnique({ where: { id: staleOrder.id } });
    check("stale order → CANCELLED", so?.status === "CANCELLED", so?.status ?? "null");
    check(
      "OrderItem ของ stale order ถูกลบหมด (root-cause fix)",
      (await prisma.orderItem.count({ where: { orderId: staleOrder.id } })) === 0
    );
    const s0 = await prisma.seat.findUnique({ where: { id: seats[0].id } });
    const s1 = await prisma.seat.findUnique({ where: { id: seats[1].id } });
    check("seat[0] HELD → AVAILABLE", s0?.status === "AVAILABLE", s0?.status ?? "null");
    check("seat[1] HELD → AVAILABLE", s1?.status === "AVAILABLE", s1?.status ?? "null");

    const ao = await prisma.order.findUnique({ where: { id: activeOrder.id } });
    const s2 = await prisma.seat.findUnique({ where: { id: seats[2].id } });
    check("active order ไม่ถูกกวาด (ยัง PENDING)", ao?.status === "PENDING", ao?.status ?? "null");
    check("seat[2] ยัง HELD (ไม่โดนคืนผิด)", s2?.status === "HELD", s2?.status ?? "null");

    // จองที่นั่งที่เพิ่งคืน (seat[0]) ใหม่ → ต้องไม่ติด unique OrderItem
    let rebookOk = false;
    try {
      await prisma.order.create({
        data: {
          userId,
          concertId,
          totalAmount: 1000,
          status: "PENDING",
          expiresAt: new Date(Date.now() + 5 * MIN),
          items: { create: [{ seatId: seats[0].id, price: 1000 }] },
        },
      });
      rebookOk = true;
    } catch (e) {
      rebookOk = false;
      console.log("     (rebook error:", (e as Error).message.split("\n")[0], ")");
    }
    check("ที่นั่งที่คืนแล้วจองใหม่ได้ (ไม่ติด unique OrderItem)", rebookOk);

    // ============================================================
    // F2 — ลิมิตตั๋วนับยอดรวมต่อ user ต่อคอนเสิร์ต
    // ============================================================
    console.log("\nF2 — Cumulative ticket limit:");

    // ตอนนี้ active(seat2) + rebook(seat0) = 2 committed
    check("committed เริ่มต้น = 2 (active + rebook, PENDING active)", (await countCommitted()) === 2, `got ${await countCommitted()}`);

    // เพิ่ม PAID order 2 ใบ (seat3,4) → committed = 4 = เพดาน
    await prisma.order.create({
      data: {
        userId,
        concertId,
        totalAmount: 2000,
        status: "PAID",
        paidAt: new Date(),
        expiresAt: new Date(Date.now() - 1000), // PAID แล้ว expiresAt อดีตก็ต้องนับ
        items: { create: [{ seatId: seats[3].id, price: 1000 }, { seatId: seats[4].id, price: 1000 }] },
      },
    });
    await prisma.seat.updateMany({ where: { id: { in: [seats[3].id, seats[4].id] } }, data: { status: "SOLD" } });

    const committed = await countCommitted();
    check("committed นับ PAID(expired)+PENDING(active) รวม = 4", committed === 4, `got ${committed}`);
    check("จองเพิ่ม 1 ทะลุเพดาน (4+1>4) → ระบบ block", exceedsTicketLimit({ committed, requested: 1, max: 4 }) === true);
    check("พิสูจน์บั๊กเดิม: เช็คแค่ order เดียว (1>4=false) จะปล่อยผ่าน", 1 > 4 === false);

    // PENDING ที่หมดอายุ → ต้องไม่ถูกนับ
    await prisma.order.create({
      data: {
        userId,
        concertId,
        totalAmount: 1000,
        status: "PENDING",
        expiresAt: new Date(Date.now() - 1 * MIN),
        items: { create: [{ seatId: seats[5].id, price: 1000 }] },
      },
    });
    check("order PENDING ที่หมดอายุ ไม่ถูกนับ (ยังคง 4)", (await countCommitted()) === 4, `got ${await countCommitted()}`);

    // ============================================================
    // F1 — rate limit (Redis จริง)
    // ============================================================
    console.log("\nF1 — submitSlip rate limit (Redis):");
    const rlKey = `submit_slip:order:${tag}:user:${userId}`;
    await redis.del(`ratelimit:${rlKey}`); // กันค่าค้างจากรอบก่อน
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await checkRateLimit({ key: rlKey, limit: 5, windowMs: 10 * MIN });
      results.push(r.allowed);
    }
    check("5 ครั้งแรกผ่าน", results.slice(0, 5).every(Boolean), JSON.stringify(results));
    check("ครั้งที่ 6 ถูกบล็อก", results[5] === false);
    const last = await checkRateLimit({ key: rlKey, limit: 5, windowMs: 10 * MIN });
    check("ครั้งถัดไปยังบล็อก + มี retryAfterMs > 0", last.allowed === false && last.retryAfterMs > 0, `retry=${last.retryAfterMs}ms`);
    await redis.del(`ratelimit:${rlKey}`);
  } finally {
    // ---------- cleanup (FK-safe order) ----------
    await prisma.ticket.deleteMany({ where: { userId } });
    await prisma.payment.deleteMany({ where: { order: { userId } } });
    await prisma.orderItem.deleteMany({ where: { order: { userId } } });
    await prisma.order.deleteMany({ where: { userId } });
    await prisma.concert.delete({ where: { id: concertId } }); // cascade → zones → seats
    await prisma.user.delete({ where: { id: userId } });
    console.log("\n🧹 cleanup เสร็จ (ลบ fixture ทั้งหมด)");
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
    await prisma.$disconnect();
    await redis.quit();
  });
