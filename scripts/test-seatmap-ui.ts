// ============================================================
// Integration (real browser + real DB + real Redis) — ผังที่นั่งจากรูป (Phase 2 / D3)
// ============================================================
// รัน: npx tsx scripts/test-seatmap-ui.ts   (ต้อง pnpm dev + pnpm db:up อยู่)
//
// ทำไมต้องมีไฟล์นี้ทั้งที่มี unit test แล้ว:
//   tests/unit/seatmap-generate.test.ts พิสูจน์ "อัลกอริทึม" (pure function, mock ล้วน)
//   แต่ไม่ได้พิสูจน์ว่า หน้าแอดมิน -> server action -> DB -> Redis ต่อกันติดจริง
//   โดยเฉพาะ "ด่านกันเจนทับ" ที่ต้องอ่าน hold จาก Redis ซึ่ง mock ไม่ได้ให้ความมั่นใจ
//
// flow: สร้างคอนเสิร์ตทดสอบ -> login แอดมิน -> อัปโหลดรูปผัง -> คลิกวาดกรอบ 4 จุด
//       -> เจนที่นั่ง -> ตรวจ DB -> ลองเจนทับตอนมีที่นั่ง SOLD (ต้องถูกปฏิเสธ)
//       -> ลองเจนทับตอนมี hold ค้างใน Redis (ต้องถูกปฏิเสธ)
//       -> เคลียร์ทั้งสองแล้วเจนทับใหม่ (ต้องผ่าน)
// ทำความสะอาด: ลบคอนเสิร์ตทดสอบ (cascade โซน/ที่นั่ง) + ลบ key Redis ที่สร้างเอง
import { chromium, type Page } from "playwright-core";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
// บัญชีแอดมินจาก prisma/seed.ts (fixture สำหรับ dev เท่านั้น ไม่ใช่บัญชีจริง)
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@local";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin123!";
// UA จริง (ไม่มีคำว่า headless) — กัน anti-bot ให้คะแนน UA เป็นบอท
const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const IMAGE_W = 800;
const IMAGE_H = 600;
const SEAT_COUNT_FIRST = 48;
const SEAT_COUNT_SECOND = 30;

// กรอบที่จะคลิก (สัดส่วนของรูป) — สี่เหลี่ยมกลางภาพ เลือกเป็นสี่เหลี่ยมตรง ๆ
// เพื่อให้ "ตรวจว่าที่นั่งอยู่ในกรอบ" ทำได้ด้วยการเทียบขอบ ไม่ต้องเรียก point-in-polygon ของระบบเอง
const FRAME = { left: 0.15, right: 0.85, top: 0.2, bottom: 0.8 };

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

// ---------- สร้างไฟล์ PNG ผังสถานที่จำลอง (ไม่พึ่ง lib ภายนอก) ----------
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** ผังจำลอง: พื้นเข้ม + แถบเวทีด้านบน + พื้นที่นั่งสีอ่อนตรงกลาง (ให้ภาพดูเหมือนผังจริงพอควร) */
function makeVenuePng(width: number, height: number): Buffer {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let pos = 0;
  for (let y = 0; y < height; y++) {
    raw[pos++] = 0; // filter type 0 (None) ต่อ scanline
    for (let x = 0; x < width; x++) {
      const fx = x / width;
      const fy = y / height;
      let r = 18, g = 20, b = 28; // พื้นหลังโรงมหรสพ
      if (fy < 0.12 && fx > 0.2 && fx < 0.8) {
        r = 190; g = 60; b = 70; // เวที
      } else if (fx > FRAME.left && fx < FRAME.right && fy > FRAME.top && fy < FRAME.bottom) {
        r = 52; g = 58; b = 78; // พื้นที่ที่นั่ง
      }
      raw[pos++] = r;
      raw[pos++] = g;
      raw[pos++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- helper ฝั่งหน้าเว็บ ----------
async function readFeedback(page: Page): Promise<string> {
  const box = page.locator('[role="status"]');
  await box.waitFor({ timeout: 30_000 });
  return (await box.innerText()).trim();
}

/**
 * อัปโหลดรูปผังผ่าน "ปุ่มจริง" ไม่ใช่ยัดไฟล์ใส่ input ตรง ๆ
 *
 * เหตุผล: input ตัวจริงถูกซ่อนไว้ (className="hidden") แล้วปุ่มเป็นคนสั่ง fileRef.current.click()
 *   ถ้ายัดไฟล์ใส่ input ก่อน React hydrate เสร็จ onChange จะยังไม่ผูก -> ไม่มีอะไรเกิดขึ้นแบบเงียบ ๆ
 *   (เจอจริงตอนเขียนเทสนี้ รอ feedback จนหมดเวลาโดยไม่มี error)
 *   การรอ filechooser จากการกดปุ่ม = พิสูจน์ว่า hydrate แล้วจริง + เดินทางเดียวกับผู้ใช้
 */
async function uploadLayout(page: Page, filePath: string) {
  const button = page.locator('button:has-text("อัปโหลดรูปผัง")');
  await button.waitFor({ timeout: 15_000 });
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 5_000 }),
        button.click(),
      ]);
      await chooser.setFiles(filePath);
      return;
    } catch {
      if (attempt === 5) throw new Error("กดปุ่มอัปโหลดแล้วไม่เปิด file chooser (หน้าอาจยังไม่ hydrate)");
    }
  }
}

/** คลิกวาดกรอบสี่เหลี่ยมทับรูป — แปลงสัดส่วน 0-1 เป็นพิกเซลบน element จริง */
async function drawFrame(page: Page) {
  const svg = page.locator('svg[role="presentation"]');
  await svg.waitFor({ timeout: 15_000 });
  const box = await svg.boundingBox();
  if (!box) throw new Error("หา svg ที่วาดกรอบไม่เจอ");
  const corners: Array<[number, number]> = [
    [FRAME.left, FRAME.top],
    [FRAME.right, FRAME.top],
    [FRAME.right, FRAME.bottom],
    [FRAME.left, FRAME.bottom],
  ];
  for (const [fx, fy] of corners) {
    await svg.click({ position: { x: box.width * fx, y: box.height * fy } });
  }
}

async function fillZoneForm(page: Page, name: string, price: string, seats: string) {
  await page.fill("#zone-name", name);
  await page.fill("#zone-price", price);
  await page.fill("#zone-seats", seats);
}

async function main() {
  const pngPath = join(tmpdir(), `seatmap-layout-${process.pid}.png`);
  writeFileSync(pngPath, makeVenuePng(IMAGE_W, IMAGE_H));
  try {
    mkdirSync(".shots", { recursive: true });
  } catch {
    /* มีอยู่แล้ว */
  }

  // ---------- fixture: คอนเสิร์ตทดสอบของตัวเอง (ไม่แตะข้อมูลเดโมที่มีอยู่) ----------
  const stamp = Date.now();
  const concert = await prisma.concert.create({
    data: {
      title: `[TEST] ผังที่นั่ง ${stamp}`,
      slug: `test-seatmap-${stamp}`,
      description: "คอนเสิร์ตทดสอบของ scripts/test-seatmap-ui.ts — ลบอัตโนมัติเมื่อจบ",
      venue: "หอประชุมทดสอบ",
      eventAt: new Date(Date.now() + 30 * 86_400_000),
      saleStartAt: new Date(Date.now() - 86_400_000),
      saleEndAt: new Date(Date.now() + 29 * 86_400_000),
    },
    select: { id: true },
  });
  const concertId = concert.id.toString();
  const createdRedisKeys: string[] = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: REAL_UA,
    viewport: { width: 1440, height: 1000 },
    locale: "th-TH",
  });
  const page = await context.newPage();

  try {
    console.log(`\n🧪 ผังที่นั่งจากรูป — หน้าแอดมิน (concert ${concertId})\n`);

    // ---------- 1) login แอดมิน ----------
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
    check("login แอดมินสำเร็จ", !page.url().includes("/login"), page.url());

    // ---------- 2) เข้าหน้าผังที่นั่ง ----------
    await page.goto(`${BASE}/admin/concerts/${concertId}/seatmap`, {
      waitUntil: "domcontentloaded",
    });
    check(
      "เข้าหน้าผังที่นั่งได้ (ไม่ถูกเด้งออก)",
      page.url().includes("/seatmap"),
      page.url()
    );

    // ---------- 3) อัปโหลดรูปผัง ----------
    await uploadLayout(page, pngPath);
    const uploadMsg = await readFeedback(page);
    check("อัปโหลดรูปผังสำเร็จ", uploadMsg.includes("บันทึกรูปผังแล้ว"), uploadMsg);

    const saved = await prisma.concert.findUniqueOrThrow({
      where: { id: concert.id },
      select: { layoutImageBase64: true, layoutImageWidth: true, layoutImageHeight: true },
    });
    check(
      "รูปถูกเก็บลง DB เป็น base64 พร้อมขนาดจริง",
      !!saved.layoutImageBase64?.startsWith("data:image/") &&
        saved.layoutImageWidth === IMAGE_W &&
        saved.layoutImageHeight === IMAGE_H,
      `w=${saved.layoutImageWidth} h=${saved.layoutImageHeight}`
    );

    await page.locator('img[alt="ผังสถานที่จัดงาน"]').waitFor({ timeout: 15_000 });
    await page.screenshot({ path: ".shots/seatmap-1-uploaded.png" });

    // ---------- 4) คลิกวาดกรอบ 4 จุด ----------
    await drawFrame(page);
    check(
      "คลิกวาดกรอบแล้วนับจุดได้ 4 จุด",
      (await page.locator("main").innerText()).includes("(4 จุด)")
    );

    // ---------- 5) เจนที่นั่ง ----------
    await fillZoneForm(page, "VIP ทดสอบ", "2500", String(SEAT_COUNT_FIRST));
    await page.click(`button:has-text("สร้างโซน + เจนที่นั่ง")`);
    const createMsg = await readFeedback(page);
    check(
      `เจนที่นั่งสำเร็จ ${SEAT_COUNT_FIRST} ที่`,
      createMsg.includes(`เจนที่นั่ง ${SEAT_COUNT_FIRST} ที่`),
      createMsg
    );

    const zone = await prisma.zone.findFirstOrThrow({
      where: { concertId: concert.id },
      select: { id: true, totalSeats: true, polygon: true, seats: { select: { id: true, x: true, y: true, rowLabel: true, seatNumber: true } } },
    });
    check("DB มีที่นั่งครบตามจำนวน", zone.seats.length === SEAT_COUNT_FIRST, `got ${zone.seats.length}`);
    check("totalSeats ตรงกับจำนวนที่นั่งจริง", zone.totalSeats === zone.seats.length);
    check("polygon ถูกเก็บลง DB", Array.isArray(zone.polygon) && (zone.polygon as unknown[]).length === 4);
    check(
      "ทุกที่นั่งมีพิกัด x,y (ไม่ null)",
      zone.seats.every((s) => s.x !== null && s.y !== null)
    );

    // ⚠️ ตรวจ "อยู่ในกรอบ" ด้วยการเทียบขอบตรง ๆ ไม่เรียก point-in-polygon ของระบบเอง
    //    (ใช้ฟังก์ชันเดียวกับที่ implement = เทสอ้างอิงตัวเอง พิสูจน์อะไรไม่ได้)
    //    เผื่อ tolerance 1.5% เพราะการคลิกจริงลงพิกเซลไม่ได้ตรงเป๊ะกับสัดส่วนที่ตั้งใจ
    const tol = 0.015;
    const outside = zone.seats.filter(
      (s) =>
        s.x! < FRAME.left - tol ||
        s.x! > FRAME.right + tol ||
        s.y! < FRAME.top - tol ||
        s.y! > FRAME.bottom + tol
    );
    check("ไม่มีที่นั่งหลุดออกนอกกรอบที่วาด", outside.length === 0, `หลุด ${outside.length} ที่`);

    const labels = new Set(zone.seats.map((s) => `${s.rowLabel}-${s.seatNumber}`));
    check("ไม่มีแถว/เลขที่นั่งซ้ำกัน", labels.size === zone.seats.length);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.screenshot({ path: ".shots/seatmap-2-generated.png" });

    // ---------- 6) 🔴 ด่านกันเจนทับ: มีที่นั่ง SOLD ----------
    const victimSeat = zone.seats[0];
    await prisma.seat.update({ where: { id: victimSeat.id }, data: { status: "SOLD" } });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.click(`button:has-text("แก้ไข")`);
    await page.fill("#zone-seats", String(SEAT_COUNT_SECOND));
    await page.click(`button:has-text("บันทึก + เจนที่นั่งใหม่")`);
    const soldMsg = await readFeedback(page);
    check("❌ ถูกปฏิเสธเมื่อมีที่นั่งขายแล้ว (SOLD)", soldMsg.includes("ขายไปแล้ว"), soldMsg);

    const afterSoldAttempt = await prisma.seat.count({ where: { zoneId: zone.id } });
    check(
      "ที่นั่งเดิมยังอยู่ครบ ไม่ถูกลบทิ้ง",
      afterSoldAttempt === SEAT_COUNT_FIRST,
      `got ${afterSoldAttempt}`
    );
    await page.screenshot({ path: ".shots/seatmap-3-blocked-sold.png" });

    await prisma.seat.update({ where: { id: victimSeat.id }, data: { status: "AVAILABLE" } });

    // ---------- 7) 🔴 ด่านกันเจนทับ: มี hold ค้างใน Redis (DB ยังว่างอยู่) ----------
    // นี่คือเคสที่ถ้าดูแค่ Seat.status จะพลาด — คนกำลังอยู่หน้าจ่ายเงิน แต่ DB ยังเป็น AVAILABLE
    const holdKey = `seat:lock:${victimSeat.id.toString()}`;
    await redis.set(holdKey, "999", "EX", 120);
    createdRedisKeys.push(holdKey);

    const dbStatusDuringHold = await prisma.seat.findUniqueOrThrow({
      where: { id: victimSeat.id },
      select: { status: true },
    });
    check(
      "เงื่อนไขทดสอบถูกต้อง: DB ยังเป็น AVAILABLE ขณะที่ Redis จองค้าง",
      dbStatusDuringHold.status === "AVAILABLE",
      dbStatusDuringHold.status
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.click(`button:has-text("แก้ไข")`);
    await page.fill("#zone-seats", String(SEAT_COUNT_SECOND));
    await page.click(`button:has-text("บันทึก + เจนที่นั่งใหม่")`);
    const heldMsg = await readFeedback(page);
    check("❌ ถูกปฏิเสธเมื่อมี hold ค้างใน Redis", heldMsg.includes("จองค้าง"), heldMsg);

    const afterHoldAttempt = await prisma.seat.count({ where: { zoneId: zone.id } });
    check(
      "ที่นั่งเดิมยังอยู่ครบหลังถูกปฏิเสธ",
      afterHoldAttempt === SEAT_COUNT_FIRST,
      `got ${afterHoldAttempt}`
    );

    // ---------- 8) เคลียร์ภาระผูกพันแล้วเจนทับใหม่ ต้องผ่าน ----------
    await redis.del(holdKey);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.click(`button:has-text("แก้ไข")`);
    await page.fill("#zone-seats", String(SEAT_COUNT_SECOND));
    await page.click(`button:has-text("บันทึก + เจนที่นั่งใหม่")`);
    const regenMsg = await readFeedback(page);
    check(
      `เจนทับใหม่ได้เมื่อไม่มีภาระผูกพัน (${SEAT_COUNT_SECOND} ที่)`,
      regenMsg.includes(`เจนที่นั่ง ${SEAT_COUNT_SECOND} ที่`),
      regenMsg
    );

    const finalSeats = await prisma.seat.count({ where: { zoneId: zone.id } });
    check("DB อัปเดตเป็นจำนวนใหม่", finalSeats === SEAT_COUNT_SECOND, `got ${finalSeats}`);
    await page.screenshot({ path: ".shots/seatmap-4-regenerated.png" });
  } finally {
    await page.screenshot({ path: ".shots/seatmap-9-last.png" }).catch(() => {});
    await browser.close();

    // ---------- cleanup ----------
    for (const key of createdRedisKeys) await redis.del(key);
    await prisma.concert.delete({ where: { id: concert.id } }); // cascade -> zones -> seats
    try {
      unlinkSync(pngPath);
    } catch {
      /* ลบไม่ได้ก็ปล่อย — เป็นไฟล์ใน temp */
    }
    await prisma.$disconnect();
    redis.disconnect();
  }

  console.log(`\n📊 ผ่าน ${pass} / ตก ${fail}\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n💥 สคริปต์ล้ม:", err);
  process.exit(1);
});
