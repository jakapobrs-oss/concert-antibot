// ============================================================
// Integration (real browser + real DB + real Redis) — ด่านรอบกดบัตร (presale) หลัง merge สาย seatmap
// ============================================================
// รัน: npx tsx scripts/test-sale-round.ts   (ต้อง pnpm dev + pnpm db:up อยู่ · ส่ง E2E_BASE ถ้าไม่ใช่พอร์ต 3000)
//
// ทำไมต้องมีไฟล์นี้: ตอน merge สาย feat/membership-presale-storefront เข้า feat/seatmap (2026-08-25)
//   ด่านรอบ 3 จุดถูกต่อสายใหม่ด้วยมือจาก checkSaleAccess() → resolveEntryForUser()
//   unit test พิสูจน์ resolveRoundEntry() แบบ pure แล้ว แต่ไม่ได้พิสูจน์ว่า
//   route เข้าคิว → หน้าเลือกที่นั่ง (server component) → holdAndCreateOrder (server action) → order-finalize
//   ต่อกันติดบน DB/Redis จริง โดยเฉพาะ "เพดานตั๋วของรอบ" ที่หน้าจอต้องบอกเลขเดียวกับที่ server บังคับ
//
// flow: คอนเสิร์ตทดสอบ + รอบสมาชิก (เปิดอยู่, เพดาน 2 ใบ) + รอบทั่วไป (ยังไม่เปิด)
//   1. ยังไม่เป็นสมาชิก → POST /api/queue/join ต้องได้ 403 ROUND_LOCKED / NOT_MEMBER + บอกเวลารอบทั่วไป
//   2. ยังไม่เป็นสมาชิก แต่ถือ token ที่ admit แล้ว → หน้าเลือกที่นั่งต้องปฏิเสธ (ไม่มีปุ่มที่นั่ง)
//   3. ให้สิทธิ์สมาชิก → หน้าเลือกที่นั่งเปิด + หัวข้อบอกเพดาน 2 ใบของรอบสมาชิก + เข้าคิวผ่านด่านรอบ
//   4. เพิกถอนสิทธิ์ทั้งที่หน้าเปิดค้างอยู่ → กดซื้อต้องโดน server action ปฏิเสธ (ด่านใน holdAndCreateOrder)
//   5. คืนสิทธิ์ → ซื้อ 2 ใบสำเร็จ → order ผูก saleRoundId ของรอบสมาชิก
// ทำความสะอาด: ลบ order/ตั๋ว/สมาชิกทดสอบ + คอนเสิร์ต (cascade รอบ/โซน/ที่นั่ง) + key Redis + BotEvent ของรอบนี้
// บัญชีผู้ใช้ทั่วไปจาก prisma/seed.ts (fixture สำหรับ dev เท่านั้น)

import { chromium, type Page } from "playwright-core";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { joinQueue, admitNext, leaveQueue } from "../lib/queue";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const EMAIL = process.env.E2E_USER_EMAIL ?? "user@local";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "Password123!";
// UA จริง (ไม่มีคำว่า headless) — กัน anti-bot ให้คะแนน UA เป็นบอท
const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
}

async function grantMembership(userId: bigint) {
  await prisma.membership.create({
    data: { userId, status: "ACTIVE", source: "ADMIN_GRANT", tier: "STANDARD", expiresAt: null },
  });
}

async function main() {
  const now = Date.now();
  const startedAt = new Date(now);
  const slug = `sale-round-${now}`;
  const H = 3_600_000;

  // ---------- fixture: คอนเสิร์ต + รอบสมาชิก (เปิด) + รอบทั่วไป (ยังไม่เปิด) ----------
  const concert = await prisma.concert.create({
    data: {
      title: "คอนเสิร์ตทดสอบด่านรอบกดบัตร",
      slug,
      description: "ทดสอบอัตโนมัติ",
      venue: "โรงทดสอบ",
      eventAt: new Date(now + 30 * 86_400_000),
      saleStartAt: new Date(now - H),
      saleEndAt: new Date(now + 30 * 86_400_000),
      status: "ON_SALE",
      maxTicketsPerUser: 4,
      zones: {
        create: {
          name: "โซนทดสอบ",
          price: 1000,
          totalSeats: 10,
          color: "#3b82f6",
          seats: {
            create: Array.from({ length: 10 }, (_, i) => ({ rowLabel: "A", seatNumber: i + 1 })),
          },
        },
      },
      saleRounds: {
        create: [
          {
            name: "รอบสมาชิก",
            audience: "MEMBER_ONLY",
            startAt: new Date(now - H),
            endAt: new Date(now + H),
            maxTicketsPerUser: 2,
          },
          {
            name: "รอบทั่วไป",
            audience: "PUBLIC",
            startAt: new Date(now + 2 * H),
            endAt: new Date(now + 3 * H),
          },
        ],
      },
    },
    select: { id: true, saleRounds: { select: { id: true, name: true, startAt: true } } },
  });
  const concertId = concert.id.toString();
  const memberRound = concert.saleRounds.find((r) => r.name === "รอบสมาชิก")!;
  const publicRound = concert.saleRounds.find((r) => r.name === "รอบทั่วไป")!;

  const buyer = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } });
  // เริ่มจากสถานะ "ไม่เป็นสมาชิก" เสมอ
  await prisma.membership.deleteMany({ where: { userId: buyer.id } });

  const browser = await chromium.launch({ headless: true });
  const tokens: string[] = [];

  try {
    console.log(`\n🧪 ด่านรอบกดบัตร (presale) — concert ${concertId}\n`);
    const ctx = await browser.newContext({ userAgent: REAL_UA, locale: "th-TH", viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await login(page);

    // ---------- 1) ยังไม่เป็นสมาชิก: ด่านเข้าคิว ----------
    const r1 = await page.request.post(`${BASE}/api/queue/join`, { data: { concertId } });
    const b1 = (await r1.json().catch(() => ({}))) as Record<string, unknown>;
    check(
      "1) ยังไม่เป็นสมาชิก → /api/queue/join ตอบ 403 ROUND_LOCKED เหตุผล NOT_MEMBER",
      r1.status() === 403 && b1.action === "ROUND_LOCKED" && b1.reason === "NOT_MEMBER",
      `${r1.status()} ${JSON.stringify(b1).slice(0, 200)}`,
    );
    check(
      "1) บอกเวลารอบถัดไปที่เข้าได้ = รอบทั่วไป",
      typeof b1.nextRoundAt === "string" && new Date(b1.nextRoundAt).getTime() === publicRound.startAt.getTime(),
      String(b1.nextRoundAt),
    );

    // ---------- 2) ยังไม่เป็นสมาชิก แต่ถือ token ที่ admit แล้ว: หน้าเลือกที่นั่งต้องปิด ----------
    const join = await joinQueue({ concertId, userId: buyer.id.toString() });
    tokens.push(join.token);
    await admitNext(concertId, { batchSize: 5 });
    const seatsUrl = `${BASE}/concerts/${slug}/seats?qt=${join.token}`;
    await page.goto(seatsUrl, { waitUntil: "domcontentloaded" });
    let text = await page.locator("main").innerText();
    check(
      "2) หน้าเลือกที่นั่งปฏิเสธ (ยังไม่ถึงรอบของคุณ + สมาชิกเท่านั้น + บอกรอบทั่วไป)",
      /ยังไม่ถึงรอบของคุณ/.test(text) && /สมาชิกเท่านั้น/.test(text) && /รอบทั่วไป/.test(text),
      text.slice(0, 200),
    );
    check("2) ไม่มีปุ่มที่นั่งให้กด", (await page.locator('button[title="A1"]').count()) === 0);

    // ---------- 3) ให้สิทธิ์สมาชิก: หน้าเปิด + เพดานของรอบ ----------
    await grantMembership(buyer.id);
    await page.goto(seatsUrl, { waitUntil: "domcontentloaded" });
    await page.locator('button[title="A1"]').waitFor({ timeout: 15_000 });
    text = await page.locator("main").innerText();
    check(
      "3) สมาชิกเห็นผัง + หัวข้อบอกเพดาน 2 ใบ (เพดานของรอบสมาชิก) ไม่ใช่ 4 ของคอนเสิร์ต",
      /จำกัด 2 ใบ/.test(text) && /เพดานของรอบสมาชิก/.test(text),
      text.slice(0, 200),
    );

    // ---------- 4) เพิกถอนสิทธิ์ทั้งที่หน้าเปิดค้าง: server action ต้องปฏิเสธเอง ----------
    await prisma.membership.deleteMany({ where: { userId: buyer.id } });
    await page.locator('button[title="A1"]').click();
    await page.getByRole("button", { name: /ดำเนินการชำระเงิน/ }).click();
    await page.waitForURL(/\/checkout\//, { timeout: 12_000 }).catch(() => {});
    const revokedReachedCheckout = page.url().includes("/checkout/");
    text = await page.locator("main").innerText();
    check(
      "4) เพิกถอนสิทธิ์แล้วกดซื้อ → holdAndCreateOrder ปฏิเสธ (ไม่ถึงหน้า checkout + บอกสมาชิกเท่านั้น)",
      !revokedReachedCheckout && /สมาชิกเท่านั้น/.test(text),
      `${page.url()} :: ${text.slice(0, 200)}`,
    );
    const heldAfterRevoke = await prisma.orderItem.count({ where: { order: { concertId: concert.id } } });
    check("4) ไม่มีที่นั่งถูกผูกกับ order หลังถูกปฏิเสธ", heldAfterRevoke === 0, `count=${heldAfterRevoke}`);

    // ---------- 5) คืนสิทธิ์: ซื้อ 2 ใบสำเร็จ + order ผูกรอบสมาชิก ----------
    await grantMembership(buyer.id);
    await page.goto(seatsUrl, { waitUntil: "domcontentloaded" });
    await page.locator('button[title="A2"]').waitFor({ timeout: 15_000 });
    await page.locator('button[title="A2"]').click();
    await page.locator('button[title="A3"]').click();
    await page.getByRole("button", { name: /ดำเนินการชำระเงิน/ }).click();
    await page.waitForURL(/\/checkout\//, { timeout: 30_000 }).catch(() => {});
    const bought = page.url().includes("/checkout/");
    check("5) สมาชิกซื้อ 2 ใบในรอบสมาชิกได้ (ถึงหน้า checkout)", bought, page.url());
    const oid = page.url().split("/checkout/")[1]?.split(/[/?#]/)[0];
    const order = oid
      ? await prisma.order.findUnique({
          where: { id: BigInt(oid) },
          select: { saleRoundId: true, _count: { select: { items: true } } },
        })
      : null;
    check(
      "5) order ผูก saleRoundId = รอบสมาชิก และมี 2 ที่นั่ง",
      !!order && order.saleRoundId === memberRound.id && order._count.items === 2,
      JSON.stringify(order, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );

    // ---------- 6) API เข้าคิวของสมาชิก (ทำท้ายสุด: การ join ผ่าน API จะแทน token เดิมของผู้ใช้) ----------
    const r3 = await page.request.post(`${BASE}/api/queue/join`, { data: { concertId } });
    const b3 = (await r3.json().catch(() => ({}))) as Record<string, unknown>;
    check(
      "6) สมาชิกเข้าคิวผ่านด่านรอบ (ไม่ใช่ ROUND_LOCKED)",
      b3.action !== "ROUND_LOCKED",
      `${r3.status()} ${JSON.stringify(b3).slice(0, 200)}`,
    );
    // token ที่ได้จาก API นี้ไม่ได้ใช้ต่อ — ออกจากคิวทันที กันไปทับ token ที่ admit ไว้แล้วในข้อ 2
    if (typeof b3.token === "string") await leaveQueue(b3.token).catch(() => {});

    await ctx.close();
  } catch (e) {
    // ข้อผิดพลาดกลางทาง (เช่น รอปุ่มไม่เจอ) ต้องนับเป็น "ตก" ไม่ใช่เงียบหายแล้ว exit 0
    fail++;
    console.error("  💥 เทสล้มกลางทาง:", e instanceof Error ? `${e.name}: ${e.message}` : e);
  } finally {
    await browser.close();
    // ---------- cleanup ----------
    const orders = await prisma.order.findMany({ where: { concertId: concert.id }, select: { id: true } });
    for (const o of orders) {
      await prisma.ticket.deleteMany({ where: { orderId: o.id } });
      await prisma.payment.deleteMany({ where: { orderId: o.id } });
      await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
    }
    await prisma.order.deleteMany({ where: { concertId: concert.id } });
    await prisma.membership.deleteMany({ where: { userId: buyer.id } });
    await prisma.botEvent.deleteMany({
      where: { checkpoint: "purchase", userId: buyer.id, createdAt: { gte: startedAt } },
    });
    for (const t of tokens) await leaveQueue(t).catch(() => {});
    await prisma.concert.delete({ where: { id: concert.id } });
    const keys = await redis.keys(`*${concertId}*`);
    if (keys.length) await redis.del(...keys);
    console.log("\n🧹 cleanup เสร็จ (ลบ order + สมาชิกทดสอบ + คอนเสิร์ตทดสอบ + key Redis)");
    console.log(`\n📊 ผ่าน ${pass} / ตก ${fail}\n`);
    await prisma.$disconnect();
    await redis.quit().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  }
}

main();
