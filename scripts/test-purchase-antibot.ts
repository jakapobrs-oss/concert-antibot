// ============================================================
// Integration (real browser + real DB + real Redis) — ด่าน anti-bot ตอน "กดซื้อ"
// ============================================================
// รัน: npx tsx scripts/test-purchase-antibot.ts   (ต้อง pnpm dev + pnpm db:up อยู่)
//
// พิสูจน์ SECURITY_TODO #1: บอทที่ผ่านด่านคิวมาแล้ว (ถือ queue token ที่ถูก admit จริง)
// ยังต้องโดนด่านตอนกดซื้อ — ไม่ใช่เดินเข้าไปซื้อได้เลยเหมือนเดิม
//
// ⚠️ จุดที่ต้องระวังตอนอ่านผล: เทสนี้ให้สิทธิ์บอทถึงขั้น "ถือ token ที่ admit แล้ว"
//    (สร้างผ่าน joinQueue + admitNext ตรง ๆ) = สมมติสถานการณ์เลวร้ายสุดที่ด่านคิวถูกข้ามไปแล้ว
//    ถ้าไม่ทำแบบนี้ บอทจะถูกด่านคิวปัดตกก่อน แล้วเราจะไม่ได้ทดสอบด่านใหม่เลย
//
// 3 กรณีที่ต้องผ่านให้ครบ:
//   A. เบราว์เซอร์จริง            -> ซื้อได้ตามปกติ (ห้าม false positive บนเส้นทางเงิน)
//   B. UA เป็นสคริปต์ + header โหว่ -> ถูกปฏิเสธ ไม่ได้ order และไม่มีที่นั่งถูกล็อก
//   C. บันทึก BotEvent checkpoint="purchase" ลง DB จริง (ใช้ทำ dashboard + สถิติในเล่ม)
import { chromium } from "playwright-core";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { joinQueue, admitNext, leaveQueue } from "../lib/queue";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const EMAIL = process.env.E2E_USER_EMAIL ?? "user@local";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "Password123!";
const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// UA ที่บอกตัวเองว่าเป็นสคริปต์ — ตรงกับ BOT_UA_KEYWORDS ใน lib/antibot.ts
const BOT_UA = "python-requests/2.31.0";

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
  // ---------- เตรียมคอนเสิร์ตทดสอบ (โซนนั่งธรรมดา ไม่ต้องมีผังรูป) ----------
  const slug = `antibot-purchase-${Date.now()}`;
  const now = Date.now();
  const startedAt = new Date(now); // ใช้จำกัดขอบเขตตอนลบ BotEvent — ห้ามกวาดของแถวอื่นทิ้ง
  const concert = await prisma.concert.create({
    data: {
      title: "คอนเสิร์ตทดสอบด่านบอทตอนซื้อ",
      slug,
      description: "ทดสอบอัตโนมัติ",
      venue: "โรงทดสอบ",
      eventAt: new Date(now + 30 * 86_400_000),
      saleStartAt: new Date(now - 3_600_000),
      saleEndAt: new Date(now + 30 * 86_400_000),
      status: "ON_SALE",
      maxTicketsPerUser: 4,
      zones: {
        create: {
          name: "โซนทดสอบ",
          price: 1000,
          totalSeats: 10,
          color: "#ef4444",
          seats: {
            create: Array.from({ length: 10 }, (_, i) => ({
              rowLabel: "A",
              seatNumber: i + 1,
            })),
          },
        },
      },
    },
    select: { id: true, zones: { select: { seats: { select: { id: true } } } } },
  });
  const concertId = concert.id.toString();

  const buyer = await prisma.user.findUniqueOrThrow({
    where: { email: EMAIL },
    select: { id: true },
  });

  const browser = await chromium.launch({ headless: true });
  const createdOrderIds: bigint[] = [];
  const tokens: string[] = [];


  try {
    console.log(`\n🧪 ด่าน anti-bot ตอนกดซื้อ (concert ${concertId})\n`);

    // ---------- A) เบราว์เซอร์จริง: ต้องซื้อได้ ----------
    const humanCtx = await browser.newContext({
      userAgent: REAL_UA,
      locale: "th-TH",
      viewport: { width: 1440, height: 1000 },
    });
    const humanPage = await humanCtx.newPage();
    await humanPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await humanPage.fill("#email", EMAIL);
    await humanPage.fill("#password", PASSWORD);
    await humanPage.click('button[type="submit"]');
    await humanPage.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    const humanJoin = await joinQueue({ concertId, userId: buyer.id.toString() });
    tokens.push(humanJoin.token);
    await admitNext(concertId, { batchSize: 5 });
    await humanPage.goto(`${BASE}/concerts/${slug}/seats?qt=${humanJoin.token}`, {
      waitUntil: "domcontentloaded",
    });
    await humanPage.locator('button[title="A1"]').waitFor({ timeout: 15_000 });
    await humanPage.locator('button[title="A1"]').click();
    await humanPage.locator('button[title="A2"]').click();
    await humanPage.getByRole("button", { name: /ดำเนินการชำระเงิน/ }).click();
    await humanPage.waitForURL(/\/checkout\//, { timeout: 30_000 }).catch(() => {});
    const humanBought = humanPage.url().includes("/checkout/");
    check(
      "A) เบราว์เซอร์จริงยังซื้อได้ตามปกติ (ไม่โดนด่านใหม่เด้ง)",
      humanBought,
      humanPage.url(),
    );
    if (humanBought) {
      const oid = humanPage.url().split("/checkout/")[1]?.split(/[/?#]/)[0];
      if (oid) createdOrderIds.push(BigInt(oid));
    }
    await humanCtx.close();

    // ---------- B) UA เป็นสคริปต์: ต้องโดนด่าน ----------
    const botCtx = await browser.newContext({
      userAgent: BOT_UA,
      locale: "th-TH",
      viewport: { width: 1440, height: 1000 },
    });
    const botPage = await botCtx.newPage();
    await botPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await botPage.fill("#email", EMAIL);
    await botPage.fill("#password", PASSWORD);
    await botPage.click('button[type="submit"]');
    await botPage.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    const botJoin = await joinQueue({ concertId, userId: buyer.id.toString() });
    tokens.push(botJoin.token);
    await admitNext(concertId, { batchSize: 5 });
    await botPage.goto(`${BASE}/concerts/${slug}/seats?qt=${botJoin.token}`, {
      waitUntil: "domcontentloaded",
    });
    await botPage.locator('button[title="A3"]').waitFor({ timeout: 15_000 });
    await botPage.locator('button[title="A3"]').click();
    await botPage.getByRole("button", { name: /ดำเนินการชำระเงิน/ }).click();
    // ให้เวลา server action ตอบกลับ แล้วดูว่าไปหน้า checkout ไหม
    await botPage.waitForURL(/\/checkout\//, { timeout: 12_000 }).catch(() => {});
    const botReachedCheckout = botPage.url().includes("/checkout/");
    check(
      "B) UA เป็นสคริปต์ถูกด่านตอนซื้อหยุด (ไม่ได้เข้าหน้า checkout)",
      !botReachedCheckout,
      botPage.url(),
    );
    const botScreen = await botPage.locator("main").innerText();
    check(
      "B) หน้าจอบอกเหตุผล (ยืนยันไม่ใช่บอท หรือ ตรวจพบกิจกรรมผิดปกติ)",
      /ไม่ใช่บอท|ผิดปกติ/.test(botScreen),
      botScreen.slice(0, 200),
    );
    await botPage.screenshot({ path: ".shots/purchase-antibot-blocked.png" });
    if (botReachedCheckout) {
      const oid = botPage.url().split("/checkout/")[1]?.split(/[/?#]/)[0];
      if (oid) createdOrderIds.push(BigInt(oid));
    }
    await botCtx.close();

    // ---------- C) BotEvent ถูกบันทึกที่ checkpoint purchase ----------
    const events = await prisma.botEvent.findMany({
      where: { checkpoint: "purchase", userId: buyer.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { score: true, action: true, userAgent: true },
    });
    check(
      "C) มี BotEvent checkpoint=purchase บันทึกลง DB",
      events.length > 0,
      `found=${events.length}`,
    );
    const botEvent = events.find((e) => e.userAgent === BOT_UA);
    check(
      "C) เหตุการณ์ของ UA สคริปต์ถูกตัดสินเป็น CHALLENGE หรือ BLOCK",
      !!botEvent && botEvent.action !== "ALLOW",
      JSON.stringify(botEvent),
    );
    const humanEvent = events.find((e) => e.userAgent === REAL_UA);
    check(
      "C) เหตุการณ์ของเบราว์เซอร์จริงถูกตัดสินเป็น ALLOW",
      !!humanEvent && humanEvent.action === "ALLOW",
      JSON.stringify(humanEvent),
    );

    // ---------- D) ที่นั่งของบอทต้องไม่ถูกล็อกค้าง ----------
    const heldByBot = await prisma.orderItem.count({
      where: { seatId: BigInt(concert.zones[0].seats[2].id) },
    });
    check("D) ที่นั่งที่บอทพยายามจองไม่ถูกผูกกับ order ใด", heldByBot === 0, `count=${heldByBot}`);
  } finally {
    await browser.close();
    // ---------- cleanup ----------
    const orders = await prisma.order.findMany({
      where: { concertId: concert.id },
      select: { id: true },
    });
    for (const o of orders) {
      await prisma.ticket.deleteMany({ where: { orderId: o.id } });
      await prisma.payment.deleteMany({ where: { orderId: o.id } });
      await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
    }
    await prisma.order.deleteMany({ where: { concertId: concert.id } });
    await prisma.botEvent.deleteMany({
      where: { checkpoint: "purchase", userId: buyer.id, createdAt: { gte: startedAt } },
    });
    for (const t of tokens) await leaveQueue(t).catch(() => {});
    await prisma.concert.delete({ where: { id: concert.id } });
    const keys = await redis.keys(`*${concertId}*`);
    if (keys.length) await redis.del(...keys);
    console.log("\n🧹 cleanup เสร็จ (ลบ order + คอนเสิร์ตทดสอบ + BotEvent ทดสอบ + key Redis)");
    console.log(`\n📊 ผ่าน ${pass} / ตก ${fail}\n`);
    void createdOrderIds;
    await prisma.$disconnect();
    await redis.quit().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  }
}

main();
