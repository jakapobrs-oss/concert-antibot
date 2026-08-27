// ============================================================
// Integration (real browser, fake camera) — กล้องสแกนที่จุดเช็คอิน อ่าน QR แล้วเช็คอินให้เองจริงไหม (rev 42)
// ============================================================
// รัน: pnpm test:camera-scan   (ต้อง pnpm dev + pnpm db:up + seed admin@local/user@local)
//
// ทำไมต้องมี: test:staff-checkin พิสูจน์ได้แค่ "ไลบรารีกล้องโหลดได้และฟ้อง error ถูก" (headless ไม่มีกล้อง)
//   แต่ไม่เคยพิสูจน์ว่า "ภาพ QR เข้ากล้อง → ถอดรหัส → checkInTicket → เขียว" ทั้งสาย — user ลองบน iPhone แล้ว
//   "กล้องเปิดแต่ไม่สแกน" (2026-08-27) จึงต้องแยกให้ออกว่าสายถอดรหัสใน bundle พังหรือเป็นเรื่องของ Safari/ขนาด QR
// วิธี: สร้างไฟล์วิดีโอ .y4m ที่มี QR ของตั๋ว (code ของช่วงเวลาปัจจุบัน) แล้วสั่ง Chromium ใช้เป็นกล้องปลอม
//   (--use-fake-device-for-media-stream + --use-file-for-fake-video-capture) → กด "เปิดกล้อง" แล้วรอผลบนหน้าจอ
// ข้อจำกัด: พิสูจน์บน Chromium (Blink) เท่านั้น — Safari/iOS ต้องลองบนเครื่องจริง
import { chromium } from "playwright-core";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma";
import { currentEntryCode, buildEntryQrText } from "../lib/entry-code";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const STAFF_EMAIL = process.env.E2E_USER_EMAIL ?? "user@local";
const STAFF_PASSWORD = process.env.E2E_USER_PASSWORD ?? "Password123!";
const UA =
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

// วิดีโอ Y4M (I420) 640×480 พื้นขาว มี QR ตรงกลางขนาด ~qrSize px — Chromium วนเล่นซ้ำให้เอง
function makeQrY4m(text: string, opts: { w?: number; h?: number; qrSize?: number; frames?: number } = {}): Buffer {
  const w = opts.w ?? 640;
  const h = opts.h ?? 480;
  const qrSize = opts.qrSize ?? 320;
  const frames = opts.frames ?? 30;
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const scale = Math.max(1, Math.floor(qrSize / n));
  const px = n * scale;
  const ox = Math.floor((w - px) / 2);
  const oy = Math.floor((h - px) / 2);
  const Y = Buffer.alloc(w * h, 235); // ขาว (Y ช่วง 16–235)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      for (let dy = 0; dy < scale; dy++) {
        const row = oy + r * scale + dy;
        Y.fill(16, row * w + ox + c * scale, row * w + ox + (c + 1) * scale);
      }
    }
  }
  const U = Buffer.alloc((w / 2) * (h / 2), 128);
  const V = Buffer.alloc((w / 2) * (h / 2), 128);
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), Y, U, V]);
  return Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]);
}

async function main() {
  const staff = await prisma.user.findUniqueOrThrow({
    where: { email: STAFF_EMAIL },
    select: { id: true, role: true, name: true },
  });
  const prevRole = staff.role;

  // ---------- fixture: คอน + ตั๋วจ่ายแล้วของ user@local (ให้ user@local เป็นทั้งผู้ถือและ จนท. — ไม่มีกติกาห้าม) ----------
  const now = Date.now();
  const slug = `camera-scan-${now}`;
  const concert = await prisma.concert.create({
    data: {
      title: "คอนเสิร์ตทดสอบกล้องสแกน",
      slug,
      description: "ทดสอบอัตโนมัติ",
      venue: "โรงทดสอบ",
      eventAt: new Date(now + 2 * 3_600_000),
      saleStartAt: new Date(now - 3_600_000),
      saleEndAt: new Date(now + 3_600_000),
      status: "ON_SALE",
      maxTicketsPerUser: 4,
      zones: {
        create: {
          name: "โซนทดสอบ",
          price: 1,
          totalSeats: 1,
          color: "#ef4444",
          seats: { create: [{ rowLabel: "A", seatNumber: 1, status: "SOLD" }] },
        },
      },
    },
    select: { id: true, zones: { select: { seats: { select: { id: true } } } } },
  });
  const seatId = concert.zones[0].seats[0].id;
  const qrSecret = crypto.randomBytes(32).toString("hex");
  const order = await prisma.order.create({
    data: {
      userId: staff.id,
      concertId: concert.id,
      totalAmount: 1,
      status: "PAID",
      paidAt: new Date(now),
      expiresAt: new Date(now + 3_600_000),
      items: { create: { seatId, price: 1, holderUserId: staff.id } },
    },
    select: { id: true },
  });
  const ticket = await prisma.ticket.create({
    data: {
      orderId: order.id,
      seatId,
      userId: staff.id,
      qrCode: `CAM-${crypto.randomBytes(8).toString("hex")}`,
      price: 1,
      holderName: staff.name ?? "ผู้ใช้ทดสอบ",
      qrSecret,
    },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: staff.id }, data: { role: "STAFF" } });

  // QR ของช่วงเวลาปัจจุบัน — ตัวตรวจรับ ±1 ช่วง (30 วิ) จึงต้องสแกนให้ทันภายใน ~60 วิ หลังสร้างไฟล์
  const qrText = buildEntryQrText(ticket.id.toString(), currentEntryCode(qrSecret).code);
  const y4mPath = path.join(os.tmpdir(), `concert-qr-${now}.y4m`);
  fs.writeFileSync(y4mPath, makeQrY4m(qrText));

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${y4mPath}`,
    ],
  });
  try {
    console.log(`\n🧪 กล้องสแกนที่จุดเช็คอิน (concert ${concert.id}, ticket ${ticket.id}, QR=${qrText})\n`);
    const ctx = await browser.newContext({
      userAgent: UA,
      locale: "th-TH",
      viewport: { width: 1280, height: 900 },
      permissions: ["camera"],
    });
    const page = await ctx.newPage();
    // NO_BARCODE_DETECTOR=1 → บังคับให้ qr-scanner ใช้สาย Web Worker (สายที่ Safari/iOS ต้องใช้จริง เพราะไม่มี BarcodeDetector)
    if (process.env.NO_BARCODE_DETECTOR === "1") {
      await page.addInitScript(() => {
        // ต้อง delete จริง — ไลบรารีเช็ค `'BarcodeDetector' in window` ก่อนเรียก getSupportedFormats (ตั้งเป็น undefined จะพัง)
        delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
      });
      console.log("  (โหมดปิด BarcodeDetector — เดินสาย worker)");
    }
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#email", STAFF_EMAIL);
    await page.fill("#password", STAFF_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    await page.goto(`${BASE}/staff/checkin?concert=${concert.id}`, { waitUntil: "domcontentloaded" });
    const camBtn = page.getByRole("button", { name: /เปิดกล้อง/ });
    await camBtn.waitFor({ timeout: 20_000 });
    await camBtn.click();
    const closeBtn = page.getByRole("button", { name: /ปิดกล้อง/ });
    const camOn = await closeBtn.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    check("1 กล้อง (ปลอม) เปิดได้ — ปุ่มเปลี่ยนเป็น 'ปิดกล้อง'", camOn);

    await page.waitForTimeout(1_500);
    const videoState = await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('video[aria-label="ภาพจากกล้องสำหรับสแกน QR"]');
      return v
        ? { w: v.videoWidth, h: v.videoHeight, paused: v.paused, ready: v.readyState, hasStream: !!v.srcObject }
        : null;
    });
    // ข้อมูลประกอบ (ไม่นับผ่าน/ตก): กล้องปลอมของ Chromium บางเวอร์ชันรายงาน videoWidth 0 ทั้งที่ถอดรหัสได้ — ตัวตัดสินจริงคือข้อ 3
    console.log(`  ℹ video: ${JSON.stringify(videoState)}`);
    check("2 <video> ผูกสตรีมกล้องแล้ว (srcObject)", !!videoState?.hasStream, JSON.stringify(videoState));

    const okBox = page.getByRole("status").filter({ hasText: /เช็คอินสำเร็จ/ });
    const scanned = await okBox.waitFor({ timeout: 25_000 }).then(() => true).catch(() => false);
    const bodyText = await page.locator("body").innerText();
    check("3 กล้องอ่าน QR แล้วเช็คอินให้เอง → 'เช็คอินสำเร็จ' + ชื่อผู้ถือ", scanned && bodyText.includes(staff.name ?? "ผู้ใช้ทดสอบ"), bodyText.slice(0, 300));
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, select: { checkedInAt: true, checkedInById: true } });
    check("4 DB: checkedInAt + checkedInById = เจ้าหน้าที่", !!after.checkedInAt && after.checkedInById === staff.id);
    check("5 ไม่มี console error ระหว่างสแกน", consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 300));

    // QR ใบเดิมยังอยู่หน้ากล้อง → ต้องไม่ยิงซ้ำ/พลิกแดงภายในหน้าต่างกันซ้ำ 20 วิ
    await page.waitForTimeout(6_000);
    const stillGreen = (await okBox.count()) === 1;
    check("6 QR เดิมค้างหน้ากล้อง 6 วิ → ยังเขียว ไม่พลิกเป็น 'เช็คอินไปแล้ว'", stillGreen);

    await ctx.close();
  } finally {
    await browser.close();
    fs.rmSync(y4mPath, { force: true });
    await prisma.user.update({ where: { id: staff.id }, data: { role: prevRole } });
    await prisma.ticket.deleteMany({ where: { id: ticket.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.deleteMany({ where: { id: order.id } });
    await prisma.seat.deleteMany({ where: { zone: { concertId: concert.id } } });
    await prisma.zone.deleteMany({ where: { concertId: concert.id } });
    await prisma.concert.deleteMany({ where: { id: concert.id } });
    await prisma.$disconnect();
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ผ่าน ${pass} / ไม่ผ่าน ${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
