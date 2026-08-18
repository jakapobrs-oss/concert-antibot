// ============================================================
// Integration (real browser + real DB + real Redis) — สมาชิก + รอบกดบัตร (Phase 2)
// ============================================================
// รัน: npx tsx scripts/test-sale-round.ts   (ต้อง pnpm dev + pnpm db:up อยู่)
//
// ทำไมต้องมีไฟล์นี้ทั้งที่มี unit test แล้ว:
//   tests/unit/sale-round.test.ts + membership.test.ts พิสูจน์ "กติกา" (pure function ล้วน)
//   แต่ไม่ได้พิสูจน์ว่า หน้าแอดมิน -> server action -> DB -> ด่านจริงตอนกดบัตร ต่อกันติด
//   จุดที่ mock ไม่มีวันจับได้และพังเงียบที่สุดคือ **โซนเวลา**:
//     <input type="datetime-local"> ส่งเวลาไม่มีโซนมา ถ้าเซิร์ฟเวอร์ตีความเป็น UTC
//     รอบที่ตั้งว่า 19:00 จะไปเปิดตอนตี 12 — เทสนี้จับได้เพราะเทียบเวลาที่ลง DB จริง
//
// เรื่องที่พิสูจน์ (เรียงตามเรื่องที่จะสาธิตให้อาจารย์ดู):
//   1. แอดมินตั้งรอบผ่านหน้าเว็บได้จริง และเวลาที่ลง DB ตรงกับที่ตั้งใจ (ไม่เพี้ยนโซนเวลา)
//   2. คนที่ไม่ใช่สมาชิก กดบัตรตอนรอบสมาชิกไม่ได้ + ระบบบอกว่ารอบทั่วไปเปิดกี่โมง
//   3. หน้าเลือกที่นั่งก็กันด้วย ไม่ใช่กันแค่ API (ยิงตรงข้ามหน้าเว็บไม่ได้)
//   4. แอดมินกดให้สิทธิ์ -> คนเดิมกดได้ทันที (ไม่ต้องรอ cron/รีสตาร์ท)
//   5. แอดมินเพิกถอน -> กดไม่ได้ทันที
//   6. ลบรอบที่มีคำสั่งซื้อผูกอยู่ไม่ได้ (กันสถิติยอดขายรายรอบหาย)
//   7. คอนเสิร์ตที่ไม่ได้ตั้งรอบ = พฤติกรรมเดิม (ฟีเจอร์นี้ไม่ทำให้ของเก่าพัง)
//
// ⚠️ ตั้งใจ "ไม่" เดินผ่านห้องรอในเบราว์เซอร์ เพราะหน้านั้นมี Turnstile ของจริง
//    การไปแก้ CAPTCHA ด้วยสคริปต์คือสิ่งที่ทั้งระบบนี้สร้างมาเพื่อกัน
//    -> ยิง /api/queue/join ตรง ๆ ด้วย cookie ของ session จริง (ด่านรอบอยู่ก่อน anti-bot ในไฟล์ route)
//
// ทำความสะอาด: ลบคอนเสิร์ตทดสอบ + order ที่สร้าง + คืนสถานะสมาชิกของ user@local กลับเหมือนเดิม
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { leaveQueue } from "../lib/queue";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
// บัญชี fixture จาก prisma/seed.ts (สำหรับ dev เท่านั้น ไม่ใช่บัญชีจริง)
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin123!";
const USER_EMAIL = process.env.E2E_USER_EMAIL ?? "user@local";
const USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? "Password123!";
// UA จริง (ไม่มีคำว่า headless) — กัน anti-bot ให้คะแนน UA เป็นบอท
const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEMO_ROUND_MINUTES = 30; // ต้องตรงกับค่าในปุ่ม "เติมเวลาสาธิต" ของ components/sale-round-editor.tsx
const MINUTE = 60_000;

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

/** รอจนเงื่อนไขเป็นจริง (ใช้รอ server action เขียน DB เสร็จหลังคลิก) */
async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 15_000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date -> ค่าที่ <input type="datetime-local"> รับ (เวลาท้องถิ่นของเครื่องที่รันเทส) */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function login(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
  return !page.url().includes("/login");
}

/** ยิงเข้าคิวด้วย session ของ context นั้น — คืนสถานะ + body */
async function tryJoinQueue(
  page: Page,
  concertId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await page.request.post(`${BASE}/api/queue/join`, { data: { concertId } });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status(), body };
}

/**
 * ด่านรอบปล่อยผ่านไหม
 *
 * ⚠️ ไม่เช็ค `status === 200` เพราะถ้าผ่านด่านรอบแล้วจะไปเจอ anti-bot ต่อ
 *    ซึ่งอาจตอบ 428 (ขอทำ Turnstile) ได้ตามสภาพ key ที่ตั้งไว้ในเครื่องนั้น
 *    เทสนี้พิสูจน์ "ด่านรอบ" อย่างเดียว จึงดูแค่ว่าไม่ได้ถูกปฏิเสธด้วยเหตุผลเรื่องรอบ
 */
function passedRoundGate(r: { status: number; body: Record<string, unknown> }): boolean {
  return r.body.action !== "ROUND_CLOSED";
}

async function main() {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: process.env.E2E_HEADED !== "1",
  });

  const stamp = Date.now();
  const slug = `test-round-${stamp}`;

  // ---------- เตรียมคอนเสิร์ตทดสอบ ----------
  const concert = await prisma.concert.create({
    data: {
      title: `ทดสอบรอบกดบัตร ${stamp}`,
      slug,
      venue: "ห้องทดสอบ",
      description: "คอนเสิร์ตสำหรับเทสอัตโนมัติ",
      eventAt: new Date(Date.now() + 30 * 24 * 60 * MINUTE),
      saleStartAt: new Date(Date.now() - 60 * MINUTE),
      saleEndAt: new Date(Date.now() + 24 * 60 * MINUTE),
      status: "ON_SALE",
      maxTicketsPerUser: 4,
    },
  });
  const concertId = concert.id.toString();

  const buyer = await prisma.user.findUniqueOrThrow({
    where: { email: USER_EMAIL },
    select: { id: true },
  });

  // จำสถานะสมาชิกเดิมของ user@local ไว้คืนตอนจบ (เทสต้องไม่ทิ้งร่องรอย)
  const membershipBefore = await prisma.membership.findUnique({ where: { userId: buyer.id } });

  let adminCtx: BrowserContext | null = null;
  let buyerCtx: BrowserContext | null = null;
  let createdOrderId: bigint | null = null;
  let queueToken: string | null = null;

  try {
    console.log(`\n🧪 สมาชิก + รอบกดบัตร (concert ${concertId})\n`);

    adminCtx = await browser.newContext({ userAgent: REAL_UA });
    buyerCtx = await browser.newContext({ userAgent: REAL_UA });
    const adminPage = await adminCtx.newPage();
    const buyerPage = await buyerCtx.newPage();

    // ---------- 1) แอดมินตั้งรอบผ่านหน้าเว็บ ----------
    check("login แอดมินสำเร็จ", await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD));

    await adminPage.goto(`${BASE}/admin/concerts/${concertId}/rounds`, {
      waitUntil: "domcontentloaded",
    });
    check("เข้าหน้าตั้งรอบได้", adminPage.url().includes("/rounds"), adminPage.url());

    // รอบที่ 1 — รอบสมาชิก เริ่มเดี๋ยวนี้ (ใช้ปุ่มลัดที่ทำไว้ให้ตอนสาธิต)
    const beforeCreate = Date.now();
    await adminPage.click('button:has-text("เพิ่มรอบ")');
    await adminPage.fill('input[type="text"]', "รอบสมาชิก");
    await adminPage.selectOption("select", "MEMBER_ONLY");
    await adminPage.click('button:has-text("เติมเวลาสาธิต")');
    await adminPage.click('button:has-text("เพิ่มรอบ")');

    const memberRound = await waitFor(() =>
      prisma.saleRound.findFirst({ where: { concertId: concert.id, audience: "MEMBER_ONLY" } })
    );
    check("สร้างรอบสมาชิกผ่านหน้าแอดมินได้", memberRound !== null);
    if (!memberRound) throw new Error("ไม่มีรอบสมาชิก — เทสต่อไม่ได้");

    // 🔑 ด่านจับ bug โซนเวลา: ปุ่ม "เติมเวลาสาธิต" ตั้ง เริ่ม=เดี๋ยวนี้ จบ=+30 นาที
    //    ถ้าแปลงเวลาผิดโซน ค่าใน DB จะเพี้ยนไปเป็นชั่วโมง เทียบแบบนี้จะไม่ผ่านทันที
    const startSkewMin = Math.abs(memberRound.startAt.getTime() - beforeCreate) / MINUTE;
    const lengthMin = (memberRound.endAt.getTime() - memberRound.startAt.getTime()) / MINUTE;
    check(
      "เวลาเปิดรอบที่ลง DB ตรงกับที่ตั้งใจ (ไม่เพี้ยนโซนเวลา)",
      startSkewMin < 3,
      `ห่างจากตอนกด ${startSkewMin.toFixed(1)} นาที`
    );
    check(
      `ความยาวรอบเท่ากับ ${DEMO_ROUND_MINUTES} นาที`,
      Math.abs(lengthMin - DEMO_ROUND_MINUTES) < 2,
      `ได้ ${lengthMin.toFixed(1)} นาที`
    );

    // รอบที่ 2 — รอบทั่วไป ต่อท้ายรอบสมาชิกพอดี (กรอกเวลาเองเพื่อทดสอบ input โดยตรง)
    const publicStart = new Date(memberRound.endAt);
    const publicEnd = new Date(memberRound.endAt.getTime() + 180 * MINUTE);
    await adminPage.click('button:has-text("เพิ่มรอบ")');
    await adminPage.fill('input[type="text"]', "รอบทั่วไป");
    await adminPage.selectOption("select", "PUBLIC");
    await adminPage.locator('input[type="datetime-local"]').nth(0).fill(toLocalInput(publicStart));
    await adminPage.locator('input[type="datetime-local"]').nth(1).fill(toLocalInput(publicEnd));
    await adminPage.click('button:has-text("เพิ่มรอบ")');

    const publicRound = await waitFor(() =>
      prisma.saleRound.findFirst({ where: { concertId: concert.id, audience: "PUBLIC" } })
    );
    check("สร้างรอบทั่วไปต่อท้ายได้", publicRound !== null);
    if (!publicRound) throw new Error("ไม่มีรอบทั่วไป — เทสต่อไม่ได้");
    check(
      "รอบทั่วไปเริ่มตอนรอบสมาชิกจบพอดี (ไม่มีช่องว่าง/ไม่ทับกัน)",
      Math.abs(publicRound.startAt.getTime() - memberRound.endAt.getTime()) < MINUTE,
      `member.end=${memberRound.endAt.toISOString()} public.start=${publicRound.startAt.toISOString()}`
    );

    // ---------- 2) คนที่ยังไม่ใช่สมาชิก กดตอนรอบสมาชิกไม่ได้ ----------
    check("login ผู้ซื้อสำเร็จ", await login(buyerPage, USER_EMAIL, USER_PASSWORD));

    const denied = await tryJoinQueue(buyerPage, concertId);
    check("คนทั่วไปถูกปฏิเสธตอนรอบสมาชิก", denied.status === 403, `status=${denied.status}`);
    check("เหตุผลคือ MEMBER_ONLY", denied.body.reason === "MEMBER_ONLY", String(denied.body.reason));
    check(
      "บอกเวลารอบถัดไปที่เข้าได้ = รอบทั่วไป",
      typeof denied.body.nextOpenAt === "string" &&
        new Date(denied.body.nextOpenAt as string).getTime() === publicRound.startAt.getTime(),
      String(denied.body.nextOpenAt)
    );
    check(
      "ข้อความบอกผู้ใช้อ่านรู้เรื่อง (มีคำว่าสมาชิก)",
      typeof denied.body.error === "string" && (denied.body.error as string).includes("สมาชิก"),
      String(denied.body.error)
    );

    // ---------- 3) หน้าเลือกที่นั่งก็ต้องกันด้วย ไม่ใช่กันแค่ API ----------
    await buyerPage.goto(`${BASE}/concerts/${slug}/seats?qt=not-a-real-token`, {
      waitUntil: "domcontentloaded",
    });
    const seatsBody = (await buyerPage.locator("main").innerText()).trim();
    check(
      "หน้าเลือกที่นั่งกันคนที่ยังไม่ถึงรอบ",
      seatsBody.includes("ยังไม่ถึงรอบของคุณ"),
      seatsBody.slice(0, 80)
    );

    // ---------- 4) แอดมินให้สิทธิ์ -> กดได้ทันที ----------
    await adminPage.goto(`${BASE}/admin/members`, { waitUntil: "domcontentloaded" });
    const buyerRow = adminPage.locator("li").filter({ hasText: USER_EMAIL }).first();
    await buyerRow.getByRole("button", { name: "ให้สิทธิ์" }).click();

    const granted = await waitFor(async () => {
      const m = await prisma.membership.findUnique({ where: { userId: buyer.id } });
      return m && m.status === "ACTIVE" ? m : null;
    });
    check("แอดมินให้สิทธิ์สมาชิกผ่านหน้าเว็บได้", granted !== null);
    check(
      "สิทธิ์ที่ให้มีวันหมดอายุในอนาคต",
      granted?.expiresAt != null && granted.expiresAt.getTime() > Date.now(),
      String(granted?.expiresAt)
    );

    const allowed = await tryJoinQueue(buyerPage, concertId);
    check(
      "พอเป็นสมาชิกแล้วผ่านด่านรอบทันที (ไม่ต้องรอ cron/รีสตาร์ท)",
      passedRoundGate(allowed),
      `status=${allowed.status} body=${JSON.stringify(allowed.body)}`
    );
    if (typeof allowed.body.token === "string") queueToken = allowed.body.token;

    // ---------- 5) เพิกถอนแล้วต้องกดไม่ได้ทันที ----------
    await adminPage.reload({ waitUntil: "domcontentloaded" });
    const memberRow = adminPage.locator("li").filter({ hasText: USER_EMAIL }).first();
    await memberRow.getByRole("button", { name: "เพิกถอนสิทธิ์" }).click();

    const revoked = await waitFor(async () => {
      const m = await prisma.membership.findUnique({ where: { userId: buyer.id } });
      return m && m.status === "REVOKED" ? m : null;
    });
    check("แอดมินเพิกถอนสิทธิ์ได้", revoked !== null);
    check("เพิกถอนแล้วแถวยังอยู่ (ไม่ลบประวัติทิ้ง)", revoked?.revokedAt != null);

    const deniedAgain = await tryJoinQueue(buyerPage, concertId);
    check(
      "ถูกเพิกถอนแล้วกดไม่ได้ทันที",
      deniedAgain.status === 403 && deniedAgain.body.reason === "MEMBER_ONLY",
      `status=${deniedAgain.status} reason=${String(deniedAgain.body.reason)}`
    );

    // ---------- 6) ลบรอบที่มีคำสั่งซื้อผูกอยู่ไม่ได้ ----------
    const order = await prisma.order.create({
      data: {
        userId: buyer.id,
        concertId: concert.id,
        saleRoundId: memberRound.id,
        totalAmount: "1.00",
        expiresAt: new Date(Date.now() + 10 * MINUTE),
      },
    });
    createdOrderId = order.id;

    await adminPage.goto(`${BASE}/admin/concerts/${concertId}/rounds`, {
      waitUntil: "domcontentloaded",
    });
    const memberRoundCard = adminPage.locator(`[data-round-id="${memberRound.id}"]`);
    await memberRoundCard.getByRole("button", { name: "ลบ" }).click();
    await adminPage.waitForTimeout(1200);

    const stillThere = await prisma.saleRound.findUnique({ where: { id: memberRound.id } });
    check("ลบรอบที่มีคำสั่งซื้อไม่ได้ (รอบยังอยู่)", stillThere !== null);
    const alertText = await adminPage
      .locator('[role="alert"]')
      .first()
      .innerText()
      .catch(() => "");
    check(
      "แจ้งเหตุผลที่ลบไม่ได้ให้แอดมินเห็น",
      alertText.includes("ลบไม่ได้"),
      `alert=${JSON.stringify(alertText)}`
    );

    // ---------- 7) คอนเสิร์ตที่ไม่มีรอบ = พฤติกรรมเดิม ----------
    await prisma.order.delete({ where: { id: order.id } });
    createdOrderId = null;
    await prisma.saleRound.deleteMany({ where: { concertId: concert.id } });

    const noRounds = await tryJoinQueue(buyerPage, concertId);
    check(
      "คอนเสิร์ตที่ไม่ได้ตั้งรอบ ใครก็กดได้เหมือนเดิม",
      passedRoundGate(noRounds),
      `status=${noRounds.status} body=${JSON.stringify(noRounds.body)}`
    );
    if (typeof noRounds.body.token === "string") queueToken = noRounds.body.token;
  } finally {
    // ---------- cleanup ----------
    try {
      await adminCtx?.close();
      await buyerCtx?.close();
      await browser.close();

      if (queueToken) await leaveQueue(queueToken);
      await redis.del(`queue:${concertId}:user:${buyer.id}`);
      await redis.del(`queue:${concertId}`, `queue:${concertId}:admitted`);
      await redis.del(`ratelimit:queue_join:user:${buyer.id}`);

      if (createdOrderId) await prisma.order.delete({ where: { id: createdOrderId } }).catch(() => {});
      await prisma.order.deleteMany({ where: { concertId: concert.id } });
      await prisma.saleRound.deleteMany({ where: { concertId: concert.id } });
      await prisma.concert.delete({ where: { id: concert.id } });

      // คืนสถานะสมาชิกเดิมของบัญชี fixture
      if (membershipBefore) {
        await prisma.membership.upsert({
          where: { userId: buyer.id },
          create: membershipBefore,
          update: {
            status: membershipBefore.status,
            source: membershipBefore.source,
            expiresAt: membershipBefore.expiresAt,
            revokedAt: membershipBefore.revokedAt,
            grantedByUserId: membershipBefore.grantedByUserId,
          },
        });
      } else {
        await prisma.membership.deleteMany({ where: { userId: buyer.id } });
      }
      console.log("\n🧹 cleanup เสร็จ (ลบคอนเสิร์ตทดสอบ + คืนสถานะสมาชิกเดิม)");
    } catch (e) {
      console.error("⚠️ cleanup error:", (e as Error).message.split("\n")[0]);
    }

    await prisma.$disconnect();
    await redis.quit();
  }

  console.log(`\n📊 ผ่าน ${pass} / ล้มเหลว ${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("💥", e);
  await prisma.$disconnect().catch(() => {});
  await redis.quit().catch(() => {});
  process.exit(1);
});
