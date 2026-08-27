// ============================================================
// Probe: หน้าตั๋วตอนเน็ตหายยาว ๆ แล้วเน็ตกลับ (rev 42) — รันมือ ไม่เข้า CI
// ============================================================
// รัน:  pnpm probe:offline-loop        (หรือ npx tsx --env-file=.env scripts/probe-offline-loop.ts)
// ต้องมี: pnpm dev (พอร์ต 3000) + docker DB/Redis + seed `user@local` · ส่ง E2E_BASE ถ้าใช้พอร์ตอื่น
// ใช้เวลา ~7 นาที (ตัดเน็ตจริง 6 นาที + วัดช่วงเน็ตกลับ 45 วิ) — จงใจไม่ย่อเวลา เพราะบั๊กที่ probe นี้จับ
//   โผล่เฉพาะเมื่อเวลาเดินจริงจนชุด QR ล่วงหน้า (10 ช่วง × 30 วิ = 5 นาที) หมดลง
//
// ที่มา (2026-08-27): rev 42 เดิม พอ fetch ล้มตอนออฟไลน์แล้วเรียก tick ต่อทันที และ tick ล้างนาฬิกา retry
//   ที่เพิ่งตั้ง → วนยิง getEntryCodes ไม่มีดีเลย์ วัดได้ 59,153 คำขอใน 3 นาทีจากแท็บเดียว แล้วหน้าค้าง
//   หลังแก้ (backoff 10→120 วิ + fetch ที่ล้มไม่ปลุก tick + generation counter) เหลือหลักหน่วย
//
// เกณฑ์ผ่าน:
//   1. ออฟไลน์นาทีที่ 1-3 ต้องยิง server 0 ครั้ง (ชุดที่ขอล่วงหน้าไว้ครอบคลุมอยู่)
//   2. ตลอด 6 นาทีที่ออฟไลน์ ต้องยิงรวมไม่เกิน 8 ครั้ง/ใบ (ตาม backoff 10/20/40/80/120 วิ)
//   3. เน็ตกลับ → ป้ายใต้ QR ต้องเป็น "QR หมุนอัตโนมัติ" ภายใน 10 วินาที
//   4. ทุกจุดวัดหลังเน็ตกลับ ภาพ QR ต้องตรงกับภาพที่ประตูคาดหวัง ณ วินาทีนั้นแบบ byte ตรง
//
// ⚠️ อ่านป้ายจาก element <p> เท่านั้น ห้ามใช้ body.innerText — พิสูจน์แล้วว่าให้ผลบวกลวง
//    (หน้าที่ผ่านช่วงออฟไลน์มา body.innerText ยังมีคำว่า "ออฟไลน์" ค้างทั้งที่ <p> เปลี่ยนไปแล้ว)
import { chromium } from "playwright-core";
import crypto from "node:crypto";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma";
import { currentEntryCode, buildEntryQrText } from "../lib/entry-code";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const EMAIL = process.env.E2E_USER_EMAIL ?? "user@local";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "Password123!";

const OFFLINE_MINUTES = 6; // ต้องเกิน 5 นาที เพื่อให้ชุด QR ล่วงหน้าหมดจริง
const MAX_OFFLINE_CALLS_PER_TICKET = 8; // เพดานตามจังหวะ backoff
const BADGE_OK = "QR หมุนอัตโนมัติ";
const BADGE_OFFLINE = "ออฟไลน์";

interface PageSnapshot {
  badge: string;
  calls: number;
  src: string;
  tickets: number;
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: EMAIL },
    select: { id: true, name: true },
  });
  const now = Date.now();
  const qrSecret = crypto.randomBytes(32).toString("hex");

  // fixture: คอนเสิร์ต 1 ที่นั่ง + ตั๋วจ่ายแล้วของ user@local (ลบทิ้งใน finally)
  const concert = await prisma.concert.create({
    data: {
      title: "งานทดสอบ probe เน็ตหาย",
      slug: `probe-offline-${now}`,
      description: "probe อัตโนมัติ",
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
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      concertId: concert.id,
      totalAmount: 1,
      status: "PAID",
      paidAt: new Date(now),
      expiresAt: new Date(now + 3_600_000),
      items: { create: { seatId, price: 1, holderUserId: user.id } },
    },
    select: { id: true },
  });
  const ticket = await prisma.ticket.create({
    data: {
      orderId: order.id,
      seatId,
      userId: user.id,
      qrCode: `PROBE-${crypto.randomBytes(8).toString("hex")}`,
      price: 1,
      holderName: user.name ?? "ผู้ใช้ทดสอบ",
      qrSecret,
    },
    select: { id: true },
  });

  const browser = await chromium.launch({ headless: true });
  try {
    console.log(`\n=== probe: หน้าตั๋วตอนเน็ตหาย ${OFFLINE_MINUTES} นาที (${BASE}) ===\n`);
    const ctx = await browser.newContext({ locale: "th-TH", viewport: { width: 430, height: 900 } });
    const page = await ctx.newPage();

    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    await page.goto(`${BASE}/account/tickets`, { waitUntil: "domcontentloaded" });
    await page.locator('img[alt^="QR ตั๋ว"]').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1_500);

    // นับคำขอ "ในหน้า" — ห้ามใช้ page.on("request") เพราะถ้าเกิด loop จริง event จะท่วมช่องสั่งงาน
    // จน Playwright คุมหน้าไม่ได้ (เจอมาแล้วตอนไล่บั๊กเดิม)
    await page.evaluate(() => {
      const w = window as unknown as { __probeCalls: number };
      w.__probeCalls = 0;
      const orig = window.fetch;
      window.fetch = (...a: Parameters<typeof fetch>) => {
        w.__probeCalls++;
        return orig(...a);
      };
    });

    // อ่านสถานะหน้าแบบที่เชื่อได้: ป้ายจาก <p>, ภาพจาก img, ตัวนับจาก window
    const snapshot = (): Promise<PageSnapshot> =>
      page.evaluate(() => {
        const w = window as unknown as { __probeCalls?: number };
        const img = document.querySelector('img[alt^="QR ตั๋ว"]') as HTMLImageElement | null;
        const badge =
          Array.from(document.querySelectorAll("p"))
            .map((el) => (el as HTMLElement).innerText.trim())
            .find((t) => /ออฟไลน์|QR หมุนอัตโนมัติ/.test(t)) ?? "(ไม่พบป้าย)";
        return {
          badge,
          calls: w.__probeCalls ?? -1,
          src: img?.src ?? "",
          tickets: document.querySelectorAll('img[alt^="QR ตั๋ว"]').length,
        };
      });

    const start = await snapshot();
    // หน้านี้โชว์ตั๋วทุกใบของบัญชี — ต้องหารตามจำนวนใบ ไม่งั้นยอดรวมจะโตโดยไม่ได้แปลว่ามี loop
    const perTicket = Math.max(1, start.tickets);
    console.log(`ตั๋วบนหน้า ${start.tickets} ใบ · ป้ายเริ่มต้น "${start.badge}"\n`);

    // ---------- ช่วงตัดเน็ต ----------
    await ctx.setOffline(true);
    const baseCalls = start.calls;
    let prev = baseCalls;
    let firstThreeMinutes = 0;
    for (let m = 1; m <= OFFLINE_MINUTES; m++) {
      await page.waitForTimeout(60_000);
      const s = await snapshot();
      const added = s.calls - prev;
      prev = s.calls;
      if (m <= 3) firstThreeMinutes += added;
      console.log(
        `  ออฟไลน์นาทีที่ ${m}: +${added} คำขอ (${(added / perTicket).toFixed(1)}/ใบ) · ป้าย "${s.badge}"`,
      );
    }
    const offlineTotal = prev - baseCalls;
    console.log("");
    check("1. นาทีที่ 1-3 ไม่ยิง server เลย (ชุดล่วงหน้าครอบคลุม)", firstThreeMinutes === 0, `ยิงไป ${firstThreeMinutes}`);
    check(
      `2. ตลอด ${OFFLINE_MINUTES} นาทีที่ออฟไลน์ ยิงไม่เกิน ${MAX_OFFLINE_CALLS_PER_TICKET} ครั้ง/ใบ`,
      offlineTotal / perTicket <= MAX_OFFLINE_CALLS_PER_TICKET,
      `ยิงไป ${offlineTotal} ครั้ง (${(offlineTotal / perTicket).toFixed(1)}/ใบ)`,
    );

    // ---------- เน็ตกลับ ----------
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(10_000);
    const recovered = await snapshot();
    check(
      `3. เน็ตกลับ → ป้ายเปลี่ยนจาก "${BADGE_OFFLINE}…" เป็น "${BADGE_OK}" ภายใน 10 วินาที`,
      recovered.badge === BADGE_OK,
      `ป้าย "${recovered.badge}"`,
    );

    // ภาพต้องตรงกับที่ประตูคาดหวัง — วัดข้ามขอบช่วง 30 วิ อย่างน้อย 1 ครั้ง
    let mismatched = 0;
    for (let i = 1; i <= 3; i++) {
      const s = await snapshot();
      const expected = await QRCode.toDataURL(
        buildEntryQrText(ticket.id.toString(), currentEntryCode(qrSecret).code),
        { width: 200, margin: 1 },
      );
      if (s.src !== expected) mismatched++;
      console.log(`  หลังเน็ตกลับ +${i * 12} วิ: ป้าย "${s.badge}" · QR ${s.src === expected ? "ตรง" : "ไม่ตรง"}`);
      if (i < 3) await page.waitForTimeout(12_000);
    }
    check("4. ภาพ QR ตรงกับที่ประตูคาดหวังทุกจุดวัด (byte ตรง)", mismatched === 0, `ไม่ตรง ${mismatched} จุด`);

    await ctx.close();
  } finally {
    await browser.close();
    // probe นี้ไม่แตะ role ของผู้ใช้ (ไม่ต้องรีเซ็ต) — ลบเฉพาะ fixture ที่สร้างเอง
    await prisma.ticket.deleteMany({ where: { id: ticket.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.deleteMany({ where: { id: order.id } });
    await prisma.seat.deleteMany({ where: { zone: { concertId: concert.id } } });
    await prisma.zone.deleteMany({ where: { concertId: concert.id } });
    await prisma.concert.deleteMany({ where: { id: concert.id } });
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "OK" : "FAILED"} — ไม่ผ่าน ${failures} ข้อ\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
