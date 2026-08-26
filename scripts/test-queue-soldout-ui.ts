// ============================================================
// Integration (real browser + real DB + real Redis) — ห้องรอต้องมี "ทางออก" เมื่อบัตรหมด
// ============================================================
// รัน: pnpm test:queue-soldout-ui   (ต้อง pnpm dev + pnpm db:up + seed user@local อยู่; ตั้ง E2E_BASE ถ้าไม่ใช่พอร์ต 3000)
//
// คู่กับ scripts/test-queue-soldout.ts (ชั้น Redis ล้วน) — ไฟล์นี้พิสูจน์ "สิ่งที่ผู้ใช้เห็น" บนหน้าห้องรอจริง:
//   1. ที่นั่งเต็มชั่วคราว (ทุกที่นั่ง HELD) → เข้าคิวได้ รอที่ตำแหน่ง 1 พร้อมบอกว่ารออะไรอยู่ (ไม่ใช่เลข 1 นิ่ง ๆ)
//   2. บัตรหมดระหว่างรอ (ที่นั่งกลายเป็น SOLD ทั้งหมด) → จอ "บัตรหมดแล้ว" + หยุด poll + ปุ่มกลับหน้าคอนเสิร์ต
//      (เดิม: ค้าง "ตำแหน่ง 1" จน token หมดอายุ 1 ชม. แล้ววนเข้าคิวใหม่ไปค้างอีก)
//   3. เข้าหน้าห้องรอทั้งที่บัตรหมด → ประตูปฏิเสธด้วย "บัตรหมดแล้ว" ไม่ใช่จอ "ตรวจพบกิจกรรมผิดปกติ"
//      (เดิม: 403 ทุกแบบขึ้นจอบอท — คนที่มาช้าจนบัตรหมดถูกกล่าวหาว่าเป็นบอท)
//
// ⚠️ ข้อ 1–2 ต้องผ่านด่าน Turnstile ของห้องรอจริง (คำขอเข้าคิวครั้งแรกไม่มี token = CHALLENGE เสมอ)
//    ถ้า dev server ใช้ Turnstile คีย์จริง เบราว์เซอร์สคริปต์ผ่านไม่ได้ (ระบบกันอยู่ — ตั้งใจไม่ bypass)
//    → สคริปต์จะ "ข้าม" ข้อ 1–2 พร้อมบอกเหตุผล แล้วเทสข้อ 3 ต่อ (ด่านบัตรหมดอยู่ก่อนด่านบอท)
//    อยากได้ครบทั้ง 3 ข้อ: รัน dev โดยไม่ตั้ง TURNSTILE_SECRET_KEY/TURNSTILE_SITE_KEY (ใช้ test key ของ Cloudflare
//    ที่ผ่านเสมอ) — ตรรกะ anti-bot/CHALLENGE ยังทำงานครบ แค่ Cloudflare ตอบผ่านให้ (ตามคู่มือทดสอบของ Cloudflare)
//    ⚠️ ทางนั้นยังไม่เคยลองจริง (เครื่องพัฒนาใช้คีย์จริง) — ถ้าลองแล้วไม่ผ่านให้ดูว่า widget test key ยิง onVerify เองไหม
//    ส่วนพฤติกรรม server ของข้อ 1–2 พิสูจน์แยกไว้แล้วใน scripts/test-queue-soldout.ts
//
// precondition ตั้งผ่าน DB ตรง (สถานะที่นั่ง) — ทางเดินผู้ใช้กดจริงทั้งหมด (login ฟอร์มจริง, เข้าคิวจากหน้าห้องรอจริง)
// ทำความสะอาด: ลบ QueueToken ของคอนเสิร์ต → ลบคอนเสิร์ตทดสอบ (cascade โซน/ที่นั่ง) → ล้าง key Redis
import { chromium } from "playwright-core";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
// บัญชีผู้ใช้ทั่วไปจาก prisma/seed.ts (fixture สำหรับ dev เท่านั้น)
const EMAIL = process.env.E2E_USER_EMAIL ?? "user@local";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "Password123!";
const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// หน้าห้องรอ poll ทุก ~2.5 วิ + รอบปล่อยคิวถี่สุดทุก 3 วิ → สถานะใหม่ถึงจอภายใน ~6 วิ; เผื่อ dev server ช้า
const UI_TIMEOUT = 20_000;

let pass = 0;
let fail = 0;
let skipped = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}  ${extra}`);
  }
}
function skip(name: string, reason: string) {
  skipped++;
  console.log(`  ⏭️  ${name}  (ข้าม: ${reason})`);
}

async function main() {
  const stamp = Date.now();
  const slug = `test-queue-soldout-${stamp}`;

  // ---------- fixture: คอนเสิร์ตเปิดขาย 1 โซน 2 ที่นั่ง (ไม่ต้องมีผังรูป — ไม่ไปถึงหน้าเลือกที่นั่ง) ----------
  const concert = await prisma.concert.create({
    data: {
      title: `[TEST] คิวบัตรหมด ${stamp}`,
      slug,
      description: "คอนเสิร์ตทดสอบของ scripts/test-queue-soldout-ui.ts — ลบอัตโนมัติเมื่อจบ",
      venue: "หอประชุมทดสอบ",
      eventAt: new Date(Date.now() + 30 * 86_400_000),
      saleStartAt: new Date(Date.now() - 86_400_000),
      saleEndAt: new Date(Date.now() + 29 * 86_400_000),
      status: "ON_SALE",
      zones: {
        create: {
          name: "โซนทดสอบ",
          price: 1000,
          color: "#ef4444",
          totalSeats: 2,
          seats: {
            create: [
              { rowLabel: "A", seatNumber: 1 },
              { rowLabel: "A", seatNumber: 2 },
            ],
          },
        },
      },
    },
    select: { id: true, zones: { select: { id: true } } },
  });
  const concertId = concert.id.toString();
  const zoneId = concert.zones[0].id;
  const qKey = `queue:${concertId}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: REAL_UA,
    viewport: { width: 1280, height: 900 },
    locale: "th-TH",
  });
  const page = await context.newPage();

  try {
    console.log(`\n🧪 ห้องรอเมื่อบัตรหมด — หน้าจอจริง (concert ${concertId})\n`);

    // ---------- login ผ่านฟอร์มจริง ----------
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page
      .waitForURL((u) => !u.pathname.includes("/login"), { timeout: UI_TIMEOUT })
      .catch(() => {});
    check("login ผู้ซื้อสำเร็จ", !page.url().includes("/login"), `url=${page.url()}`);

    // ---------- 1) เต็มชั่วคราว: ทุกที่นั่งถูก hold อยู่ → เข้าคิวได้ แต่ต้องบอกว่ารออะไร ----------
    await prisma.seat.updateMany({ where: { zoneId }, data: { status: "HELD" } });
    await page.goto(`${BASE}/concerts/${slug}/queue`, { waitUntil: "domcontentloaded" });
    const fullHint = page.getByText("ที่นั่งทั้งหมดถูกจองไว้ชั่วคราว");
    await fullHint.waitFor({ timeout: UI_TIMEOUT }).catch(() => {});
    const inQueue = (await fullHint.count()) === 1;
    const atChallenge = (await page.getByText("ยืนยันว่าคุณไม่ใช่บอท").count()) === 1;

    if (!inQueue && atChallenge) {
      // Turnstile คีย์จริงกันสคริปต์ไว้ (ถูกต้องแล้ว) — ข้าม 1–2 ตามหัวไฟล์
      skip("1. เต็มชั่วคราว → อยู่ในห้องรอ + บอกว่ารออะไร", "ติดด่าน Turnstile คีย์จริง — ดู scripts/test-queue-soldout.ts");
      skip("2. บัตรหมดระหว่างรอ → จอ 'บัตรหมดแล้ว' + หยุด poll + ปุ่มกลับ", "ติดด่าน Turnstile คีย์จริง");
    } else {
      check(
        "1. เต็มชั่วคราว → อยู่ในห้องรอ + บอกว่ากำลังรอที่นั่งที่ถูกจองไว้หลุดกลับมา",
        inQueue && (await page.getByText("คุณอยู่ในห้องรอ").count()) === 1,
        `จอที่เห็น: ${(await page.locator("h2, p.text-danger").allTextContents()).join(" | ")}`
      );
      // ยืนยัน precondition ที่ชั้นข้อมูล — ข้อความบนจอต้องมาจาก snapshot จริง ไม่ใช่บังเอิญ
      const snapRaw = await redis.get(`${qKey}:seats`);
      const snap = snapRaw ? (JSON.parse(snapRaw) as { available: number; held: number }) : null;
      check(
        "   precondition: snapshot ที่ผู้ปล่อยคิวบันทึก = ว่าง 0 / ค้างจ่าย 2",
        snap?.available === 0 && snap?.held === 2,
        `snapshot=${snapRaw}`
      );
      check("   ผู้ใช้อยู่ในคิวจริง (ZSET มี 1 คน)", (await redis.zcard(qKey)) === 1);

      // ---------- 2) บัตรหมดระหว่างรอ: คนที่ถือ hold จ่ายเงินสำเร็จ → ที่นั่งเป็น SOLD ทั้งหมด ----------
      await prisma.seat.updateMany({ where: { zoneId }, data: { status: "SOLD" } });
      const soldOutHeading = page.getByRole("heading", { name: "บัตรหมดแล้ว" });
      await soldOutHeading.waitFor({ timeout: UI_TIMEOUT }).catch(() => {});
      check("2. 🔑 บัตรหมดระหว่างรอ → จอ 'บัตรหมดแล้ว' ไม่ค้างตำแหน่ง 1", (await soldOutHeading.count()) === 1);
      check(
        "   ไม่ใช่จอบอท 'ตรวจพบกิจกรรมผิดปกติ'",
        (await page.getByText("ตรวจพบกิจกรรมผิดปกติ").count()) === 0
      );
      const backButton = page.getByRole("button", { name: "กลับหน้าคอนเสิร์ต" });
      check("   มีปุ่มกลับหน้าคอนเสิร์ต", (await backButton.count()) === 1);

      // หยุด poll จริงไหม — นับคำขอ /api/queue/status หลังขึ้นจอบัตรหมดแล้ว 6 วิ ต้องเป็น 0 (ไม่ยิงทิ้งเปล่า)
      let statusPolls = 0;
      page.on("request", (req) => {
        if (req.url().includes("/api/queue/status")) statusPolls++;
      });
      await page.waitForTimeout(6_000);
      check("   หยุด poll หลังบัตรหมด (0 คำขอใน 6 วิ)", statusPolls === 0, `polls=${statusPolls}`);
      check(
        "   ไม่ถูกเตะออกจากคิว (ZSET ยังมี 1 คน — ถ้าเปิดขายใหม่ยังไหลต่อได้)",
        (await redis.zcard(qKey)) === 1
      );

      if ((await backButton.count()) === 1) {
        await backButton.click();
        await page
          .waitForURL((u) => u.pathname === `/concerts/${slug}`, { timeout: UI_TIMEOUT })
          .catch(() => {});
      }
      check(
        "   กดปุ่มแล้วกลับหน้าคอนเสิร์ต",
        new URL(page.url()).pathname === `/concerts/${slug}`,
        `url=${page.url()}`
      );
    }

    // ---------- 3) เข้าห้องรอทั้งที่บัตรหมด (สถานะใน DB ยัง ON_SALE — ป้าย SOLD_OUT ติดเฉพาะตอนออกตั๋ว) ----------
    await prisma.seat.updateMany({ where: { zoneId }, data: { status: "SOLD" } });
    const queueSizeBefore = await redis.zcard(qKey);
    await page.goto(`${BASE}/concerts/${slug}/queue`, { waitUntil: "domcontentloaded" });
    const gateHeading = page.getByRole("heading", { name: "บัตรหมดแล้ว" });
    await gateHeading.waitFor({ timeout: UI_TIMEOUT }).catch(() => {});
    check(
      "3. 🔑 ประตูเข้าคิวปฏิเสธด้วย 'บัตรหมดแล้ว' (ไม่ใช่จอบอท / ไม่ใช่รอรอบถัดไป)",
      (await gateHeading.count()) === 1 &&
        (await page.getByText("ตรวจพบกิจกรรมผิดปกติ").count()) === 0 &&
        (await page.getByText("ยืนยันว่าคุณไม่ใช่บอท").count()) === 0,
      `จอที่เห็น: ${(await page.locator("h2, p.text-danger").allTextContents()).join(" | ")}`
    );
    const gateBack = page.getByRole("button", { name: "กลับหน้าคอนเสิร์ต" });
    check("   มีปุ่มกลับหน้าคอนเสิร์ต", (await gateBack.count()) === 1);
    check("   ไม่สร้างคิวเพิ่ม (ZSET เท่าเดิม)", (await redis.zcard(qKey)) === queueSizeBefore);
    if ((await gateBack.count()) === 1) {
      await gateBack.click();
      await page
        .waitForURL((u) => u.pathname === `/concerts/${slug}`, { timeout: UI_TIMEOUT })
        .catch(() => {});
    }
    check(
      "   กดปุ่มแล้วกลับหน้าคอนเสิร์ต",
      new URL(page.url()).pathname === `/concerts/${slug}`,
      `url=${page.url()}`
    );
  } finally {
    await browser.close();

    // ---------- cleanup ----------
    try {
      const tokens = await redis.zrange(qKey, 0, -1);
      const admitted = await redis.zrange(`${qKey}:admitted`, 0, -1);
      const tokenKeys = [...tokens, ...admitted].map((t) => `queue:token:${t}`);
      const concertKeys = await redis.keys(`${qKey}*`);
      const toDelete = [...tokenKeys, ...concertKeys];
      if (toDelete.length > 0) await redis.del(...toDelete);
      await prisma.queueToken.deleteMany({ where: { concertId: concert.id } });
      await prisma.concert.delete({ where: { id: concert.id } }); // cascade -> zones -> seats
      console.log("\n🧹 cleanup เสร็จ (ลบคอนเสิร์ตทดสอบ + QueueToken + key Redis)");
    } catch (e) {
      console.error("⚠️ cleanup error:", (e as Error).message.split("\n")[0]);
    }
    console.log(
      `\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed` +
        (skipped > 0 ? `, ${skipped} skipped (Turnstile คีย์จริง)` : "") +
        "\n"
    );
    await prisma.$disconnect();
    await redis.quit();
  }
  process.exit(fail === 0 ? 0 : 1);
}

void main();
