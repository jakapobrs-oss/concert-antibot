// ============================================================
// Integration / Concurrency Test (N1, N3) — ยิงจริงกับ Postgres
// ============================================================
// รัน: npx tsx scripts/test-n1-race.ts   (ต้อง pnpm db:up ให้ Postgres ขึ้นก่อน)
// พิสูจน์ว่า lib/order-finalize.ts กัน race ได้จริง:
//   - submitSlip (finalizePaidOrder) แข่งกับ cancel/expire → ไม่ "ชุบชีวิต" order + ไม่ double-book
//   - ที่นั่งถูกปล่อยระหว่างทาง → SEAT_CONFLICT + rollback (ไม่มีที่นั่งค้าง SOLD)
//   - finalize ซ้ำ → ออกตั๋วได้ครั้งเดียว
// สร้าง fixture ของตัวเอง (slug unique) แล้วลบทิ้งใน finally — ไม่แตะ seed จริง
import { prisma } from "../lib/prisma";
import { finalizePaidOrder, cancelPendingOrder } from "../lib/order-finalize";

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
  const tag = `n1race-${Date.now()}`;
  console.log(`\n🧪 Concurrency test N1/N3 (tag=${tag})\n`);

  // ---------- fixtures: user + concert(ON_SALE) + zone + 4 seats ----------
  const user = await prisma.user.create({
    data: { email: `${tag}@test.local`, name: "N1 Tester" },
  });
  const concert = await prisma.concert.create({
    data: {
      title: "N1 Race Test Concert",
      slug: tag,
      description: "concurrency test fixture",
      venue: "Test Venue",
      eventAt: new Date(Date.now() + 30 * 24 * 60 * MIN),
      saleStartAt: new Date(Date.now() - 24 * 60 * MIN),
      saleEndAt: new Date(Date.now() + 10 * 24 * 60 * MIN),
      maxTicketsPerUser: 10,
      status: "ON_SALE",
      zones: {
        create: {
          name: "TEST",
          price: 1000,
          totalSeats: 4,
          seats: { create: Array.from({ length: 4 }, (_, i) => ({ rowLabel: "A", seatNumber: i + 1 })) },
        },
      },
    },
    include: { zones: { include: { seats: true } } },
  });
  const userId = user.id;
  const concertId = concert.id;
  const seats = concert.zones[0].seats.sort((a, b) => a.seatNumber - b.seatNumber);
  const [s0, s1] = [seats[0], seats[1]];

  // ล้างสถานะ order/ticket ของคอนเสิร์ตนี้ + คืนที่นั่งทั้งหมดเป็น AVAILABLE (ใช้ก่อนแต่ละ iteration)
  async function resetState() {
    await prisma.ticket.deleteMany({ where: { order: { concertId } } });
    await prisma.order.deleteMany({ where: { concertId } }); // cascade payment + orderItem
    await prisma.seat.updateMany({ where: { zone: { concertId } }, data: { status: "AVAILABLE" } });
  }

  // สร้าง order PENDING + ที่นั่ง HELD + payment PENDING (จำลองสถานะหลัง holdAndCreateOrder)
  async function seedPendingOrder(seatList: bigint[], opts?: { expiresInMin?: number }) {
    const expiresInMin = opts?.expiresInMin ?? 5;
    const order = await prisma.order.create({
      data: {
        userId,
        concertId,
        totalAmount: 1000 * seatList.length,
        status: "PENDING",
        expiresAt: new Date(Date.now() + expiresInMin * MIN),
        items: { create: seatList.map((seatId) => ({ seatId, price: 1000 })) },
        payment: { create: { method: "PROMPTPAY", amount: 1000 * seatList.length, status: "PENDING" } },
      },
      include: { items: true },
    });
    await prisma.seat.updateMany({ where: { id: { in: seatList } }, data: { status: "HELD" } });
    return order;
  }

  // อ่านสถานะสรุปของ order หนึ่งใบ (ไว้ assert)
  async function snapshot(orderId: bigint) {
    const [order, tickets, items, payment, seatRows] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }),
      prisma.ticket.count({ where: { orderId } }),
      prisma.orderItem.count({ where: { orderId } }),
      prisma.payment.findUnique({ where: { orderId }, select: { status: true } }),
      prisma.seat.findMany({ where: { id: { in: [s0.id, s1.id] } }, select: { status: true } }),
    ]);
    return {
      orderStatus: order?.status,
      tickets,
      items,
      paymentStatus: payment?.status,
      seatStatuses: seatRows.map((r) => r.status).sort(),
    };
  }

  try {
    // ============================================================
    // Test A — finalize (submitSlip) แข่งกับ cancel พร้อมกัน 25 รอบ
    //   ต้อง: ชนะแค่ฝั่งเดียวเสมอ + สถานะปลายทางสอดคล้อง (ไม่ resurrect / ไม่ double-book)
    // ============================================================
    console.log("Test A — finalize vs cancel race (25 รอบ):");
    let aOk = true;
    for (let i = 0; i < 25; i++) {
      await resetState();
      const order = await seedPendingOrder([s0.id, s1.id], { expiresInMin: 5 });
      const items = order.items.map((it) => ({ seatId: it.seatId, price: it.price }));

      const [fin, can] = await Promise.all([
        finalizePaidOrder({
          orderId: order.id,
          userId,
          items,
          slipRef: `${tag}-A-${i}`,
          senderName: "Tester",
          paidAt: new Date(),
        }),
        cancelPendingOrder({ orderId: order.id, userId }),
      ]);

      // ชนะฝั่งเดียวเสมอ (XOR)
      if (fin.ok === can.ok) {
        aOk = false;
        console.log(`     รอบ ${i}: ทั้งคู่ ok=${fin.ok} (ต้องชนะฝั่งเดียว)`);
        break;
      }

      const snap = await snapshot(order.id);
      if (fin.ok) {
        // finalize ชนะ → PAID + SOLD ทั้งคู่ + 2 ตั๋ว + payment SUCCESS + items ยังอยู่
        const good =
          snap.orderStatus === "PAID" &&
          snap.tickets === 2 &&
          snap.items === 2 &&
          snap.paymentStatus === "SUCCESS" &&
          snap.seatStatuses.join() === "SOLD,SOLD";
        if (!good) {
          aOk = false;
          console.log(`     รอบ ${i} (finalize won): สถานะเพี้ยน ${JSON.stringify(snap)}`);
          break;
        }
      } else {
        // cancel ชนะ → CANCELLED + AVAILABLE ทั้งคู่ + 0 ตั๋ว + items ถูกลบ
        const good =
          snap.orderStatus === "CANCELLED" &&
          snap.tickets === 0 &&
          snap.items === 0 &&
          snap.seatStatuses.join() === "AVAILABLE,AVAILABLE";
        if (!good) {
          aOk = false;
          console.log(`     รอบ ${i} (cancel won): สถานะเพี้ยน ${JSON.stringify(snap)}`);
          break;
        }
      }
    }
    check("25 รอบ: ชนะฝั่งเดียว + ไม่ resurrect + ไม่ double-book", aOk);

    // ============================================================
    // Test B — finalize บน order ที่ "หมดอายุแล้ว" → ORDER_NOT_CLAIMABLE (กัน sweeper race)
    // ============================================================
    console.log("Test B — finalize order ที่หมดอายุ:");
    await resetState();
    {
      const order = await seedPendingOrder([s0.id, s1.id], { expiresInMin: -1 }); // หมดไปแล้ว 1 นาที
      const items = order.items.map((it) => ({ seatId: it.seatId, price: it.price }));
      const fin = await finalizePaidOrder({ orderId: order.id, userId, items, slipRef: `${tag}-B` });
      const snap = await snapshot(order.id);
      check("ปฏิเสธด้วย ORDER_NOT_CLAIMABLE", !fin.ok && (fin as { reason?: string }).reason === "ORDER_NOT_CLAIMABLE", JSON.stringify(fin));
      check("ไม่ออกตั๋ว + order ยัง PENDING (rollback)", snap.tickets === 0 && snap.orderStatus === "PENDING", JSON.stringify(snap));
    }

    // ============================================================
    // Test C — ที่นั่งถูกปล่อยระหว่างทาง → SEAT_CONFLICT + rollback ครบ (ไม่มีที่นั่งค้าง SOLD)
    // ============================================================
    console.log("Test C — ที่นั่งถูกปล่อยก่อน finalize:");
    await resetState();
    {
      const order = await seedPendingOrder([s0.id, s1.id], { expiresInMin: 5 });
      const items = order.items.map((it) => ({ seatId: it.seatId, price: it.price }));
      // จำลอง: s1 ถูกปล่อย/ขายไปแล้ว (ไม่ใช่ HELD)
      await prisma.seat.update({ where: { id: s1.id }, data: { status: "AVAILABLE" } });
      const fin = await finalizePaidOrder({ orderId: order.id, userId, items, slipRef: `${tag}-C` });
      const snap = await snapshot(order.id);
      check("ปฏิเสธด้วย SEAT_CONFLICT", !fin.ok && (fin as { reason?: string }).reason === "SEAT_CONFLICT", JSON.stringify(fin));
      check("rollback: order ยัง PENDING + 0 ตั๋ว + ไม่มีที่นั่งค้าง SOLD", snap.orderStatus === "PENDING" && snap.tickets === 0 && !snap.seatStatuses.includes("SOLD"), JSON.stringify(snap));
    }

    // ============================================================
    // Test D — finalize ซ้ำสองครั้ง → ออกตั๋วได้ครั้งเดียว (idempotent ฝั่ง claim)
    // ============================================================
    console.log("Test D — finalize ซ้ำ:");
    await resetState();
    {
      const order = await seedPendingOrder([s0.id, s1.id], { expiresInMin: 5 });
      const items = order.items.map((it) => ({ seatId: it.seatId, price: it.price }));
      const first = await finalizePaidOrder({ orderId: order.id, userId, items, slipRef: `${tag}-D` });
      const second = await finalizePaidOrder({ orderId: order.id, userId, items, slipRef: `${tag}-D2` });
      const snap = await snapshot(order.id);
      check("ครั้งแรกสำเร็จ, ครั้งสองถูกปฏิเสธ", first.ok === true && second.ok === false, `${JSON.stringify(first)} / ${JSON.stringify(second)}`);
      check("ออกตั๋วแค่ 2 ใบ (ไม่ซ้ำเป็น 4)", snap.tickets === 2, JSON.stringify(snap));
    }
  } finally {
    // ---------- cleanup fixtures ----------
    await prisma.ticket.deleteMany({ where: { order: { concertId } } });
    await prisma.order.deleteMany({ where: { concertId } });
    await prisma.seat.deleteMany({ where: { zone: { concertId } } });
    await prisma.zone.deleteMany({ where: { concertId } });
    await prisma.concert.delete({ where: { id: concertId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n📊 ผล: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
