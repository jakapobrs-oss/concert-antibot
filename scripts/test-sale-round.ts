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
//   7. (rev 43) ตั้งโควต้ารอบสมาชิก = 2 (order ข้อ 5 กินครบพอดี) → API รอบขึ้น QUOTA_FULL + ประตูคิว 403 ROUND_QUOTA_FULL
//      + หน้าคอนเสิร์ตขึ้น "โควต้ารอบนี้หมดแล้ว" และบอกว่าที่เหลือไปรอบทั่วไป
//   8. (rev 43) แผง CTA มีบรรทัด "ตอนนี้: รอบสมาชิก (เฉพาะสมาชิก) · รอบทั่วไป เริ่ม …" (หน้าแคช ไม่ผูกผู้ใช้)
//   9. (rev 43) แอดมินกด "ตั้งรอบให้เลย" บนคอนเสิร์ต B (ยังไม่มีรอบ, เริ่มขายอีก 2 วัน) ผ่านหน้าแอดมินจริง
//      → ได้รอบสมาชิก [เริ่มขายเดิม − 3 วัน, เริ่มขายเดิม) + รอบทั่วไป [เริ่มขายเดิม, ปิดขาย)
//      → Concert.saleStartAt ถูกเลื่อนมาเป็นเวลาเริ่มรอบสมาชิก → หน้าคอน B มีปุ่มเข้าคิวตั้งแต่ตอนนี้ (ไม่ใช่ "เร็ว ๆ นี้")
// ทำความสะอาด: ลบ order/ตั๋ว/สมาชิกทดสอบ + คอนเสิร์ต A/B (cascade รอบ/โซน/ที่นั่ง) + key Redis + BotEvent ของรอบนี้
// บัญชีผู้ใช้ทั่วไปจาก prisma/seed.ts (fixture สำหรับ dev เท่านั้น)

import { chromium, type Page } from "playwright-core";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { joinQueue, admitNext, leaveQueue } from "../lib/queue";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const EMAIL = process.env.E2E_USER_EMAIL ?? "user@local";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "Password123!";
// บัญชีแอดมินเดโมจาก prisma/seed.ts (เครื่อง dev เท่านั้น) — ใช้กดพรีเซ็ตรอบผ่านหน้าแอดมินจริงในข้อ 9
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin123!";
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

// หน้า [slug] มี loading.tsx → ระหว่าง stream อาจมี <main aria-busy> ของโครงโหลดค้างอยู่พร้อม main จริง (2 ตัว)
//   locator("main") จึงชน strict mode — รอ main ตัวจริง (ไม่ busy) เท่านั้น
async function mainText(page: Page): Promise<string> {
  const main = page.locator('main:not([aria-busy="true"])').first();
  await main.waitFor({ timeout: 15_000 });
  return main.innerText();
}

async function login(page: Page, email = EMAIL, password = PASSWORD) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", password);
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

  // คอนเสิร์ต B สำหรับข้อ 9: ยังไม่มีรอบ · "เริ่มขาย" อีก 2 วัน (พรีเซ็ตกดก่อน 3 วัน → รอบสมาชิกเริ่มเมื่อวาน = เปิดอยู่ตอนนี้)
  const D = 86_400_000;
  const slugB = `${slug}-preset`;
  const concertB = await prisma.concert.create({
    data: {
      title: "คอนเสิร์ตทดสอบพรีเซ็ตรอบสมาชิก",
      slug: slugB,
      description: "ทดสอบอัตโนมัติ",
      venue: "โรงทดสอบ",
      eventAt: new Date(now + 30 * D),
      saleStartAt: new Date(now + 2 * D),
      saleEndAt: new Date(now + 10 * D),
      status: "ON_SALE",
      maxTicketsPerUser: 4,
      zones: {
        create: {
          name: "โซน B",
          price: 500,
          totalSeats: 4,
          color: "#22c55e",
          seats: { create: Array.from({ length: 4 }, (_, i) => ({ rowLabel: "A", seatNumber: i + 1 })) },
        },
      },
    },
    select: { id: true, saleStartAt: true, saleEndAt: true },
  });

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
    let text = await mainText(page);
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
    text = await mainText(page);
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
    text = await mainText(page);
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

    // ---------- 7) โควต้ารอบสมาชิกหมด → ต้องขึ้นหน้าเว็บ + ปิดประตูคิว (rev 43, docs/23 §9) ----------
    //   order ข้อ 5 ผูก 2 ที่นั่งกับรอบสมาชิกอยู่แล้ว → ตั้งโควต้า = 2 ให้ "หมดพอดี" (ทั้งงานยังเหลือ 8 ที่)
    await prisma.saleRound.update({ where: { id: memberRound.id }, data: { seatQuota: 2 } });
    const r7 = await page.request.get(`${BASE}/api/concerts/${concertId}/rounds`);
    const b7 = (await r7.json().catch(() => ({}))) as {
      rounds?: { id: string; state: string; seatsTaken: number | null }[];
      entry?: { ok: boolean; reason?: string; message?: string };
    };
    const memberView = b7.rounds?.find((r) => r.id === memberRound.id.toString());
    check(
      "7) API รอบ: รอบสมาชิกขึ้น QUOTA_FULL (2/2) ไม่ใช่ 'เปิดอยู่ — คุณเข้าได้'",
      memberView?.state === "QUOTA_FULL" && memberView.seatsTaken === 2,
      JSON.stringify(memberView),
    );
    check(
      "7) API รอบ: สรุปสิทธิ์ = ROUND_QUOTA_FULL + บอกว่ารอบทั่วไปเริ่มเมื่อไร",
      b7.entry?.ok === false && b7.entry.reason === "ROUND_QUOTA_FULL" && /รอบทั่วไป/.test(b7.entry.message ?? ""),
      JSON.stringify(b7.entry),
    );
    const r7b = await page.request.post(`${BASE}/api/queue/join`, { data: { concertId } });
    const b7b = (await r7b.json().catch(() => ({}))) as Record<string, unknown>;
    check(
      "7) ประตูคิวปฏิเสธ 403 เหตุผล ROUND_QUOTA_FULL (ไม่ปล่อยเข้าคิวแล้วไปตกตอนจอง)",
      r7b.status() === 403 && b7b.reason === "ROUND_QUOTA_FULL",
      `${r7b.status()} ${JSON.stringify(b7b).slice(0, 200)}`,
    );
    if (typeof b7b.token === "string") await leaveQueue(b7b.token).catch(() => {});
    await page.goto(`${BASE}/concerts/${slug}`, { waitUntil: "domcontentloaded" });
    await page.getByText("โควต้ารอบนี้หมดแล้ว").first().waitFor({ timeout: 15_000 }).catch(() => {});
    text = await mainText(page);
    check(
      "7) หน้าคอนเสิร์ต: การ์ดรอบสมาชิกขึ้น 'โควต้ารอบนี้หมดแล้ว' + 'ที่นั่งที่เหลือจะเปิดขายในรอบทั่วไป'",
      /โควต้ารอบนี้หมดแล้ว/.test(text) && /ที่นั่งที่เหลือจะเปิดขายในรอบทั่วไป/.test(text),
      text.slice(0, 300),
    );

    // ---------- 8) บรรทัดสรุปรอบบนแผง CTA (หน้าแคช ไม่ผูกผู้ใช้) ----------
    const timeline = await page.locator('[data-testid="round-timeline"]').innerText().catch(() => "");
    check(
      "8) แผง CTA บอก 'ตอนนี้: รอบสมาชิก (เฉพาะสมาชิก) · รอบทั่วไป เริ่ม …'",
      /ตอนนี้: รอบสมาชิก \(เฉพาะสมาชิก\)/.test(timeline) && /รอบทั่วไป เริ่ม/.test(timeline),
      timeline,
    );

    // ---------- 9) พรีเซ็ต "ตั้งรอบให้เลย" ผ่านหน้าแอดมินจริง: ยึดช่วงขายเดิม + เลื่อน "เริ่มขาย" ----------
    const adminCtx = await browser.newContext({ userAgent: REAL_UA, locale: "th-TH", viewport: { width: 1440, height: 1000 } });
    const adminPage = await adminCtx.newPage();
    await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);
    await adminPage.goto(`${BASE}/admin/concerts/${concertB.id}`, { waitUntil: "domcontentloaded" });
    const presetBtn = adminPage.getByRole("button", { name: "ตั้งรอบให้เลย" });
    await presetBtn.waitFor({ timeout: 15_000 });
    await presetBtn.click();
    await adminPage.getByText(/ตั้งรอบแล้ว/).waitFor({ timeout: 20_000 }).catch(() => {});
    const presetMsg = await adminPage.locator('[role="status"]').first().innerText().catch(() => "");
    check("9) แอดมินกดพรีเซ็ตแล้วได้ข้อความ 'ตั้งรอบแล้ว … เลื่อน \"เริ่มขาย\"'", /ตั้งรอบแล้ว/.test(presetMsg) && /เริ่มขาย/.test(presetMsg), presetMsg);
    const afterB = await prisma.concert.findUniqueOrThrow({
      where: { id: concertB.id },
      select: {
        saleStartAt: true,
        saleEndAt: true,
        saleRounds: { select: { audience: true, startAt: true, endAt: true }, orderBy: { startAt: "asc" } },
      },
    });
    const memB = afterB.saleRounds.find((r) => r.audience === "MEMBER_ONLY");
    const pubB = afterB.saleRounds.find((r) => r.audience === "PUBLIC");
    check(
      "9) ได้ 2 รอบต่อกันพอดี: สมาชิก [เริ่มขายเดิม − 3 วัน, เริ่มขายเดิม) · ทั่วไป [เริ่มขายเดิม, ปิดขาย)",
      afterB.saleRounds.length === 2 &&
        !!memB &&
        !!pubB &&
        memB.startAt.getTime() === concertB.saleStartAt.getTime() - 3 * D &&
        memB.endAt.getTime() === concertB.saleStartAt.getTime() &&
        pubB.startAt.getTime() === concertB.saleStartAt.getTime() &&
        pubB.endAt.getTime() === concertB.saleEndAt.getTime(),
      JSON.stringify(afterB.saleRounds),
    );
    check(
      "9) 'เริ่มขาย' ของคอนเสิร์ตถูกเลื่อนมาเป็นเวลาเริ่มรอบสมาชิก · 'ปิดขาย' ไม่ถูกแตะ",
      !!memB && afterB.saleStartAt.getTime() === memB.startAt.getTime() && afterB.saleEndAt.getTime() === concertB.saleEndAt.getTime(),
      `${afterB.saleStartAt.toISOString()} vs ${memB?.startAt.toISOString()}`,
    );
    await adminCtx.close();
    // หน้าคอน B ฝั่งคนซื้อ: ปุ่มเข้าคิวต้องโผล่ตั้งแต่รอบสมาชิก (เดิมจะเป็น "เร็ว ๆ นี้" เพราะ saleStartAt ยังอยู่ในอนาคต)
    await page.goto(`${BASE}/concerts/${slugB}`, { waitUntil: "domcontentloaded" });
    text = await mainText(page);
    const timelineB = await page.locator('[data-testid="round-timeline"]').innerText().catch(() => "");
    check(
      "9) หน้าคอน B: มีปุ่ม 'เข้าคิวจองตั๋ว' + บรรทัดรอบบอกว่าตอนนี้รอบสมาชิก (ไม่ใช่ 'เร็ว ๆ นี้')",
      /เข้าคิวจองตั๋ว/.test(text) && !/เริ่มขาย .* น\./.test(text) && /ตอนนี้: รอบสมาชิก/.test(timelineB),
      `${timelineB} :: ${text.slice(0, 200)}`,
    );

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
    await prisma.concert.deleteMany({ where: { id: concertB.id } });
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
