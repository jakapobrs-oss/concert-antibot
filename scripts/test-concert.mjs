// สร้างคอนเสิร์ตทดสอบราคา 1 บาท สำหรับทดสอบระบบจ่ายเงิน (PromptPay + EasySlip)
// รันซ้ำได้ — ถ้ามีอยู่แล้วจะไม่สร้างซ้ำ แค่ทำให้เป็น ON_SALE
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SLUG = "test-1baht";

async function main() {
  const existing = await prisma.concert.findUnique({
    where: { slug: SLUG },
    include: { zones: { include: { _count: { select: { seats: true } } } } },
  });

  if (existing) {
    // มีอยู่แล้ว — ทำให้แน่ใจว่าเปิดขายอยู่
    if (existing.status !== "ON_SALE") {
      await prisma.concert.update({ where: { slug: SLUG }, data: { status: "ON_SALE" } });
    }
    const seatCount = existing.zones.reduce((n, z) => n + z._count.seats, 0);
    console.log(`ℹ️  มีคอนเสิร์ตทดสอบอยู่แล้ว → /concerts/${SLUG} (ON_SALE, ${seatCount} ที่นั่ง)`);
    return;
  }

  // สร้างใหม่: status ON_SALE, ช่วงขายเปิดอยู่, 1 โซนราคา 1 บาท
  const concert = await prisma.concert.create({
    data: {
      title: "ทดสอบระบบจ่ายเงิน (1 บาท)",
      slug: SLUG,
      description:
        "คอนเสิร์ตสำหรับทดสอบ flow การชำระเงิน — ราคา 1 บาท\nโอนจริงเข้าบัญชีตัวเองเพื่อทดสอบ EasySlip ได้ (ฟรี ทำซ้ำได้)",
      coverImageUrl: null,
      venue: "ห้องทดสอบระบบ",
      eventAt: new Date("2026-12-31T19:00:00+07:00"),
      saleStartAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // เปิดขายตั้งแต่เมื่อวาน
      saleEndAt: new Date("2027-12-31T23:59:59+07:00"), // ปิดขายอีกนาน
      maxTicketsPerUser: 2,
      status: "ON_SALE",
      zones: {
        create: [
          {
            name: "TEST",
            description: "ที่นั่งทดสอบ ราคา 1 บาท",
            price: 1,
            totalSeats: 10,
            color: "#dc2626",
          },
        ],
      },
    },
    include: { zones: true },
  });

  // สร้างที่นั่ง 10 ที่ (แถว A1–A10)
  const zone = concert.zones[0];
  const seats = Array.from({ length: zone.totalSeats }, (_, i) => ({
    zoneId: zone.id,
    rowLabel: "A",
    seatNumber: i + 1,
  }));
  await prisma.seat.createMany({ data: seats });

  console.log(`✅ สร้างแล้ว → /concerts/${SLUG}`);
  console.log(`   โซน TEST ราคา ฿1 · ${zone.totalSeats} ที่นั่ง · ON_SALE · จองได้สูงสุด 2 ใบ/คน`);
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
