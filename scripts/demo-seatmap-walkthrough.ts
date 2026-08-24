// ============================================================
// เดินผ่าน "ทำผังใหม่ทั้งงาน" ทีละขั้น + แคปหน้าจอทุกขั้น (ไม่ใช่ชุดเทส — ใช้ดูว่าพร้อมใช้จริงมั้ย)
// ============================================================
// รัน: E2E_BASE=http://localhost:3001 npx tsx scripts/demo-seatmap-walkthrough.ts
// ต้องมี: pnpm dev (พอร์ตตาม E2E_BASE) + docker concert-postgres/concert-redis
//
// ต่างจาก scripts/test-seatmap-ui.ts ตรงที่ไฟล์นั้นพิสูจน์ "ด่านกันเจนทับ" ด้วยผัง fixture 2 โซน
// ส่วนไฟล์นี้จำลอง "งานจริง" — ผังอารีน่า 16 โซน 4,700 ที่นั่ง เดินครบทุกขั้นที่แอดมินต้องทำเอง
// แล้วจับเวลาแต่ละขั้น เพื่อตอบว่าผังจริง 69 โซนจะใช้เวลาเท่าไร
//
// ไม่ลบคอนเสิร์ตทิ้งเมื่อจบ (ตั้งใจ) — user จะได้เปิดดูเองต่อในเบราว์เซอร์
// ลบเองภายหลัง: npx tsx -e "import('./lib/prisma').then(async m=>{await m.prisma.concert.deleteMany({where:{slug:{startsWith:'demo-arena-'}}})})"
import { chromium, type Browser, type Page } from "playwright-core";
import ExcelJS from "exceljs";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../lib/prisma";
import { joinQueue, admitNext, leaveQueue } from "../lib/queue";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin123!";
const BUYER_EMAIL = process.env.E2E_USER_EMAIL ?? "user@local";
const BUYER_PASSWORD = process.env.E2E_USER_PASSWORD ?? "Password123!";
const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAP_W = 1200;
const MAP_H = 900;
const SHOT_DIR = ".shots/walkthrough";

// ---------- ผังอารีน่าจำลอง: กรอบชุดเดียวใช้ทั้ง "วาดรูป" และ "คลิกวาดกรอบ" ----------
// พิกัดเป็นสัดส่วน 0-1 ของรูป — แอดมินตัวจริงจะกวาดสายตาแล้วคลิกตามบล็อกในรูป สคริปต์นี้คลิกตามพิกัดเดียวกับที่วาด
type Rect = { l: number; t: number; r: number; b: number };
type ZoneSpec = {
  name: string;
  tier: string;
  price: number;
  seats: number;
  color: string;
  rect: Rect;
};

const STAGE_RECT: Rect = { l: 0.28, t: 0.05, r: 0.72, b: 0.13 };

const ZONES: ZoneSpec[] = [
  // ฟลอร์หน้าเวที — เรทแพงสุด
  { name: "A1", tier: "เรท 1", price: 5500, seats: 300, color: "#ef4444", rect: { l: 0.28, t: 0.17, r: 0.485, b: 0.3 } },
  { name: "A2", tier: "เรท 1", price: 5500, seats: 300, color: "#ef4444", rect: { l: 0.515, t: 0.17, r: 0.72, b: 0.3 } },
  { name: "B1", tier: "เรท 2", price: 4500, seats: 300, color: "#f97316", rect: { l: 0.28, t: 0.32, r: 0.485, b: 0.45 } },
  { name: "B2", tier: "เรท 2", price: 4500, seats: 300, color: "#f97316", rect: { l: 0.515, t: 0.32, r: 0.72, b: 0.45 } },
  { name: "C1", tier: "เรท 3", price: 3500, seats: 300, color: "#22c55e", rect: { l: 0.28, t: 0.47, r: 0.485, b: 0.6 } },
  { name: "C2", tier: "เรท 3", price: 3500, seats: 300, color: "#22c55e", rect: { l: 0.515, t: 0.47, r: 0.72, b: 0.6 } },
  // อัฒจันทร์ข้างซ้าย/ขวา
  { name: "L1", tier: "เรท 2", price: 4500, seats: 250, color: "#f97316", rect: { l: 0.08, t: 0.17, r: 0.255, b: 0.36 } },
  { name: "L2", tier: "เรท 3", price: 3500, seats: 250, color: "#22c55e", rect: { l: 0.08, t: 0.38, r: 0.255, b: 0.57 } },
  { name: "L3", tier: "เรท 4", price: 2500, seats: 250, color: "#3b82f6", rect: { l: 0.08, t: 0.59, r: 0.255, b: 0.75 } },
  { name: "R1", tier: "เรท 2", price: 4500, seats: 250, color: "#f97316", rect: { l: 0.745, t: 0.17, r: 0.92, b: 0.36 } },
  { name: "R2", tier: "เรท 3", price: 3500, seats: 250, color: "#22c55e", rect: { l: 0.745, t: 0.38, r: 0.92, b: 0.57 } },
  { name: "R3", tier: "เรท 4", price: 2500, seats: 250, color: "#3b82f6", rect: { l: 0.745, t: 0.59, r: 0.92, b: 0.75 } },
  // หลังฟลอร์
  { name: "BK1", tier: "เรท 4", price: 2500, seats: 400, color: "#3b82f6", rect: { l: 0.28, t: 0.62, r: 0.485, b: 0.75 } },
  { name: "BK2", tier: "เรท 4", price: 2500, seats: 400, color: "#3b82f6", rect: { l: 0.515, t: 0.62, r: 0.72, b: 0.75 } },
  // ชั้นบนหลังสุด
  { name: "UP-L", tier: "เรท 5", price: 1500, seats: 300, color: "#a855f7", rect: { l: 0.08, t: 0.79, r: 0.485, b: 0.92 } },
  { name: "UP-R", tier: "เรท 5", price: 1500, seats: 300, color: "#a855f7", rect: { l: 0.515, t: 0.79, r: 0.92, b: 0.92 } },
];

const TOTAL_SEATS = ZONES.reduce((sum, z) => sum + z.seats, 0);

// ---------- จับเวลาแต่ละขั้น ----------
const timings: Array<{ step: string; ms: number }> = [];
async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const out = await fn();
  const ms = Date.now() - started;
  timings.push({ step: label, ms });
  console.log(`  ⏱  ${label} — ${(ms / 1000).toFixed(1)} วิ`);
  return out;
}

/** วาดรูปผังสถานที่ด้วย HTML แล้วถ่ายเป็น PNG — ได้ผังที่มีตัวหนังสือกำกับโซนเหมือนผังจริง */
async function renderVenueMap(browser: Browser, path: string) {
  const block = (label: string, rect: Rect, fill: string, text = "#1f2937") => `
    <div style="position:absolute;left:${rect.l * 100}%;top:${rect.t * 100}%;
      width:${(rect.r - rect.l) * 100}%;height:${(rect.b - rect.t) * 100}%;
      background:${fill};border:2px solid rgba(0,0,0,.28);border-radius:6px;
      display:flex;align-items:center;justify-content:center;
      font:600 26px/1.2 'Segoe UI',sans-serif;color:${text};letter-spacing:.5px;">${label}</div>`;

  const html = `<div style="position:relative;width:${MAP_W}px;height:${MAP_H}px;background:#f5f3ee;
      font-family:'Segoe UI',sans-serif;overflow:hidden;">
    <div style="position:absolute;inset:14px;border:3px solid #cfc9bd;border-radius:18px;"></div>
    <div style="position:absolute;left:0;right:0;top:20px;text-align:center;font:700 20px 'Segoe UI';color:#6b6455;">
      ผังที่นั่ง — อารีน่าจำลอง (สาธิต)</div>
    ${block("เวที / STAGE", STAGE_RECT, "#2b2b2b", "#f5f3ee")}
    ${ZONES.map((z) => block(z.name, z.rect, z.color + "38")).join("")}
  </div>`;

  const page = await browser.newPage({ viewport: { width: MAP_W, height: MAP_H } });
  await page.setContent(html);
  const buf = await page.screenshot();
  writeFileSync(path, buf);
  await page.close();
}

/** สร้างไฟล์ Excel ข้อมูลโซนแบบที่ผู้จัดกรอกจริง — สีอ่านจากสีพื้นของช่อง */
async function makeZoneSheet(path: string) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("โซน");
  // หัวตารางไม่ได้อยู่แถวแรก — เลียนไฟล์จริงที่มักมีชื่องานอยู่ข้างบน (ตัวอ่านมองหาใน 10 แถวแรก)
  ws.addRow(["ผังที่นั่ง — อารีน่าจำลอง (สาธิต)"]);
  ws.addRow([]);
  ws.addRow(["ชื่อโซน", "เรทราคา", "ราคา", "จำนวนที่นั่ง", "สี"]);
  for (const z of ZONES) {
    ws.addRow([z.name, z.tier, z.price, z.seats, ""]);
    ws.lastRow!.getCell(5).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${z.color.replace("#", "").toUpperCase()}` },
    };
  }
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()));
}

async function readFeedback(page: Page, timeout = 180_000): Promise<string> {
  const box = page.locator('[role="status"]');
  await box.waitFor({ timeout });
  return (await box.innerText()).trim();
}

/** กดปุ่มจริงแล้วรับ file chooser (input ถูกซ่อน — ยัดไฟล์ตรง ๆ จะเงียบถ้ายังไม่ hydrate) */
async function pickFile(page: Page, buttonText: string, filePath: string) {
  const button = page.locator(`button:has-text("${buttonText}")`);
  await button.waitFor({ timeout: 20_000 });
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 5_000 }),
        button.click(),
      ]);
      await chooser.setFiles(filePath);
      return;
    } catch {
      if (attempt === 6) throw new Error(`กด "${buttonText}" แล้วไม่เปิด file chooser`);
    }
  }
}

/** คลิก 4 มุมของกรอบทับรูป (เท่ากับแอดมินคลิกวาดเอง) */
async function drawRect(page: Page, rect: Rect) {
  const svg = page.locator('svg[role="presentation"]');
  await svg.waitFor({ timeout: 20_000 });
  const box = await svg.boundingBox();
  if (!box) throw new Error("หา svg สำหรับวาดกรอบไม่เจอ");
  const corners: Array<[number, number]> = [
    [rect.l, rect.t],
    [rect.r, rect.t],
    [rect.r, rect.b],
    [rect.l, rect.b],
  ];
  for (const [fx, fy] of corners) {
    await svg.click({ position: { x: box.width * fx, y: box.height * fy } });
  }
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const mapPath = join(tmpdir(), `demo-venue-${process.pid}.png`);
  const sheetPath = join(tmpdir(), `demo-zones-${process.pid}.xlsx`);

  // ล้างคอนเสิร์ตสาธิตของรอบก่อน (เฉพาะ slug demo-arena- ที่สคริปต์นี้สร้างเอง) — กันสะสมในฐานข้อมูล dev
  const purged = await prisma.concert.deleteMany({ where: { slug: { startsWith: "demo-arena-" } } });
  if (purged.count > 0) console.log(`   (ล้างคอนเสิร์ตสาธิตรอบก่อน ${purged.count} รายการ)`);

  const stamp = Date.now();
  const concert = await prisma.concert.create({
    data: {
      title: `[DEMO] อารีน่าจำลอง ${new Date(stamp).toLocaleDateString("th-TH")}`,
      slug: `demo-arena-${stamp}`,
      description: "คอนเสิร์ตสาธิตขั้นตอนทำผังที่นั่ง — สร้างโดย scripts/demo-seatmap-walkthrough.ts",
      venue: "อารีน่าจำลอง",
      eventAt: new Date(Date.now() + 30 * 86_400_000),
      saleStartAt: new Date(Date.now() - 86_400_000),
      saleEndAt: new Date(Date.now() + 29 * 86_400_000),
      // ต้องเป็น ON_SALE ไม่งั้นหน้าคนซื้อเด้งออกก่อนถึงผัง (ค่าเริ่มต้นคือ DRAFT)
      status: "ON_SALE",
    },
    select: { id: true, slug: true },
  });
  const concertId = concert.id.toString();
  console.log(`\n🎬 เดินขั้นตอนทำผังใหม่ — concert ${concertId} (${concert.slug})`);
  console.log(`   ${ZONES.length} โซน / ${TOTAL_SEATS.toLocaleString("th-TH")} ที่นั่ง\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: REAL_UA,
    viewport: { width: 1500, height: 1050 },
    locale: "th-TH",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  let queueToken: string | null = null;

  try {
    await renderVenueMap(browser, mapPath);
    await makeZoneSheet(sheetPath);

    // ---------- ขั้น 0: เข้าหน้าจัดผัง (ยังว่าง) ----------
    await step("0) login แอดมิน + เปิดหน้าจัดผัง", async () => {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.fill("#email", ADMIN_EMAIL);
      await page.fill("#password", ADMIN_PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30_000 });
      await page.goto(`${BASE}/admin/concerts/${concertId}/seatmap`, { waitUntil: "domcontentloaded" });
      await page.locator('button:has-text("อัปโหลดรูปผัง")').waitFor({ timeout: 20_000 });
      await page.screenshot({ path: `${SHOT_DIR}/00-empty.png`, fullPage: true });
    });

    // ---------- ขั้น 1: อัปโหลดรูปผังสถานที่ ----------
    const uploadMsg = await step("1) อัปโหลดรูปผังสถานที่", async () => {
      await pickFile(page, "อัปโหลดรูปผัง", mapPath);
      const msg = await readFeedback(page);
      await page.locator('img[alt="ผังสถานที่จัดงาน"]').waitFor({ timeout: 20_000 });
      await page.screenshot({ path: `${SHOT_DIR}/01-uploaded.png`, fullPage: true });
      return msg;
    });
    console.log(`     ↳ ${uploadMsg}`);

    // ---------- ขั้น 2: ดาวน์โหลดไฟล์ตัวอย่าง (ดูว่าแอดมินได้อะไรไปกรอก) ----------
    const templateInfo = await step("2) ดาวน์โหลดไฟล์ Excel ตัวอย่าง", async () => {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30_000 }),
        page.click('a:has-text("ไฟล์ตัวอย่าง")'),
      ]);
      const saved = join(tmpdir(), `demo-template-${process.pid}.xlsx`);
      await download.saveAs(saved);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(saved);
      const ws = wb.worksheets[0];
      const rows: string[][] = [];
      ws.eachRow((row, i) => {
        if (i <= 4) rows.push((row.values as unknown[]).slice(1).map((v) => String(v ?? "")));
      });
      return { file: download.suggestedFilename(), rows };
    });
    console.log(`     ↳ ไฟล์: ${templateInfo.file}`);
    for (const r of templateInfo.rows) console.log(`        | ${r.join(" | ")}`);

    // ---------- ขั้น 3: นำเข้าข้อมูลโซนทั้งงานจาก Excel ----------
    const importMsg = await step(`3) นำเข้า Excel ${ZONES.length} โซน (${TOTAL_SEATS} ที่นั่ง)`, async () => {
      await pickFile(page, "นำเข้าไฟล์ Excel", sheetPath);
      const msg = await readFeedback(page);
      await page.screenshot({ path: `${SHOT_DIR}/02-imported.png`, fullPage: true });
      return msg;
    });
    console.log(`     ↳ ${importMsg}`);

    const seatCount = await prisma.seat.count({ where: { zone: { concertId: concert.id } } });
    const zoneCount = await prisma.zone.count({ where: { concertId: concert.id } });
    console.log(`     ↳ DB: ${zoneCount} โซน / ${seatCount.toLocaleString("th-TH")} ที่นั่ง`);

    // ---------- ขั้น 4: วาดกรอบเวที ----------
    const stageMsg = await step("4) วาดกรอบเวที (4 คลิก + บันทึก)", async () => {
      await page.click('button:has-text("วาดกรอบเวที")');
      await drawRect(page, STAGE_RECT);
      await page.click('button:has-text("บันทึกกรอบเวที")');
      const msg = await readFeedback(page);
      await page.screenshot({ path: `${SHOT_DIR}/03-stage.png`, fullPage: true });
      return msg;
    });
    console.log(`     ↳ ${stageMsg}`);

    // ---------- ขั้น 5: วาดกรอบทีละโซน ----------
    await page.click('button:has-text("วาดกรอบโซน")');
    const perZoneMs: number[] = [];
    for (const [index, zone] of ZONES.entries()) {
      const started = Date.now();
      await drawRect(page, zone.rect);
      const li = page.locator("li").filter({ hasText: new RegExp(`^\\s*${zone.name}\\b`) }).first();
      await li.locator('button:has-text("ตั้งกรอบให้โซนนี้")').click();
      await page.waitForFunction(
        (name) => {
          const items = Array.from(document.querySelectorAll("li"));
          const target = items.find((el) => (el.textContent ?? "").trim().startsWith(name));
          return !!target && !(target.textContent ?? "").includes("ยังไม่มีกรอบ");
        },
        zone.name,
        { timeout: 30_000 }
      );
      perZoneMs.push(Date.now() - started);
      if (index === 0) {
        await page.screenshot({ path: `${SHOT_DIR}/04-first-zone.png`, fullPage: true });
        console.log(`     ↳ โซนแรก (${zone.name}) เสร็จใน ${(perZoneMs[0] / 1000).toFixed(1)} วิ`);
      }
    }
    const avgZone = perZoneMs.reduce((a, b) => a + b, 0) / perZoneMs.length;
    timings.push({ step: `5) วาดกรอบครบ ${ZONES.length} โซน`, ms: perZoneMs.reduce((a, b) => a + b, 0) });
    console.log(`  ⏱  5) วาดกรอบครบ ${ZONES.length} โซน — เฉลี่ยโซนละ ${(avgZone / 1000).toFixed(1)} วิ`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('img[alt="ผังสถานที่จัดงาน"]').waitFor({ timeout: 20_000 });
    await page.screenshot({ path: `${SHOT_DIR}/05-all-zones.png`, fullPage: true });

    const zoneRows = await prisma.zone.findMany({
      where: { concertId: concert.id },
      select: { polygon: true },
    });
    const framed = zoneRows.filter((z) => Array.isArray(z.polygon)).length;
    console.log(`     ↳ DB: วาดกรอบแล้ว ${framed}/${zoneCount} โซน`);

    // ---------- ขั้น 6: ฝั่งคนซื้อเห็นอะไร ----------
    await step("6) เปิดหน้าคนซื้อ", async () => {
      const buyerContext = await browser.newContext({
        userAgent: REAL_UA,
        viewport: { width: 1500, height: 1050 },
        locale: "th-TH",
      });
      const buyer = await buyerContext.newPage();
      await buyer.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await buyer.fill("#email", BUYER_EMAIL);
      await buyer.fill("#password", BUYER_PASSWORD);
      await buyer.click('button[type="submit"]');
      await buyer.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30_000 });

      // ผ่านคิวด้วย API ของระบบเอง — หน้าห้องรอมี Turnstile จริง ซึ่งสคริปต์ไม่ควรไปแหย่
      const buyerUser = await prisma.user.findUniqueOrThrow({
        where: { email: BUYER_EMAIL },
        select: { id: true },
      });
      const joined = await joinQueue({ concertId, userId: buyerUser.id.toString() });
      queueToken = joined.token;
      await admitNext(concertId, { batchSize: 5 });

      await buyer.goto(`${BASE}/concerts/${concert.slug}/seats?qt=${queueToken}`, {
        waitUntil: "domcontentloaded",
      });
      await buyer.locator('img[alt="ผังสถานที่จัดงาน"]').waitFor({ timeout: 30_000 });
      await buyer.screenshot({ path: `${SHOT_DIR}/06-buyer-map.png`, fullPage: true });

      // กดโซนบนผัง → เปิดแผงเลือกที่นั่ง
      await buyer.locator('svg[aria-label="ผังโซนที่นั่ง"] g[data-zone-name]').first().click();
      await buyer.locator("button[data-seat-number]").first().waitFor({ timeout: 30_000 });
      await buyer.screenshot({ path: `${SHOT_DIR}/07-buyer-zone-open.png`, fullPage: true });

      // เลือกที่นั่ง 2 ที่ ให้เห็นแผงสรุป
      const seats = buyer.locator("button[data-seat-number]");
      await seats.nth(0).click();
      await seats.nth(1).click();
      await buyer.screenshot({ path: `${SHOT_DIR}/08-buyer-selected.png`, fullPage: true });
      await buyerContext.close();
    });

    // ---------- สรุป ----------
    console.log(`\n📊 สรุปเวลา`);
    for (const t of timings) console.log(`   ${t.step.padEnd(42)} ${(t.ms / 1000).toFixed(1)} วิ`);
    const drawTotal = perZoneMs.reduce((a, b) => a + b, 0);
    console.log(
      `\n   ประมาณการผังจริง 69 โซน: วาดกรอบ ~${((avgZone * 69) / 60_000).toFixed(1)} นาที ` +
        `(จากเฉลี่ย ${(avgZone / 1000).toFixed(1)} วิ/โซน × 69) — ยังไม่รวมเวลาคนเล็งกรอบเอง`
    );
    console.log(`   เวลาวาดกรอบรวมรอบนี้: ${(drawTotal / 1000).toFixed(1)} วิ`);
    console.log(`\n🔗 แอดมิน: ${BASE}/admin/concerts/${concertId}/seatmap`);
    console.log(`🔗 คนซื้อ: ${BASE}/concerts/${concert.slug}`);
    console.log(`🖼  ภาพ: ${SHOT_DIR}/`);
  } finally {
    if (queueToken) {
      try {
        await leaveQueue(queueToken);
      } catch {
        /* ปล่อยผ่าน — เป็นแค่การเก็บกวาด */
      }
    }
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error("\n💥", err);
  await prisma.$disconnect();
  process.exit(1);
});
