// ============================================================
// E2E (real browser) — booking flow ครบวงจรผ่าน Playwright (playwright-core)
// ============================================================
// รัน: npx tsx scripts/e2e-booking.ts   (ต้อง pnpm dev + pnpm db:up อยู่)
// flow: login → ห้องรอ/Turnstile(dev auto-pass) → เลือกที่นั่ง → checkout → แนบสลิป → ได้ตั๋ว
// dev mode: ไม่มี EASYSLIP_API_KEY → verifySlip mock ผ่าน (ยังบังคับแนบสลิป)
// ทำความสะอาด: ลบ order/ticket/payment + คืนที่นั่ง + เคลียร์ Redis key หลังจบ
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const SLUG = "bts-bangkok-2026";
const EMAIL = "user@local";
const PASSWORD = "Password123!";
// UA จริง (ไม่มีคำว่า headless) — กัน anti-bot ให้คะแนน UA เป็นบอท
const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// รูปสลิป 1x1 png (dev mock ไม่สน content แค่ต้องเป็นรูป)
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

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
  // เขียนไฟล์สลิปชั่วคราว
  const slipPath = join(tmpdir(), `e2e-slip-${Date.now()}.png`);
  writeFileSync(slipPath, PNG_1x1);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: REAL_UA,
    viewport: { width: 1280, height: 900 },
    locale: "th-TH",
  });
  const page = await context.newPage();
  let orderId: string | null = null;

  try {
    console.log("\n🧪 E2E booking flow (real browser)\n");

    // ---------- 1) Login ----------
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
    check("login สำเร็จ (ออกจากหน้า /login)", !page.url().includes("/login"), page.url());
    await page.screenshot({ path: ".shots/e2e-1-after-login.png" });

    // ---------- 2) ห้องรอ → Turnstile dev auto-pass → admit → seats ----------
    await page.goto(`${BASE}/concerts/${SLUG}/queue`, { waitUntil: "domcontentloaded" });
    // รอจนระบบพาเข้าหน้าเลือกที่นั่งเอง (?qt=token) — เผื่อเวลา Turnstile + poll
    await page.waitForURL(/\/seats\?qt=/, { timeout: 45_000 });
    check("ผ่านคิว + ถูก admit → เข้าหน้าเลือกที่นั่ง", page.url().includes("/seats?qt="));
    await page.screenshot({ path: ".shots/e2e-2-seats.png" });

    // ---------- 3) เลือกที่นั่ง 2 ที่ (ปุ่มที่นั่ง = button[title] ที่ไม่ disabled) ----------
    const seatBtns = page.locator("main button[title]:not([disabled])");
    await seatBtns.first().waitFor({ timeout: 10_000 });
    const available = await seatBtns.count();
    check("มีที่นั่งว่างให้เลือก", available >= 2, `available=${available}`);
    await seatBtns.nth(0).click();
    await seatBtns.nth(1).click();

    // กด "ดำเนินการชำระเงิน →"
    await page.getByRole("button", { name: /ดำเนินการชำระเงิน/ }).click();
    await page.waitForURL(/\/checkout\//, { timeout: 20_000 });
    orderId = page.url().split("/checkout/")[1]?.split(/[/?#]/)[0] ?? null;
    check("hold ที่นั่ง + สร้าง order → เข้าหน้า checkout", !!orderId, `orderId=${orderId}`);
    await page.screenshot({ path: ".shots/e2e-3-checkout.png" });

    // ---------- 4) แนบสลิป → ยืนยันการชำระเงิน ----------
    await page.setInputFiles('input[type="file"]', slipPath);
    // รอจน FileReader อ่านไฟล์เสร็จ (ขึ้นข้อความ "แนบแล้ว") ก่อนเช็คปุ่ม
    await page.getByText(/แนบแล้ว/).waitFor({ timeout: 8_000 });
    const confirmBtn = page.getByRole("button", { name: /ยืนยันการชำระเงิน/ });
    check("แนบสลิปแล้วปุ่มยืนยันใช้งานได้ (F7: รูปผ่าน validation)", await confirmBtn.isEnabled());
    await confirmBtn.click();

    // ---------- 5) ออกตั๋วสำเร็จ → ไปหน้าตั๋ว ----------
    await page.waitForURL(/\/account\/tickets/, { timeout: 20_000 });
    check("ชำระเงิน (mock) สำเร็จ → ไปหน้าตั๋ว", page.url().includes("/account/tickets"));
    await page.screenshot({ path: ".shots/e2e-4-tickets.png" });

    // ---------- 6) ยืนยันใน DB ว่าออกตั๋วจริง ----------
    if (orderId) {
      const order = await prisma.order.findUnique({
        where: { id: BigInt(orderId) },
        include: { tickets: true, payment: true },
      });
      check("DB: order → PAID", order?.status === "PAID", order?.status ?? "null");
      check("DB: ออกตั๋ว 2 ใบ", order?.tickets.length === 2, `tickets=${order?.tickets.length}`);
      check("DB: payment → SUCCESS", order?.payment?.status === "SUCCESS", order?.payment?.status ?? "null");
    }
  } catch (e) {
    fail++;
    console.error("\n💥 e2e error:", (e as Error).message.split("\n")[0]);
    await page.screenshot({ path: ".shots/e2e-ERROR.png" }).catch(() => {});
  } finally {
    await browser.close();

    // ---------- cleanup: ลบ order/ticket/payment ของรอบนี้ + คืนที่นั่ง + เคลียร์ Redis ----------
    try {
      if (orderId) {
        const oid = BigInt(orderId);
        const items = await prisma.orderItem.findMany({ where: { orderId: oid }, select: { seatId: true } });
        const seatIds = items.map((i) => i.seatId);
        await prisma.ticket.deleteMany({ where: { orderId: oid } });
        await prisma.payment.deleteMany({ where: { orderId: oid } });
        await prisma.orderItem.deleteMany({ where: { orderId: oid } });
        await prisma.order.delete({ where: { id: oid } });
        if (seatIds.length) {
          await prisma.seat.updateMany({ where: { id: { in: seatIds } }, data: { status: "AVAILABLE" } });
          // คืน Redis lock ของที่นั่ง (ถ้ายังค้าง)
          await redis.del(...seatIds.map((s) => `seat:lock:${s}`));
        }
      }
      // เคลียร์ queue slot ของ user@local ในคอนเสิร์ตนี้ (กัน dedup รอบหน้า)
      const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
      const c = await prisma.concert.findUnique({ where: { slug: SLUG }, select: { id: true } });
      if (u && c) await redis.del(`queue:${c.id}:user:${u.id}`);
      console.log("\n🧹 cleanup เสร็จ (ลบ order/ticket + คืนที่นั่ง)");
    } catch (e) {
      console.error("⚠️ cleanup error:", (e as Error).message.split("\n")[0]);
    }

    await prisma.$disconnect();
    await redis.quit();
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`ผล: ${pass} ผ่าน / ${fail} ไม่ผ่าน`);
  console.log("=".repeat(40));
  if (fail > 0) process.exitCode = 1;
}

main();
