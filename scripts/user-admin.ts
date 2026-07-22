// ============================================================
// User Admin CLI — จัดการบัญชีผู้ใช้จาก command line
// ============================================================
// ใช้ตอนที่ระบบเมลยืนยันส่งหาคนอื่นไม่ได้ (Resend sandbox onboarding@resend.dev
//   ส่งได้แค่อีเมลเจ้าของบัญชี จนกว่าจะ verify โดเมนจริง — ดู docs/17 go-live)
//   → verify บัญชีทดสอบให้ล็อกอินได้เลยโดยไม่ต้องรอเมล + ลบบัญชีค้าง
//
// รันกับ DB local (ต้อง start docker postgres ก่อน: docker start concert-postgres):
//   pnpm tsx scripts/user-admin.ts find sittichok          # ค้นหา (email มีคำนี้)
//   pnpm tsx scripts/user-admin.ts verify user@email.com   # mark verified (email เป๊ะ)
//   pnpm tsx scripts/user-admin.ts delete user@email.com   # ลบบัญชี (email เป๊ะ)
//
// รันกับ Neon (DB ของ QA) — override DATABASE_URL ต่อหน้า:
//   DATABASE_URL="postgresql://...neon.tech/...?sslmode=require" \
//     pnpm tsx scripts/user-admin.ts find sittichok
import { prisma } from "../lib/prisma";

// ค้นหาบัญชีจากคำในอีเมล (contains, ไม่สนตัวพิมพ์) — โชว์สถานะ verified/ยังไม่
async function find(query: string) {
  const users = await prisma.user.findMany({
    where: { email: { contains: query, mode: "insensitive" } },
    select: { id: true, email: true, name: true, role: true, emailVerified: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  if (users.length === 0) {
    console.log(`ไม่พบบัญชีที่อีเมลมีคำว่า "${query}"`);
    return;
  }
  console.log(`พบ ${users.length} บัญชี:`);
  for (const u of users) {
    const status = u.emailVerified
      ? `verified ${u.emailVerified.toISOString().slice(0, 10)}`
      : "UNVERIFIED";
    console.log(
      `  #${u.id}  ${u.email}  [${status}]  role=${u.role}  name=${u.name ?? "-"}  created=${u.createdAt
        .toISOString()
        .slice(0, 10)}`
    );
  }
}

// mark บัญชีเป็น verified + ปลดล็อก/reset ตัวนับผิดรหัส → ล็อกอินได้ทันที
async function verify(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.log(`ไม่พบบัญชี email=${email} (ต้องพิมพ์ให้เป๊ะ — ใช้ find ค้นก่อนได้)`);
    process.exitCode = 1;
    return;
  }
  if (user.emailVerified) {
    console.log(`บัญชี ${email} ยืนยันแล้วตั้งแต่ ${user.emailVerified.toISOString()} — ไม่ต้องทำอะไร`);
    return;
  }
  await prisma.user.update({
    where: { email },
    data: { emailVerified: new Date(), failedLoginCount: 0, lockedUntil: null },
  });
  console.log(`✅ mark ${email} เป็น verified + ปลดล็อกแล้ว — ล็อกอินได้เลย`);
}

// ลบบัญชี — แต่กันไว้ก่อน: ถ้ามีข้อมูลจริง (order/ticket/คิว) ห้ามลบเงียบ ๆ
async function remove(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      _count: {
        select: { orders: true, tickets: true, queueTokens: true, heldItems: true, ticketReturns: true },
      },
    },
  });
  if (!user) {
    console.log(`ไม่พบบัญชี email=${email} (ต้องพิมพ์ให้เป๊ะ)`);
    process.exitCode = 1;
    return;
  }
  const c = user._count;
  const dataCount = c.orders + c.tickets + c.queueTokens + c.heldItems + c.ticketReturns;
  if (dataCount > 0) {
    // มีข้อมูลการเงิน/การจองจริง — ลบทิ้งเงียบ ๆ อันตราย ให้ใช้ verify แทน หรือลบมือเองถ้าตั้งใจ
    console.log(
      `⛔ ไม่ลบ: ${email} มีข้อมูลจริง (order=${c.orders} ticket=${c.tickets} queue=${c.queueTokens} ` +
        `held=${c.heldItems} return=${c.ticketReturns}) — ปลดล็อกด้วย verify ดีกว่า`
    );
    process.exitCode = 1;
    return;
  }
  // สะอาด (บัญชีค้างที่ไม่เคยล็อกอิน) — ลบ session/account/verification-token ที่พ่วง แล้วลบ user แบบ atomic
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.account.deleteMany({ where: { userId: user.id } }),
    prisma.verificationToken.deleteMany({ where: { identifier: email } }),
    prisma.user.delete({ where: { email } }),
  ]);
  console.log(`🗑️  ลบ ${email} + session/account/token ที่พ่วงเรียบร้อย — สมัครใหม่ด้วยอีเมลนี้ได้แล้ว`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd || !arg) {
    console.log("ใช้: pnpm tsx scripts/user-admin.ts <find|verify|delete> <email>");
    process.exitCode = 1;
    return;
  }
  // echo host ของ DB ที่กำลังชี้ (ตัด credential ออก) — กันเผลอแตะผิด DB (local vs Neon)
  const host = (process.env.DATABASE_URL ?? "").replace(/^[^@]*@/, "").replace(/[/?].*$/, "") || "(จาก .env)";
  console.log(`[user-admin] DB host: ${host}  |  คำสั่ง: ${cmd} "${arg}"\n`);

  if (cmd === "find") await find(arg);
  else if (cmd === "verify") await verify(arg);
  else if (cmd === "delete") await remove(arg);
  else {
    console.log(`ไม่รู้จักคำสั่ง "${cmd}" (มีแค่ find | verify | delete)`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("[user-admin] ล้มเหลว:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
