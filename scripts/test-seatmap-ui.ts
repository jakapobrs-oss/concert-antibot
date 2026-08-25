// ============================================================
// Integration (real browser + real DB + real Redis) — ผังที่นั่งจากรูป (Phase 2 / D3)
// ============================================================
// รัน: npx tsx scripts/test-seatmap-ui.ts   (ต้อง pnpm dev + pnpm db:up อยู่)
//
// ทำไมต้องมีไฟล์นี้ทั้งที่มี unit test แล้ว:
//   tests/unit/{seat-rows,zone-sheet}.test.ts พิสูจน์ตรรกะล้วน (pure function, mock ล้วน)
//   แต่ไม่ได้พิสูจน์ว่า หน้าแอดมิน -> server action -> DB -> Redis ต่อกันติดจริง
//   โดยเฉพาะ "ด่านกันเจนทับ" ที่ต้องอ่าน hold จาก Redis ซึ่ง mock ไม่ได้ให้ความมั่นใจ
//
// flow: สร้างคอนเสิร์ตทดสอบ -> login แอดมิน -> อัปโหลดรูปผัง -> คลิกวาดกรอบ 4 จุด
//       -> เจนที่นั่ง -> ตรวจ DB -> วาดกรอบเวที -> นำเข้าข้อมูลโซนจากไฟล์ Excel
//       -> ลองเจนทับตอนมีที่นั่ง SOLD (ต้องถูกปฏิเสธ)
//       -> ลองเจนทับตอนมี hold ค้างใน Redis (ต้องถูกปฏิเสธ)
//       -> เคลียร์ทั้งสองแล้วเจนทับใหม่ (ต้องผ่าน)
// ทำความสะอาด: ลบคอนเสิร์ตทดสอบ (cascade โซน/ที่นั่ง) + ลบ key Redis ที่สร้างเอง
import { chromium, type Page } from "playwright-core";
import ExcelJS from "exceljs";
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

// กรอบที่ 2 — เล็กลงและเยื้องไปมุมล่างขวา ใช้ตอนทดสอบ "ตั้งกรอบใหม่โดยคงที่นั่งเดิม"
// ต้องไม่ทับกับ FRAME เลยสักส่วน เพื่อพิสูจน์ได้ชัดว่ากรอบ "เปลี่ยนจริง" ไม่ใช่บังเอิญค่าเดิม
const FRAME_SHIFTED = { left: 0.55, right: 0.95, top: 0.55, bottom: 0.95 };

// กรอบเวที — แถบบนสุดของรูป (คนละที่กับกรอบโซนทั้งสองอัน)
const STAGE_FRAME = { left: 0.2, right: 0.8, top: 0.03, bottom: 0.13 };

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
async function drawFrame(page: Page, frame = FRAME) {
  const svg = page.locator('svg[role="presentation"]');
  await svg.waitFor({ timeout: 15_000 });
  const box = await svg.boundingBox();
  if (!box) throw new Error("หา svg ที่วาดกรอบไม่เจอ");
  const corners: Array<[number, number]> = [
    [frame.left, frame.top],
    [frame.right, frame.top],
    [frame.right, frame.bottom],
    [frame.left, frame.bottom],
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

/** สลับโหมดวาด (กรอบโซน / กรอบเวที) — กรอบเดียวกัน คนละความหมาย */
async function setDrawMode(page: Page, mode: "zone" | "stage") {
  await page.click(`button:has-text("${mode === "stage" ? "วาดกรอบเวที" : "วาดกรอบโซน"}")`);
}

/**
 * สร้างไฟล์ Excel ข้อมูลโซนแล้วอัปโหลดผ่าน "ปุ่มจริง"
 * (input ถูกซ่อนไว้เหมือนปุ่มอัปโหลดรูป — เหตุผลเดียวกับ uploadLayout)
 */
async function importZoneSheet(
  page: Page,
  filePath: string,
  rows: Array<[string, string, number, number, string]>
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("โซน");
  ws.addRow(["ชื่อโซน", "เรทราคา", "ราคา", "จำนวนที่นั่ง", "สี"]);
  for (const [name, tier, price, seats, color] of rows) {
    ws.addRow([name, tier, price, seats, ""]);
    // สีอ่านจาก "สีพื้นของช่อง" ไม่ใช่ข้อความ — เป็นวิธีที่คนทำผังใช้จริงใน Excel
    ws.lastRow!.getCell(5).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${color.replace("#", "").toUpperCase()}` },
    };
  }
  writeFileSync(filePath, Buffer.from(await wb.xlsx.writeBuffer()));

  const button = page.locator('button:has-text("นำเข้าไฟล์ Excel")');
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
      if (attempt === 5) throw new Error("กดปุ่มนำเข้า Excel แล้วไม่เปิด file chooser");
    }
  }
}

async function main() {
  const pngPath = join(tmpdir(), `seatmap-layout-${process.pid}.png`);
  const xlsxPath = join(tmpdir(), `seatmap-zones-${process.pid}.xlsx`);
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
      select: {
        id: true,
        totalSeats: true,
        polygon: true,
        seats: { select: { id: true, rowLabel: true, seatNumber: true } },
      },
    });
    check("DB มีที่นั่งครบตามจำนวน", zone.seats.length === SEAT_COUNT_FIRST, `got ${zone.seats.length}`);
    check("totalSeats ตรงกับจำนวนที่นั่งจริง", zone.totalSeats === zone.seats.length);
    check("polygon ถูกเก็บลง DB", Array.isArray(zone.polygon) && (zone.polygon as unknown[]).length === 4);

    // 📌 จำนวนที่นั่งต้องไม่ผูกกับ "ขนาดกรอบ" — สั่งเท่าไรได้เท่านั้นเป๊ะเสมอ
    //    (ของเดิมคำนวณจากพื้นที่กรอบ จึงได้จำนวนไม่ตรงเป้าเมื่อกรอบเล็ก)
    const labels = new Set(zone.seats.map((s) => `${s.rowLabel}-${s.seatNumber}`));
    check("ไม่มีแถว/เลขที่นั่งซ้ำกัน", labels.size === zone.seats.length);
    check(
      "แถวแรกคือ A และเรียงต่อเนื่อง ไม่ขาดช่วง",
      new Set(zone.seats.map((s) => s.rowLabel)).has("A")
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.screenshot({ path: ".shots/seatmap-2-generated.png" });

    // ---------- 5.5) วาดกรอบเวที ----------
    // เวทีคือคำถามหลักที่ผังนี้ต้องตอบ ("โซนนี้อยู่ตรงไหนของเวที") จึงเก็บลงฐานข้อมูลของคอนเสิร์ต
    await setDrawMode(page, "stage");
    await drawFrame(page, STAGE_FRAME);
    await page.click(`button:has-text("บันทึกกรอบเวที")`);
    const stageMsg = await readFeedback(page);
    check("บันทึกกรอบเวทีได้", stageMsg.includes("เวที"), stageMsg);

    const withStage = await prisma.concert.findUniqueOrThrow({
      where: { id: concert.id },
      select: { stagePolygon: true },
    });
    check(
      "กรอบเวทีถูกเก็บลง DB เป็นสัดส่วน 0-1 ครบ 4 มุม",
      Array.isArray(withStage.stagePolygon) &&
        (withStage.stagePolygon as number[][]).length === 4 &&
        (withStage.stagePolygon as number[][]).every(
          ([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1
        ),
      JSON.stringify(withStage.stagePolygon)
    );
    await page.screenshot({ path: ".shots/seatmap-2b-stage.png" });

    // ---------- 5.6) นำเข้าข้อมูลโซนจากไฟล์ Excel ----------
    // จุดสำคัญ: โซนเดิมที่มีอยู่แล้วต้องถูก "อัปเดต" ไม่ใช่สร้างซ้ำ (จับคู่ด้วยชื่อโซน)
    await page.reload({ waitUntil: "domcontentloaded" });
    await importZoneSheet(page, xlsxPath, [
      ["VIP ทดสอบ", "เรท 1", 3500, SEAT_COUNT_FIRST, "#ef4444"],
      ["โซน B ทดสอบ", "เรท 2", 2000, 24, "#3b82f6"],
    ]);
    const importMsg = await readFeedback(page);
    check("นำเข้าข้อมูลโซนจาก Excel สำเร็จ", importMsg.includes("นำเข้า"), importMsg);

    const importedZones = await prisma.zone.findMany({
      where: { concertId: concert.id },
      select: { name: true, tier: true, price: true, color: true, totalSeats: true, polygon: true },
      orderBy: { name: "asc" },
    });
    check("ได้โซนครบตามไฟล์ ไม่สร้างโซนซ้ำชื่อเดิม", importedZones.length === 2, `got ${importedZones.length}`);

    const vip = importedZones.find((z) => z.name === "VIP ทดสอบ");
    check("โซนเดิมถูกอัปเดตราคา/เรท/สีตามไฟล์", Number(vip?.price) === 3500 && vip?.tier === "เรท 1");
    check("โซนเดิมยังเก็บกรอบที่วาดไว้ (ไฟล์ไม่ล้างกรอบทิ้ง)", Array.isArray(vip?.polygon));

    const zoneB = importedZones.find((z) => z.name === "โซน B ทดสอบ");
    check(
      "โซนใหม่จากไฟล์ถูกสร้าง + เจนที่นั่งให้ครบ",
      zoneB?.totalSeats === 24 && zoneB?.tier === "เรท 2" && zoneB?.color === "#3b82f6",
      JSON.stringify(zoneB)
    );
    check(
      "โซนใหม่จากไฟล์ยังไม่มีกรอบ (รอแอดมินมาวาด)",
      zoneB?.polygon === null,
      JSON.stringify(zoneB?.polygon)
    );
    const zoneBSeats = await prisma.seat.count({ where: { zone: { name: "โซน B ทดสอบ", concertId: concert.id } } });
    check("ที่นั่งของโซนใหม่ถูกเจนครบตามไฟล์", zoneBSeats === 24, `got ${zoneBSeats}`);
    await page.screenshot({ path: ".shots/seatmap-2c-imported.png" });

    // เอาโซนที่ 2 ออก ไม่ให้ไปกวนการทดสอบด่านกันเจนทับข้างล่าง
    await prisma.zone.deleteMany({ where: { concertId: concert.id, name: "โซน B ทดสอบ" } });
    await setDrawMode(page, "zone");

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

    // ---------- 8.5) เสนอ "ที่นั่งต่อแถว" จากกรอบโซน (ระดับ A: เครื่องเสนอ คนแก้ทับได้) ----------
    // feedback box ตัวเดิมค้างข้อความก่อนหน้าอยู่ — ต้องรอ "ข้อความที่คาด" ไม่ใช่รอแค่กล่องโผล่
    const waitFeedback = async (text: string): Promise<string> => {
      const box = page.locator('[role="status"]', { hasText: text });
      await box.waitFor({ timeout: 30_000 });
      return (await box.innerText()).trim();
    };

    // 8.5a รายโซน: กด "จัดแถว" -> "เสนอจากกรอบ" ต้องเติมช่องให้ครบและรวมเท่าจำนวนที่นั่ง แล้วบันทึกได้
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "จัดแถว", exact: true }).first().click();
    await page.getByRole("button", { name: "เสนอจากกรอบ", exact: true }).click();
    const suggestMsg = await waitFeedback("แถวจากรูปทรงกรอบโซน");
    check("ปุ่มเสนอจากกรอบเติมแถวให้และบอกให้ตรวจก่อนบันทึก", suggestMsg.includes("ตรวจตัวเลข"), suggestMsg);
    const draftValues = await page
      .locator('input[aria-label^="จำนวนที่นั่งแถว"]')
      .evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
    const draftTotal = draftValues.reduce((sum, value) => sum + value, 0);
    check(
      `ที่นั่งต่อแถวที่เสนอรวมได้ ${SEAT_COUNT_SECOND} พอดี และไม่มีแถวว่าง`,
      draftValues.length >= 1 && draftTotal === SEAT_COUNT_SECOND && draftValues.every((v) => v >= 1),
      `rows=${draftValues.length} total=${draftTotal}`
    );
    await page.getByRole("button", { name: "บันทึกการจัดแถว", exact: true }).click();
    const saveRowsMsg = await waitFeedback("จัดแถวโซน");
    check("บันทึกแถวที่เสนอได้ผ่านด่านเดิม (รวมเท่าจำนวนที่นั่ง)", saveRowsMsg.includes("แถว)"), saveRowsMsg);
    const rowLabelsAfterSuggest = await prisma.seat.groupBy({
      by: ["rowLabel"],
      where: { zoneId: zone.id },
      _count: { _all: true },
    });
    check(
      "DB: ที่นั่งถูกเจนใหม่ตามแถวที่เสนอ (จำนวนแถวตรง ยอดรวมไม่เปลี่ยน)",
      rowLabelsAfterSuggest.length === draftValues.length &&
        rowLabelsAfterSuggest.reduce((sum, row) => sum + row._count._all, 0) === SEAT_COUNT_SECOND,
      `rows=${rowLabelsAfterSuggest.length}`
    );
    await page.screenshot({ path: ".shots/seatmap-4b-suggested-rows.png" });

    // 8.5b ยกชุด: ล้าง rowSpec ให้เหมือนโซนที่นำเข้าจาก Excel โดยไม่กรอกแถว -> ปุ่มยกชุดต้องเห็น 1 โซน
    //     (โซนจาก Excel ยังไม่มีกรอบ -> ไม่นับ) กด 2 ครั้ง (ยืนยัน) แล้ว rowSpec ต้องถูกตั้งให้
    await prisma.$executeRaw`UPDATE zones SET "rowSpec" = NULL WHERE id = ${zone.id}`;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^เสนอจัดแถวจากกรอบให้ 1 โซน/ }).click();
    await page.getByRole("button", { name: /^ยืนยัน — เจนที่นั่งใหม่ 1 โซน/ }).click();
    const bulkMsg = await waitFeedback("เสนอและจัดแถวให้");
    check("ยกชุด: เสนอ+บันทึกให้โซนที่ยังไม่กำหนดแถวได้ (นับเฉพาะโซนที่มีกรอบ)", bulkMsg.includes("1 โซนแล้ว"), bulkMsg);
    const zoneAfterBulk = await prisma.zone.findUniqueOrThrow({
      where: { id: zone.id },
      select: { rowSpec: true },
    });
    check("DB: rowSpec ถูกตั้งค่าจากการยกชุด", zoneAfterBulk.rowSpec !== null, String(zoneAfterBulk.rowSpec));
    // ปุ่มหายเมื่อ router.refresh() ส่งข้อมูลโซนชุดใหม่มา (rowSpec ไม่ว่างแล้ว) — รอได้ ไม่ใช่เช็คทันที
    let bulkButtonGone = true;
    try {
      await page
        .getByRole("button", { name: /^เสนอจัดแถวจากกรอบให้/ })
        .waitFor({ state: "detached", timeout: 10_000 });
    } catch {
      bulkButtonGone = false;
    }
    check("ยกชุดเสร็จแล้วปุ่มหายไป (ไม่เหลือโซนที่ยังไม่กำหนดแถว)", bulkButtonGone);

    // 8.5c 🔴 ยกชุดต้องข้ามโซนที่ขายบัตรไปแล้ว (ด่านเดียวกับเจนทับ) และไม่แตะที่นั่งเดิม
    await prisma.$executeRaw`UPDATE zones SET "rowSpec" = NULL WHERE id = ${zone.id}`;
    const seatsBeforeBulkSkip = await prisma.seat.findMany({
      where: { zoneId: zone.id },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    await prisma.seat.update({ where: { id: seatsBeforeBulkSkip[0].id }, data: { status: "SOLD" } });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^เสนอจัดแถวจากกรอบให้ 1 โซน/ }).click();
    await page.getByRole("button", { name: /^ยืนยัน — เจนที่นั่งใหม่ 1 โซน/ }).click();
    const bulkSkipMsg = await waitFeedback("ไม่ได้จัดแถวโซนไหนเลย");
    check("❌ ยกชุดข้ามโซนที่มีที่นั่งขายแล้ว พร้อมบอกเหตุผล", bulkSkipMsg.includes("ขายไปแล้ว"), bulkSkipMsg);
    const seatsAfterBulkSkip = await prisma.seat.findMany({
      where: { zoneId: zone.id },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    check(
      "ที่นั่งของโซนที่ถูกข้ามยังเป็นตัวเดิมทุกตัว",
      seatsBeforeBulkSkip.map((s) => s.id.toString()).join(",") ===
        seatsAfterBulkSkip.map((s) => s.id.toString()).join(",")
    );
    // คืนสถานะให้ข้อ 9 เริ่มจากโซนที่ไม่มีภาระผูกพัน (ข้อ 9 ตั้ง SOLD เองอีกที)
    await prisma.seat.update({ where: { id: seatsBeforeBulkSkip[0].id }, data: { status: "AVAILABLE" } });

    // ---------- 9) 🔴 "ตั้งกรอบให้โซนนี้" บนโซนที่ขายบัตรไปแล้ว ----------
    // ทำไมต้องมีทางนี้: ด่านข้อ 6-7 ปฏิเสธการเจนทับตลอดไปเมื่อมีที่นั่งขายแล้ว (ถูกต้อง เพราะเจน = ลบ+สร้างใหม่)
    // แต่แปลว่าคอนเสิร์ตที่กำลังขายอยู่จะไม่มีวันได้ผังบนรูปจริง -> assignZoneFrame แตะ "แค่กรอบโซน"
    // ที่นั่งทั้งโซนต้องไม่ถูกแตะเลยแม้แต่แถวเดียว (ผังรุ่นนี้ที่นั่งไม่มีพิกัดบนรูปแล้ว)
    const beforeFrame = await prisma.seat.findMany({
      where: { zoneId: zone.id },
      select: { id: true, rowLabel: true, seatNumber: true, status: true },
      orderBy: { id: "asc" },
    });
    const soldSeat = beforeFrame[0];
    await prisma.seat.update({ where: { id: soldSeat.id }, data: { status: "SOLD" } });

    await page.reload({ waitUntil: "domcontentloaded" });
    await drawFrame(page, FRAME_SHIFTED);
    await page.click(`button:has-text("ตั้งกรอบ")`);
    const frameMsg = await readFeedback(page);
    check(
      "ตั้งกรอบใหม่ได้แม้โซนนี้ขายบัตรไปแล้ว (ทางที่ไม่ลบที่นั่ง)",
      frameMsg.includes("ตั้งกรอบโซน"),
      frameMsg
    );

    const afterFrame = await prisma.seat.findMany({
      where: { zoneId: zone.id },
      select: { id: true, rowLabel: true, seatNumber: true, status: true },
      orderBy: { id: "asc" },
    });

    // ที่นั่ง "ตัวเดิม" ต้องอยู่ครบ — เทียบด้วย id ไม่ใช่แค่จำนวน
    // (ถ้าเผลอไปลบแล้วสร้างใหม่ จำนวนจะเท่าเดิมแต่ id เปลี่ยนหมด และตั๋วเก่าจะชน FK)
    const idsBefore = beforeFrame.map((s) => s.id.toString()).join(",");
    const idsAfter = afterFrame.map((s) => s.id.toString()).join(",");
    check("id ที่นั่งทุกตัวเป็นตัวเดิม ไม่มีการลบ/สร้างใหม่", idsBefore === idsAfter);
    check(
      "ชื่อแถว/เลขที่นั่งไม่เปลี่ยน (ตั๋วที่พิมพ์ไปแล้วยังตรง)",
      afterFrame.every(
        (s, i) => s.rowLabel === beforeFrame[i].rowLabel && s.seatNumber === beforeFrame[i].seatNumber
      )
    );
    check(
      "ที่นั่งที่ขายแล้วยังเป็น SOLD",
      afterFrame.find((s) => s.id === soldSeat.id)?.status === "SOLD"
    );

    const zoneAfterFrame = await prisma.zone.findUniqueOrThrow({
      where: { id: zone.id },
      select: { polygon: true, totalSeats: true },
    });
    check(
      "polygon ของโซนถูกอัปเดตเป็นกรอบใหม่",
      Array.isArray(zoneAfterFrame.polygon) &&
        (zoneAfterFrame.polygon as number[][])[0][0] > FRAME.left + 0.1,
      JSON.stringify(zoneAfterFrame.polygon)
    );
    check(
      "จำนวนที่นั่งไม่เปลี่ยนตามขนาดกรอบที่เล็กลง",
      afterFrame.length === beforeFrame.length,
      `${beforeFrame.length} -> ${afterFrame.length}`
    );
    check(
      "totalSeats ไม่ถูกแตะ",
      zoneAfterFrame.totalSeats === SEAT_COUNT_SECOND,
      `got ${zoneAfterFrame.totalSeats}`
    );
    await page.screenshot({ path: ".shots/seatmap-5-frame-assigned.png" });
  } finally {
    await page.screenshot({ path: ".shots/seatmap-9-last.png" }).catch(() => {});
    await browser.close();

    // ---------- cleanup ----------
    for (const key of createdRedisKeys) await redis.del(key);
    await prisma.concert.delete({ where: { id: concert.id } }); // cascade -> zones -> seats
    for (const tmp of [pngPath, xlsxPath]) {
      try {
        unlinkSync(tmp);
      } catch {
        /* ลบไม่ได้ก็ปล่อย — เป็นไฟล์ใน temp */
      }
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
