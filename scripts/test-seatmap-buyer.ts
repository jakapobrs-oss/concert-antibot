// ============================================================
// Integration (real browser + real DB + real Redis) — ฝั่งคนซื้อ: ผังที่นั่งบนรูปจริง (Phase 2 / D5)
// ============================================================
// รัน: npx tsx scripts/test-seatmap-buyer.ts   (ต้อง pnpm dev + pnpm db:up อยู่)
//
// สิ่งที่ต้องพิสูจน์ (D4-D5 คือขั้นที่เสี่ยงสุดของสายนี้ เพราะแตะทางเดินเงินที่เทสผ่านแล้ว):
//   1. คอนเสิร์ตที่ทำผังแล้ว -> เห็นผัง SVG บนรูปจริง (เวที + กรอบโซน) ไม่ใช่ผังตารางแบบเดิม
//   2. กดโซนบนผัง -> เปิดแผงเลือกที่นั่ง -> hold + สร้าง order ได้จริง (ทางเดินเงินเดิมไม่พัง)
//   3. คอนเสิร์ตที่ยังไม่มีกรอบโซน -> ถอยไปใช้ผังตารางเดิมอัตโนมัติ (ของเก่าไม่พัง)
//
// 📌 ผังรุ่นนี้เป็นผัง "ระดับโซน" ที่นั่งไม่มีพิกัดบนรูปแล้ว -> เทสจึงเช็คกรอบโซน/เวที
//    และแผงเลือกที่นั่ง (ปุ่ม HTML จริง) แทนการนับจุดที่นั่งบนรูปแบบรุ่นก่อน
//
// ทำความสะอาด: ลบ order/ticket/payment ที่เกิดในรอบนี้ -> ลบคอนเสิร์ตทดสอบ -> เคลียร์ key Redis
import { chromium, type Page } from "playwright-core";
import { deflateSync } from "node:zlib";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { buildSeatRows } from "../lib/seatmap/seat-rows";
import type { Polygon } from "../lib/seatmap/polygon";
import { joinQueue, admitNext, leaveQueue } from "../lib/queue";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
// บัญชีผู้ใช้ทั่วไปจาก prisma/seed.ts (fixture สำหรับ dev เท่านั้น)
const EMAIL = process.env.E2E_USER_EMAIL ?? "user@local";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "Password123!";
const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const IMAGE_W = 800;
const IMAGE_H = 600;
const SEAT_COUNT = 40;
const SEATS_TO_PICK = 2;
const FRAME: Polygon = [
  [0.15, 0.25],
  [0.85, 0.25],
  [0.85, 0.85],
  [0.15, 0.85],
];
// กรอบเวทีวางไว้เหนือกรอบโซน — ใช้เช็คว่าป้ายเวทีขึ้นจริงและโซนเรียงตามระยะจากเวทีได้
const STAGE: Polygon = [
  [0.25, 0.05],
  [0.75, 0.05],
  [0.75, 0.18],
  [0.25, 0.18],
];

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

// ---------- PNG ผังจำลอง (ไม่พึ่ง lib ภายนอก) ----------
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

function makeVenuePngDataUrl(width: number, height: number): string {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let pos = 0;
  for (let y = 0; y < height; y++) {
    raw[pos++] = 0;
    for (let x = 0; x < width; x++) {
      const fx = x / width;
      const fy = y / height;
      let r = 18,
        g = 20,
        b = 28;
      if (fy < 0.14 && fx > 0.2 && fx < 0.8) {
        r = 190;
        g = 60;
        b = 70; // เวที
      } else if (fx > 0.15 && fx < 0.85 && fy > 0.25 && fy < 0.85) {
        r = 52;
        g = 58;
        b = 78; // พื้นที่ที่นั่ง
      }
      raw[pos++] = r;
      raw[pos++] = g;
      raw[pos++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * กดที่นั่งในแผงของโซนที่เปิดอยู่ จนกว่าจะ "ถูกเลือกจริง"
 *
 * ต้องวนลองเพราะหน้าเพิ่งโหลด React อาจยัง hydrate ไม่เสร็จ -> คลิกโดนแต่ไม่มี handler รับ
 * (เจอมาแล้วตอนเขียนเทสหน้าแอดมิน คลิกแล้วเงียบสนิทโดยไม่มี error)
 */
async function pickSeat(page: Page, seatIndex: number, expectedCount: number) {
  const seats = page.locator("button[data-seat-number]:not([disabled])");
  const chips = page.locator('[aria-label^="เอาที่นั่ง"]');
  for (let attempt = 1; attempt <= 10; attempt++) {
    await seats.nth(seatIndex).click();
    try {
      await chips.nth(expectedCount - 1).waitFor({ timeout: 1_500 });
      return;
    } catch {
      if (attempt === 10)
        throw new Error(`กดที่นั่งลำดับ ${seatIndex} แล้วไม่ถูกเลือก`);
    }
  }
}

async function main() {
  const stamp = Date.now();
  const slug = `test-buyer-seatmap-${stamp}`;

  // ---------- fixture: คอนเสิร์ตที่ "ทำผังแล้ว" ครบทุกชิ้น ----------
  const generated = buildSeatRows(SEAT_COUNT);
  if (generated.length !== SEAT_COUNT) {
    throw new Error(
      `เจนที่นั่ง fixture ไม่ครบ (${generated.length}/${SEAT_COUNT})`,
    );
  }

  const concert = await prisma.concert.create({
    data: {
      title: `[TEST] ผังคนซื้อ ${stamp}`,
      slug,
      description:
        "คอนเสิร์ตทดสอบของ scripts/test-seatmap-buyer.ts — ลบอัตโนมัติเมื่อจบ",
      venue: "หอประชุมทดสอบ",
      eventAt: new Date(Date.now() + 30 * 86_400_000),
      saleStartAt: new Date(Date.now() - 86_400_000),
      saleEndAt: new Date(Date.now() + 29 * 86_400_000),
      status: "ON_SALE",
      layoutImageBase64: makeVenuePngDataUrl(IMAGE_W, IMAGE_H),
      layoutImageWidth: IMAGE_W,
      layoutImageHeight: IMAGE_H,
      stagePolygon: STAGE,
      zones: {
        create: {
          name: "VIP ทดสอบ",
          tier: "เรททดสอบ",
          price: 1500,
          color: "#ef4444",
          totalSeats: SEAT_COUNT,
          polygon: FRAME,
          seats: {
            create: generated.map((s) => ({
              rowLabel: s.rowLabel,
              seatNumber: s.seatNumber,
            })),
          },
        },
      },
    },
    select: { id: true, zones: { select: { id: true } } },
  });
  const concertId = concert.id.toString();
  const zoneId = concert.zones[0].id;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: REAL_UA,
    viewport: { width: 1440, height: 1000 },
    locale: "th-TH",
  });
  const page = await context.newPage();
  let orderId: string | null = null;
  let queueToken: string | null = null;

  try {
    console.log(`\n🧪 ผังที่นั่งฝั่งคนซื้อ (concert ${concertId})\n`);

    // ---------- 1) login + ผ่านคิว ----------
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/login"), {
      timeout: 20_000,
    });
    check("login ผู้ซื้อสำเร็จ", !page.url().includes("/login"));

    // ---------- 1.5) เตรียม token คิวที่ถูก admit ----------
    // ⚠️ ตั้งใจ "ไม่" เดินผ่านหน้าห้องรอในเบราว์เซอร์ เพราะหน้านั้นมี Turnstile ของจริง
    //    การไปแก้/ผ่าน CAPTCHA ด้วยสคริปต์คือสิ่งที่ระบบนี้ทั้งระบบสร้างมาเพื่อกัน
    //    -> สร้างเงื่อนไขตั้งต้นผ่าน API ของระบบเอง (joinQueue + admitNext) แทน
    //    ด่านคิว/Turnstile มีเทสของตัวเองอยู่แล้ว เทสนี้โฟกัสที่ "ผังที่นั่ง" ล้วน ๆ
    const buyer = await prisma.user.findUniqueOrThrow({
      where: { email: EMAIL },
      select: { id: true },
    });
    const joined = await joinQueue({ concertId, userId: buyer.id.toString() });
    queueToken = joined.token;
    const admitted = await admitNext(concertId, { batchSize: 5 });
    check(
      "เตรียม token คิวที่ถูก admit ได้",
      admitted > 0 && !!queueToken,
      `admitted=${admitted}`,
    );

    const seatsPageResponse = await page.goto(
      `${BASE}/concerts/${slug}/seats?qt=${queueToken}`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    const initialPayload = (await seatsPageResponse?.text()) ?? "";
    check(
      "เข้าหน้าเลือกที่นั่งได้ (ไม่ถูกเด้งกลับห้องรอ)",
      page.url().includes("/seats"),
      page.url(),
    );
    check(
      "payload หน้าแรกไม่มี rowLabel ของโซนนั่งหลุดมา",
      !initialPayload.includes("rowLabel"),
      `พบ rowLabel ใน payload=${initialPayload.includes("rowLabel")}`,
    );

    // ---------- 2) ต้องเป็นผัง SVG ระดับโซนบนรูปจริง ไม่ใช่ผังตารางเดิม ----------
    await page
      .locator('img[alt="ผังสถานที่จัดงาน"]')
      .waitFor({ timeout: 20_000 });
    const zoneShapes = await page
      .locator('svg[aria-label="ผังโซนที่นั่ง"] g[data-zone-name]')
      .count();
    check(
      "แสดงกรอบโซนทับรูปสถานที่จริง",
      zoneShapes === 1,
      `zones=${zoneShapes}`,
    );

    // เวทีคือคำถามหลักที่ผังนี้ต้องตอบ ("โซนนี้อยู่ตรงไหนของเวที") -> ต้องขึ้นจริง
    check(
      "แสดงกรอบเวทีบนผัง",
      (await page
        .locator('svg[aria-label="ผังโซนที่นั่ง"] g[data-stage]')
        .count()) === 1,
    );
    // ผังรุ่น drill-down ไม่มีรายการโซนใต้รูปแล้ว (user-test: รกเกินไป) — หน้ารวมต้องบอกวิธีใช้แทน
    check(
      "หน้ารวมบอกให้แตะโซนบนผัง (ไม่มีรายการโซนซ้ำใต้รูป)",
      (await page.locator("main").innerText()).includes("แตะโซนบนผังเพื่อเลือกที่นั่ง"),
    );

    // ผังรุ่นนี้ไม่โปรยจุดที่นั่งบนรูปแล้ว — ถ้ายังมี circle แปลว่าโค้ดเก่าหลุดกลับมา
    check(
      "ไม่มีจุดที่นั่งรายตัวบนรูปแล้ว",
      (await page.locator('svg[aria-label="ผังโซนที่นั่ง"] circle').count()) ===
        0,
    );

    // ยังไม่เลือกโซน -> ต้องยังไม่มีปุ่มที่นั่งให้กด (กันแผงเปิดค้างทุกโซนพร้อมกัน)
    check(
      "ยังไม่เลือกโซน → ยังไม่มีแผงเลือกที่นั่ง",
      (await page.locator("button[data-seat-number]").count()) === 0,
    );
    await page.screenshot({ path: ".shots/seatmap-buyer-1-map.png" });

    // ---------- 2.5) กดโซนบนรูป -> เข้าโซนแบบ "เลือกที่นั่งเอง" และกริดโหลดทันที (ค่าเริ่มต้นจาก user-test) ----------
    await page
      .locator('svg[aria-label="ผังโซนที่นั่ง"] g[data-zone-name]')
      .first()
      .click();
    const seatButtons = page.locator("button[data-seat-number]");
    await seatButtons.first().waitFor({ timeout: 10_000 });
    check(
      "เปิดโซนแล้วโหมดเริ่มต้นคือเลือกที่นั่งเอง (ไม่ต้องกดเพิ่ม)",
      (await page
        .getByRole("button", { name: "🪑 เลือกที่นั่งเอง" })
        .getAttribute("aria-pressed")) === "true",
    );
    check(
      "กดโซนบนผัง → เปิดแผงเลือกที่นั่งครบทุกที่",
      (await seatButtons.count()) === SEAT_COUNT,
      `seats=${await seatButtons.count()}`,
    );
    // ♿ ที่นั่งต้องเป็นปุ่มจริงที่คีย์บอร์ด/โปรแกรมอ่านหน้าจอเข้าถึงได้ (ของเดิมเป็นวงกลมใน SVG กดไม่ได้)
    check(
      "ที่นั่งเป็นปุ่มจริงที่มีชื่อให้โปรแกรมอ่านหน้าจอ",
      (await page
        .getByRole("button", { name: /^ที่นั่ง VIP ทดสอบ แถว A เลข 1$/ })
        .count()) === 1,
    );
    await page.screenshot({ path: ".shots/seatmap-buyer-1b-zone-open.png" });

    // ---------- 3) คอนเสิร์ตที่ยังไม่มีกรอบโซน ต้องถอยไปใช้ผังตารางเดิม ----------
    // เช็คก่อนซื้อ เพราะหลังสร้าง order แล้ว token คิวอาจใช้ไม่ได้อีก (จะกลายเป็นเทสที่เด้งไปหน้าคิวแทน)
    await prisma.$executeRaw`UPDATE zones SET polygon = NULL WHERE id = ${zoneId}`;
    await page.reload({ waitUntil: "domcontentloaded" });
    // ผังตารางเดิมเรนเดอร์ที่นั่งเป็น <button title="A1"> ที่ "ไม่มี" data-seat-number
    const fallbackButtons = await page
      .locator("main button[title]:not([data-seat-number])")
      .count();
    check(
      "โซนไม่มีกรอบ → ถอยไปใช้ผังตารางแบบเดิมอัตโนมัติ",
      fallbackButtons > 0,
      `buttons=${fallbackButtons}`,
    );
    check(
      "ไม่แสดงผัง SVG แล้วเมื่อข้อมูลไม่ครบ",
      (await page.locator('img[alt="ผังสถานที่จัดงาน"]').count()) === 0,
    );
    await page.screenshot({ path: ".shots/seatmap-buyer-3-fallback.png" });

    // คืนกรอบกลับ แล้วต้องกลับมาเป็นผัง SVG เหมือนเดิม
    await prisma.zone.update({
      where: { id: zoneId },
      data: { polygon: FRAME },
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .locator('img[alt="ผังสถานที่จัดงาน"]')
      .waitFor({ timeout: 20_000 });
    check("ใส่กรอบคืน → กลับมาเป็นผัง SVG", true);

    // ---------- 4) endpoint รายโซนต้องผูก auth + queue token ----------
    const zoneEndpoint = `${BASE}/api/concerts/${concertId}/zones/${zoneId}/seats`;
    const validZoneResponse = await page.request.get(
      `${zoneEndpoint}?qt=${encodeURIComponent(queueToken)}`,
    );
    const validZonePayload = (await validZoneResponse.json()) as {
      seats?: unknown[];
    };
    check(
      "endpoint รายโซน: queue token ถูกต้องได้ที่นั่ง",
      validZoneResponse.status() === 200 &&
        validZonePayload.seats?.length === SEAT_COUNT,
      `status=${validZoneResponse.status()} seats=${validZonePayload.seats?.length}`,
    );
    const invalidZoneResponse = await page.request.get(
      `${zoneEndpoint}?qt=token-มั่ว`,
    );
    check(
      "endpoint รายโซน: queue token มั่วถูกปฏิเสธ",
      invalidZoneResponse.status() === 403,
      `status=${invalidZoneResponse.status()}`,
    );

    // ---------- 5) โหมดระบบเลือกให้ (โหมดรอง): จำนวน 2 ต้องได้แถวหน้าสุดและติดกัน A1,A2 ----------
    await page
      .getByRole("button", { name: /VIP ทดสอบ/ })
      .first()
      .click();
    const bestModeButton = page.getByRole("button", {
      name: "⚡ ให้ระบบเลือกที่ดีที่สุดให้",
    });
    await bestModeButton.click();
    check(
      "สลับไปโหมดระบบเลือกให้ได้จากโหมดเลือกเอง",
      (await bestModeButton.getAttribute("aria-pressed")) === "true",
    );
    await page
      .getByRole("button", { name: "เพิ่มจำนวนที่นั่งที่ระบบเลือกให้" })
      .click();
    const bestSummary = await page.locator("main").innerText();
    check(
      "โหมดระบบเลือกให้สรุปจำนวน 2 และราคารวมถูกต้อง",
      bestSummary.includes("VIP ทดสอบ × 2 ที่ (ระบบเลือกให้)") &&
        bestSummary.includes("3,000"),
      bestSummary.slice(0, 240),
    );

    await page.getByRole("button", { name: /ดำเนินการชำระเงิน/ }).click();
    await page.waitForURL(/\/checkout\//, { timeout: 30_000 });
    orderId = page.url().split("/checkout/")[1]?.split(/[/?#]/)[0] ?? null;
    check(
      "โหมดระบบเลือกให้ → hold + สร้าง order → checkout",
      !!orderId,
      `orderId=${orderId}`,
    );

    if (orderId) {
      const order = await prisma.order.findUnique({
        where: { id: BigInt(orderId) },
        include: {
          items: {
            select: {
              seatId: true,
              seat: { select: { rowLabel: true, seatNumber: true } },
            },
          },
        },
      });
      const labels = (order?.items ?? [])
        .map((item) => `${item.seat.rowLabel}${item.seat.seatNumber}`)
        .sort();
      check(
        "DB: best-available ได้ที่นั่งแถวหน้าสุดติดกัน A1,A2",
        JSON.stringify(labels) === JSON.stringify(["A1", "A2"]),
        JSON.stringify(labels),
      );
    }

    // ---------- 6) โหมดเลือกเอง: fetch กริด เลือก 2 ที่ และใช้ทางเดินเงินเดิม ----------
    await page.goto(`${BASE}/concerts/${slug}/seats?qt=${queueToken}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("button", { name: /VIP ทดสอบ/ })
      .first()
      .click();
    await page.getByRole("button", { name: "🪑 เลือกที่นั่งเอง" }).click();
    await page
      .locator("button[data-seat-number]")
      .first()
      .waitFor({ timeout: 10_000 });
    for (let i = 0; i < SEATS_TO_PICK; i++) await pickSeat(page, i, i + 1);
    const chipCount = await page.locator('[aria-label^="เอาที่นั่ง"]').count();
    check(
      `เลือกที่นั่งได้ ${SEATS_TO_PICK} ที่ และขึ้นในแผงสรุป`,
      chipCount === SEATS_TO_PICK,
      `chips=${chipCount}`,
    );

    const summary = await page.locator("main").innerText();
    check(
      "แผงสรุปคิดราคารวมถูกต้อง",
      summary.includes("3,000"),
      summary.slice(0, 200),
    );
    await page.screenshot({ path: ".shots/seatmap-buyer-2-selected.png" });

    // 🔴 ทางเดินเงินเดิมต้องยังทำงาน: hold รายที่นั่ง + สร้าง order
    await page.getByRole("button", { name: /ดำเนินการชำระเงิน/ }).click();
    await page.waitForURL(/\/checkout\//, { timeout: 30_000 });
    orderId = page.url().split("/checkout/")[1]?.split(/[/?#]/)[0] ?? null;
    check(
      "กดจ่ายเงิน → hold ที่นั่ง + สร้าง order → เข้าหน้า checkout",
      !!orderId,
      `orderId=${orderId}`,
    );

    if (orderId) {
      const order = await prisma.order.findUnique({
        where: { id: BigInt(orderId) },
        include: { items: { select: { seatId: true } } },
      });
      check(
        "DB: order ผูกกับที่นั่งครบตามที่เลือก",
        order?.items.length === SEATS_TO_PICK,
        `items=${order?.items.length}`,
      );
      check(
        "DB: order เป็นของคอนเสิร์ตทดสอบนี้",
        order?.concertId === concert.id,
      );

      // hold จริงต้องอยู่ใน Redis ไม่ใช่แค่ DB
      const heldKeys = (order?.items ?? []).map(
        (i) => `seat:lock:${i.seatId.toString()}`,
      );
      const heldValues = heldKeys.length ? await redis.mget(...heldKeys) : [];
      check(
        "Redis: ที่นั่งถูกล็อกจริงครบทุกที่",
        heldValues.length > 0 && heldValues.every((v) => v !== null),
        JSON.stringify(heldValues),
      );
    }
  } catch (e) {
    fail++;
    console.error("\n💥 error:", (e as Error).message.split("\n")[0]);
    await page
      .screenshot({ path: ".shots/seatmap-buyer-ERROR.png" })
      .catch(() => {});
  } finally {
    await browser.close();

    // ---------- cleanup ----------
    // Order.concert / OrderItem.seat เป็น Restrict (ไม่ cascade) -> ต้องลบ order ก่อนลบคอนเสิร์ต
    try {
      const orders = await prisma.order.findMany({
        where: { concertId: concert.id },
        select: { id: true, items: { select: { seatId: true } } },
      });
      const seatIds = orders.flatMap((o) =>
        o.items.map((i) => i.seatId.toString()),
      );
      for (const o of orders) {
        await prisma.ticket.deleteMany({ where: { orderId: o.id } });
        await prisma.payment.deleteMany({ where: { orderId: o.id } });
        await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
        await prisma.order.delete({ where: { id: o.id } });
      }
      if (seatIds.length)
        await redis.del(...seatIds.map((s) => `seat:lock:${s}`));

      if (queueToken) await leaveQueue(queueToken);
      const user = await prisma.user.findUnique({
        where: { email: EMAIL },
        select: { id: true },
      });
      if (user) {
        await redis.del(
          `queue:${concert.id}:user:${user.id}`,
          `ratelimit:zone_seats:${concert.id}:user:${user.id}`,
        );
      }

      await prisma.concert.delete({ where: { id: concert.id } }); // cascade -> zones -> seats
      console.log("\n🧹 cleanup เสร็จ (ลบ order + คอนเสิร์ตทดสอบ + key Redis)");
    } catch (e) {
      console.error("⚠️ cleanup error:", (e as Error).message.split("\n")[0]);
    }

    await prisma.$disconnect();
    await redis.quit();
  }

  console.log(`\n📊 ผ่าน ${pass} / ตก ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main();
