// Seed data — บัญชี (ตามนโยบาย lib/seed-policy.ts) + 2 concerts (มี zone/seat ครบ)
// รัน: pnpm db:seed
// บน Vercel รัน "ทุก deploy" ผ่าน vercel.json buildCommand (production + preview ใช้ Neon ตัวเดียวกัน)
//   → ห้ามให้รหัสสาธารณะในไฟล์นี้หลุดไป DB จริง — ดูกติกาใน lib/seed-policy.ts
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { isHostedDeploy, resolveSeedAccountPolicy } from "../lib/seed-policy";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // -------- 1–2. บัญชี --------
  // (2026-08-27) เดิม upsert admin@local/Admin123! + user@local/Password123! ทุกครั้ง — บน repo PUBLIC
  //   = ใครอ่านโค้ดก็ล็อกอินเป็นแอดมิน prod ได้ → ตอนนี้บัญชีเดโมสร้างเฉพาะเครื่อง dev,
  //   deploy ที่โฮสต์ล็อกของเดิมและรับแอดมินจริงจาก env เท่านั้น
  const policy = resolveSeedAccountPolicy({
    isHosted: isHostedDeploy(process.env),
    seedAdminEmail: process.env.SEED_ADMIN_EMAIL,
    seedAdminPassword: process.env.SEED_ADMIN_PASSWORD,
  });
  for (const warning of policy.warnings) console.warn(`⚠️  [SEED] ${warning}`);

  if (policy.createDemoAccounts) {
    // เครื่อง dev เท่านั้น — รหัสสาธารณะสำหรับเทสเบราว์เซอร์/สคริปต์ (Admin123! / Password123!)
    //   update ด้วย = `pnpm db:seed` รีเซ็ตบัญชีเดโมกลับมาใช้ได้เสมอ (เช่นหลังเผลอรันโหมดโฮสต์ในเครื่อง)
    const adminPassword = await argon2.hash("Admin123!", { type: argon2.argon2id });
    const admin = await prisma.user.upsert({
      where: { email: "admin@local" },
      update: { passwordHash: adminPassword, role: "ADMIN" },
      create: {
        email: "admin@local",
        passwordHash: adminPassword,
        name: "Super Admin",
        role: "ADMIN",
        emailVerified: new Date(),
      },
    });
    console.log(`✅ Admin (dev): ${admin.email}`);

    const userPassword = await argon2.hash("Password123!", { type: argon2.argon2id });
    const user = await prisma.user.upsert({
      where: { email: "user@local" },
      update: { passwordHash: userPassword, role: "USER" },
      create: {
        email: "user@local",
        passwordHash: userPassword,
        name: "ผู้ใช้ทดสอบ",
        role: "USER",
        emailVerified: new Date(),
      },
    });
    console.log(`✅ User (dev): ${user.email}`);
  } else {
    console.log("⏭️  deploy ที่โฮสต์: ไม่สร้างบัญชีเดโมรหัสสาธารณะ");
  }

  // ล็อกบัญชีเดโมที่เคยถูก seed ไว้ใน DB นี้ (idempotent) — ล็อกอินด้วยรหัสไม่ได้ + ถอด ADMIN
  //   ไม่ลบแถว: อาจมี order/ticket อ้างถึง (FK) · lib/admin-guard.ts เช็ค role จาก DB ทุกคำขอ → มีผลทันที
  for (const email of policy.lockEmails) {
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { role: true, passwordHash: true },
    });
    if (!existing) continue;
    if (existing.passwordHash === null && existing.role === "USER") continue; // ล็อกไว้แล้ว
    await prisma.user.update({ where: { email }, data: { passwordHash: null, role: "USER" } });
    console.log(`🔒 ล็อกบัญชีเดโม ${email} (ไม่มีรหัสผ่าน + role USER)`);
  }

  // แอดมินจริงจาก env — env เป็นแหล่งความจริง (รหัสถูกตั้งใหม่ตามค่า env ทุก deploy) · ไม่พิมพ์รหัสลง log
  if (policy.adminFromEnv) {
    const { email, password } = policy.adminFromEnv;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const admin = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, role: "ADMIN" },
      create: { email, passwordHash, name: "Admin", role: "ADMIN", emailVerified: new Date() },
      select: { email: true, emailVerified: true },
    });
    // บัญชีเดิมที่ยังไม่ยืนยันอีเมล (เช่นสมัครแล้วเมลไม่ถึง) → ยืนยันให้ ไม่งั้นล็อกอินไม่ได้แม้เป็น ADMIN
    if (!admin.emailVerified) {
      await prisma.user.update({ where: { email }, data: { emailVerified: new Date() } });
    }
    console.log(`✅ Admin (จาก env): ${admin.email}`);
  }

  // -------- 3. Demo concert #1 --------
  // (2026-08-26) เลิก deleteMany: พอมี order อ้างถึงคอนเสิร์ตเดโม FK จะพัง (orders_concertId_fkey) → seed ล้ม
  //   → `next build` บน Vercel ล้มทั้ง deploy · และการล้างเดโมทุก deploy ทำให้ออเดอร์/ที่นั่งบน prod หายโดยไม่ตั้งใจ
  //   จึงสร้างเฉพาะเมื่อยังไม่มี slug นั้น (idempotent) — อยากรีเซ็ตเดโมให้ลบจากหน้าแอดมิน/DB เอง
  const hasBts = await prisma.concert.findUnique({ where: { slug: "bts-bangkok-2026" }, select: { id: true } });
  if (hasBts) {
    console.log("⏭️  Concert bts-bangkok-2026 มีอยู่แล้ว — ข้าม");
  } else {
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
  }


  // -------- 4. Demo concert #2 --------
  const hasEd = await prisma.concert.findUnique({ where: { slug: "ed-sheeran-bkk-2026" }, select: { id: true } });
  if (hasEd) {
    console.log("⏭️  Concert ed-sheeran-bkk-2026 มีอยู่แล้ว — ข้าม");
  } else {
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
  }

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
