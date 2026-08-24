// ============================================================
// Create Demo Concert CLI — สร้างคอนเสิร์ตทดลองราคา 1 บาท
// ============================================================
// ใช้ตอนอยากเดโมการจ่ายเงินจริงครบวงจร (PromptPay + ตรวจสลิป) โดยไม่ต้องจ่ายราคาเต็ม
//   หน้าแอดมิน `/admin/concerts/new` สร้างได้แค่โครง DRAFT — เพิ่มโซน/ราคา/ที่นั่งไม่ได้
//   (ยังไม่ได้ทำ UI ส่วนนั้น) เลยต้องยิงเข้า DB ตรงด้วยสคริปต์นี้
//
// ⚠️ ต้องตั้ง PROMPTPAY_ID + EASYSLIP_API_KEY บน environment ที่ deploy ก่อน
//    ไม่งั้น production จะปฏิเสธสลิปทุกใบ (fail-closed ตาม lib/easyslip.ts)
//
// รันกับ DB local (start docker ก่อน: docker start concert-postgres):
//   pnpm tsx scripts/create-demo-concert.ts create
//   pnpm tsx scripts/create-demo-concert.ts remove
//
// รันกับ Neon (DB ของตัวที่ deploy) — override DATABASE_URL ต่อหน้า:
//   DATABASE_URL="postgresql://...neon.tech/...?sslmode=require" \
//     pnpm tsx scripts/create-demo-concert.ts create
//
// ปรับค่าได้ผ่าน env: SLUG, PRICE, SEATS, MAX_PER_USER
import { prisma } from "../lib/prisma";

// ---- ค่าตั้งต้นของคอนเสิร์ตทดลอง (override ได้ด้วย env) ----
const SLUG = process.env.SLUG ?? "demo-1-baht";
const PRICE = Number(process.env.PRICE ?? 1); // บาท/ใบ
const SEATS = Number(process.env.SEATS ?? 12); // จำนวนที่นั่งทั้งโซน
const MAX_PER_USER = Number(process.env.MAX_PER_USER ?? 2);
const ROWS = ["A", "B", "C"];

// นับ order ที่ผูกกับคอนเสิร์ตนี้ — ใช้เป็นด่านกันลบทับของที่มีคนซื้อไปแล้ว
// (schema ตั้ง Order→Concert เป็น RESTRICT อยู่แล้ว การลบจะพังเองถ้ามี order
//  แต่เช็คก่อนเพื่อให้ข้อความ error อ่านรู้เรื่องแทน FK violation ดิบ ๆ)
async function countOrders(concertId: bigint) {
  return prisma.order.count({ where: { concertId } });
}

async function create() {
  const existing = await prisma.concert.findUnique({ where: { slug: SLUG } });
  if (existing) {
    const orders = await countOrders(existing.id);
    if (orders > 0) {
      console.log(
        `❌ มีคอนเสิร์ต "${SLUG}" อยู่แล้ว และมี ${orders} order ผูกอยู่ — ไม่ลบทับให้`
      );
      console.log(`   ถ้าจะสร้างใหม่ ให้ใช้ slug อื่น: SLUG=demo-1-baht-2 pnpm tsx scripts/create-demo-concert.ts create`);
      process.exitCode = 1;
      return;
    }
    // ไม่มี order = ของทดลองล้วน ลบทิ้งสร้างใหม่ได้ (zone/seat ตามไปด้วยแบบ Cascade)
    await prisma.concert.delete({ where: { id: existing.id } });
    console.log(`🧹 ลบคอนเสิร์ต "${SLUG}" ตัวเดิมทิ้ง (ไม่มี order ผูกอยู่)`);
  }

  const now = new Date();
  const concert = await prisma.concert.create({
    data: {
      title: `[ทดลอง] คอนเสิร์ตทดสอบระบบจ่ายเงิน ${PRICE} บาท`,
      slug: SLUG,
      description:
        `คอนเสิร์ตสำหรับทดสอบระบบจ่ายเงินจริงแบบครบวงจร ราคาใบละ ${PRICE} บาท ` +
        `ใช้สาธิตขั้นตอนเข้าคิว เลือกที่นั่ง จ่ายผ่านพร้อมเพย์ ตรวจสลิปอัตโนมัติ และออกบัตร`,
      venue: "ห้องสาธิต (ทดสอบระบบ)",
      eventAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // อีก 30 วัน
      saleStartAt: new Date(now.getTime() - 60 * 60 * 1000), // เริ่มขายเมื่อชั่วโมงที่แล้ว = ขายอยู่ตอนนี้
      saleEndAt: new Date(now.getTime() + 29 * 24 * 60 * 60 * 1000), // ปิดขายก่อนวันงาน 1 วัน
      maxTicketsPerUser: MAX_PER_USER,
      status: "ON_SALE",
      zones: {
        create: [
          {
            name: "TEST",
            description: `โซนทดลอง — ใบละ ${PRICE} บาท`,
            price: PRICE,
            totalSeats: SEATS,
            color: "#0ea5e9",
          },
        ],
      },
    },
    include: { zones: true },
  });

  // สร้างที่นั่งให้โซน (แถว A/B/C กระจายให้ครบ SEATS) — ตรรกะเดียวกับ prisma/seed.ts
  const zone = concert.zones[0];
  const seatsPerRow = Math.ceil(zone.totalSeats / ROWS.length);
  const seats: { zoneId: bigint; rowLabel: string; seatNumber: number }[] = [];
  let count = 0;
  for (const row of ROWS) {
    for (let n = 1; n <= seatsPerRow && count < zone.totalSeats; n++) {
      seats.push({ zoneId: zone.id, rowLabel: row, seatNumber: n });
      count++;
    }
  }
  await prisma.seat.createMany({ data: seats });

  console.log(`✅ สร้างแล้ว: ${concert.title}`);
  console.log(`   slug       : ${concert.slug}`);
  console.log(`   ราคา       : ${PRICE} บาท/ใบ  (จำกัด ${MAX_PER_USER} ใบ/บัญชี)`);
  console.log(`   ที่นั่ง     : ${seats.length} ที่  (โซน ${zone.name})`);
  console.log(`   ช่วงขาย    : ${concert.saleStartAt.toISOString()} → ${concert.saleEndAt.toISOString()}`);
  console.log(`   เปิดหน้าเว็บ: /concerts/${concert.slug}`);
}

async function remove() {
  const concert = await prisma.concert.findUnique({ where: { slug: SLUG } });
  if (!concert) {
    console.log(`ไม่พบคอนเสิร์ต slug "${SLUG}"`);
    return;
  }
  const orders = await countOrders(concert.id);
  if (orders > 0) {
    console.log(`❌ ลบไม่ได้ — มี ${orders} order ผูกกับคอนเสิร์ตนี้ (ตั๋วที่ขายไปแล้วจะหาย)`);
    process.exitCode = 1;
    return;
  }
  await prisma.concert.delete({ where: { id: concert.id } });
  console.log(`🧹 ลบคอนเสิร์ต "${SLUG}" แล้ว (zone/seat ถูกลบตามแบบ Cascade)`);
}

async function main() {
  const cmd = process.argv[2] ?? "create";
  // echo host ของ DB ที่กำลังชี้ (ตัด credential ออก) — กันเผลอแตะผิด DB (local vs Neon)
  const host = (process.env.DATABASE_URL ?? "").replace(/^[^@]*@/, "").replace(/[/?].*$/, "") || "(จาก .env)";
  console.log(`[demo-concert] DB host: ${host}  |  คำสั่ง: ${cmd}  |  slug: ${SLUG}\n`);

  if (cmd === "create") await create();
  else if (cmd === "remove") await remove();
  else {
    console.log(`ใช้: pnpm tsx scripts/create-demo-concert.ts <create|remove>`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("[demo-concert] ล้มเหลว:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
