// Seed data — 1 admin + 1 demo user + 2 concerts (มี zone/seat ครบ)
// รัน: pnpm db:seed
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // -------- 1. Admin --------
  const adminPassword = await argon2.hash("Admin123!", { type: argon2.argon2id });
  const admin = await prisma.user.upsert({
    where: { email: "admin@local" },
    update: {},
    create: {
      email: "admin@local",
      passwordHash: adminPassword,
      name: "Super Admin",
      role: "ADMIN",
      emailVerified: new Date(),
    },
  });
  console.log(`✅ Admin: ${admin.email} / Admin123!`);

  // -------- 2. Demo user --------
  const userPassword = await argon2.hash("Password123!", { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email: "user@local" },
    update: {},
    create: {
      email: "user@local",
      passwordHash: userPassword,
      name: "ผู้ใช้ทดสอบ",
      role: "USER",
      emailVerified: new Date(),
    },
  });
  console.log(`✅ User: ${user.email} / Password123!`);

  // -------- 3. Demo concert #1 --------
  await prisma.concert.deleteMany({ where: { slug: { in: ["bts-bangkok-2026", "ed-sheeran-bkk-2026"] } } });

  const concert1 = await prisma.concert.create({
    data: {
      title: "BTS World Tour Bangkok 2026",
      slug: "bts-bangkok-2026",
      description: "คอนเสิร์ตยิ่งใหญ่ที่สุดแห่งปี — กลับมาเจอ ARMY อีกครั้ง!",
      coverImageUrl: null,
      venue: "ราชมังคลากีฬาสถาน",
      eventAt: new Date("2026-08-15T19:00:00+07:00"),
      saleStartAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // เริ่มขายเมื่อวาน
      saleEndAt: new Date("2026-08-14T23:59:59+07:00"),
      maxTicketsPerUser: 4,
      status: "ON_SALE",
      zones: {
        create: [
          {
            name: "VIP",
            description: "ที่นั่งหน้าสุด + meet & greet",
            price: 8500,
            totalSeats: 20,
            color: "#dc2626",
          },
          {
            name: "R1",
            description: "ที่นั่งโซนหน้า",
            price: 5500,
            totalSeats: 30,
            color: "#f59e0b",
          },
          {
            name: "R2",
            description: "ที่นั่งโซนกลาง",
            price: 3500,
            totalSeats: 30,
            color: "#10b981",
          },
        ],
      },
    },
    include: { zones: true },
  });

  // สร้าง seat ทั้งหมดให้ทุก zone
  for (const zone of concert1.zones) {
    const rows = ["A", "B", "C", "D", "E"];
    const seatsPerRow = Math.ceil(zone.totalSeats / rows.length);
    const seats: { zoneId: bigint; rowLabel: string; seatNumber: number }[] = [];
    let count = 0;
    for (const row of rows) {
      for (let n = 1; n <= seatsPerRow && count < zone.totalSeats; n++) {
        seats.push({ zoneId: zone.id, rowLabel: row, seatNumber: n });
        count++;
      }
    }
    await prisma.seat.createMany({ data: seats });
  }
  console.log(`✅ Concert: ${concert1.title} (${concert1.zones.length} zones)`);

  // -------- 4. Demo concert #2 --------
  const concert2 = await prisma.concert.create({
    data: {
      title: "Ed Sheeran Live in Bangkok 2026",
      slug: "ed-sheeran-bkk-2026",
      description: "พบกับ Ed Sheeran ในคอนเสิร์ตครั้งแรกในไทย!",
      venue: "อิมแพ็ค อารีน่า เมืองทองธานี",
      eventAt: new Date("2026-10-20T20:00:00+07:00"),
      saleStartAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // เริ่มขายอีก 7 วัน
      saleEndAt: new Date("2026-10-19T23:59:59+07:00"),
      maxTicketsPerUser: 2,
      status: "SCHEDULED",
      zones: {
        create: [
          { name: "STANDING", description: "ยืน", price: 3000, totalSeats: 50, color: "#3b82f6" },
          { name: "SEATED", description: "นั่ง", price: 4500, totalSeats: 30, color: "#8b5cf6" },
        ],
      },
    },
    include: { zones: true },
  });

  for (const zone of concert2.zones) {
    const rows = ["A", "B", "C"];
    const seatsPerRow = Math.ceil(zone.totalSeats / rows.length);
    const seats: { zoneId: bigint; rowLabel: string; seatNumber: number }[] = [];
    let count = 0;
    for (const row of rows) {
      for (let n = 1; n <= seatsPerRow && count < zone.totalSeats; n++) {
        seats.push({ zoneId: zone.id, rowLabel: row, seatNumber: n });
        count++;
      }
    }
    await prisma.seat.createMany({ data: seats });
  }
  console.log(`✅ Concert: ${concert2.title} (${concert2.zones.length} zones)`);

  console.log("\n🎉 Done!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
