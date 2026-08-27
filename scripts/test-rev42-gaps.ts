// ============================================================
// เทสเสริม rev 42 — เฉพาะช่องที่ test:staff-checkin (27 เช็ค) ยังไม่ครอบ
// ============================================================
// เขียนโดย session เทส (Opus, 2026-08-27) แล้วเก็บเข้า repo เป็น regression — รัน: pnpm test:rev42-gaps
//   G3 คือตัวที่จับบั๊ก High "ออฟไลน์เกินชุดแล้ววนยิง server ไม่หยุด" (59k คำขอ/3 นาที) ก่อน hotfix ใน components/ticket-entry-qr.tsx
// ต้องมี pnpm dev + docker DB + seed admin@local/user@local
//
// ครอบ:
//   G1 QR หมุนต่อได้ตอนออฟไลน์ และภาพที่โชว์ = ภาพที่ประตูคาดหวัง ณ วินาทีนั้น (byte ตรง)
//   G2 QR ที่หมุนมาเองตอนออฟไลน์ สแกนผ่านที่ประตูจริง
//   G3 ออฟไลน์นานเกินชุด (>5 นาที) → ป้ายเตือน + ต้องไม่ยิง server รัวเป็น loop
//   G4 ตั๋วงานที่ยังไม่ถึงเวลา (เร็วกว่า 12 ชม.) → ปฏิเสธ และไม่เผาตั๋ว
//   G5 งานที่จบไปนานแล้ว → ไม่โผล่ในตัวเลือกงาน + ยิงตรงยัง URL ก็ปฏิเสธ
//   G6 ตั๋วที่คืนแล้ว → ปฏิเสธ
//   G7 QR ของช่วงเก่า (แคปหน้าจอไว้ 2 นาที) → ปฏิเสธ
//   G8 เมนู "จุดเช็คอิน" ในหัวเว็บ: USER ไม่เห็น · STAFF เห็นหลังล็อกอินใหม่
import { chromium, type BrowserContext, type Page } from "playwright-core";
import crypto from "node:crypto";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma";
import { currentEntryCode, entryCodeForWindow, buildEntryQrText, ENTRY_CODE_WINDOW_MS } from "../lib/entry-code";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const EMAIL = process.env.E2E_USER_EMAIL ?? "user@local";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "Password123!";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}  ${extra}`);
  }
}

async function login(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
  return page;
}

const now = Date.now();
const stamp = `rev42gaps-${now}`;

// คอนเสิร์ต 1 งาน + 2 ที่นั่ง + ตั๋วจ่ายแล้วของ user@local
async function makeConcertWithTicket(
  title: string,
  slugSuffix: string,
  eventAtMs: number,
  userId: bigint,
  userName: string,
) {
  const concert = await prisma.concert.create({
    data: {
      title,
      slug: `${stamp}-${slugSuffix}`,
      description: "ทดสอบอัตโนมัติ (เทสเสริม rev 42)",
      venue: "โรงทดสอบ",
      eventAt: new Date(eventAtMs),
      saleStartAt: new Date(now - 3_600_000),
      saleEndAt: new Date(now + 3_600_000),
      status: "ON_SALE",
      maxTicketsPerUser: 4,
      zones: {
        create: {
          name: "โซนทดสอบ",
          price: 1,
          totalSeats: 2,
          color: "#ef4444",
          seats: {
            create: [
              { rowLabel: "A", seatNumber: 1, status: "SOLD" },
              { rowLabel: "A", seatNumber: 2, status: "SOLD" },
            ],
          },
        },
      },
    },
    select: { id: true, title: true, zones: { select: { seats: { select: { id: true } } } } },
  });
  const seats = concert.zones[0].seats;
  const order = await prisma.order.create({
    data: {
      userId,
      concertId: concert.id,
      totalAmount: 2,
      status: "PAID",
      paidAt: new Date(now),
      expiresAt: new Date(now + 3_600_000),
      items: { create: seats.map((s) => ({ seatId: s.id, price: 1, holderUserId: userId })) },
    },
    select: { id: true },
  });
  const tickets: { id: bigint; qrSecret: string }[] = [];
  for (const s of seats) {
    const qrSecret = crypto.randomBytes(32).toString("hex");
    const t = await prisma.ticket.create({
      data: {
        orderId: order.id,
        seatId: s.id,
        userId,
        qrCode: `GAPS-${crypto.randomBytes(8).toString("hex")}`,
        price: 1,
        holderName: userName,
        qrSecret,
      },
      select: { id: true },
    });
    tickets.push({ id: t.id, qrSecret });
  }
  return { concert, orderId: order.id, tickets };
}

async function main() {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: EMAIL },
    select: { id: true, role: true, name: true },
  });
  const userName = user.name ?? "ผู้ใช้ทดสอบ";
  const originalRole = user.role;

  // งาน G = อยู่ในกรอบสแกน (อีก 2 ชม.) · งาน F = เร็วเกินไป (อีก 20 ชม.) · งาน P = จบไปแล้ว (8 ชม.ก่อน)
  const G = await makeConcertWithTicket("งานทดสอบในกรอบ (G)", "g", now + 2 * 3_600_000, user.id, userName);
  const F = await makeConcertWithTicket("งานทดสอบเร็วเกินไป (F)", "f", now + 20 * 3_600_000, user.id, userName);
  const P = await makeConcertWithTicket("งานทดสอบจบไปแล้ว (P)", "p", now - 8 * 3_600_000, user.id, userName);
  // งาน L = ยังเลือกได้ตอนเปิดหน้า แต่จะ "เลยเวลาปิดสแกน" หลังจากนี้ 60 วิ
  //   → จำลอง จนท. เปิดจุดสแกนค้างไว้แล้วสแกนหลังปิดงาน (ทางเดียวที่สาขา too_late เข้าถึงได้จาก UI)
  const L = await makeConcertWithTicket("งานทดสอบกำลังจะปิด (L)", "l", now - 6 * 3_600_000 + 60_000, user.id, userName);
  const created = [G, F, P, L];

  const browser = await chromium.launch({ headless: true });
  try {
    console.log(`\n=== เทสเสริม rev 42 — G=${G.concert.id} F=${F.concert.id} P=${P.concert.id} ===\n`);

    console.log("[stage] G8");
    // ---------- G8a: USER ธรรมดา ไม่เห็นเมนู "จุดเช็คอิน" ----------
    await prisma.user.update({ where: { id: user.id }, data: { role: "USER" } });
    const userCtx = await browser.newContext({ userAgent: UA, locale: "th-TH", viewport: { width: 1280, height: 900 } });
    const userPage = await login(userCtx);
    await userPage.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await userPage.locator("header button").last().click();
    await userPage.waitForTimeout(500);
    // เมนูรายการเป็น role="menuitem" (ไม่ใช่ link) — ต้องยืนยันว่าเมนูเปิดจริงก่อน ไม่งั้น "ไม่เจอ" เป็นผลบวกลวง
    const userMenu = userPage.locator('[role="menu"]');
    const userMenuText = (await userMenu.count()) ? await userMenu.innerText() : "";
    check("G8a0 เมนูผู้ใช้เปิดได้จริง (มี 'ตั๋วของฉัน')", /ตั๋วของฉัน/.test(userMenuText), userMenuText.slice(0, 120));
    check("G8a USER ล็อกอินแล้ว เมนูผู้ใช้ไม่มี 'จุดเช็คอิน'", !/จุดเช็คอิน/.test(userMenuText));
    await userCtx.close();

    // ---------- G8b: แต่งตั้ง STAFF แล้วล็อกอินใหม่ → เมนูโผล่ ----------
    await prisma.user.update({ where: { id: user.id }, data: { role: "STAFF" } });
    const staffCtx = await browser.newContext({ userAgent: UA, locale: "th-TH", viewport: { width: 1280, height: 900 } });
    const page = await login(staffCtx);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.locator("header button").last().click();
    await page.waitForTimeout(500);
    const staffMenuText = (await page.locator('[role="menu"]').count())
      ? await page.locator('[role="menu"]').innerText()
      : "";
    const menuLink = page.getByRole("menuitem", { name: /จุดเช็คอิน/ });
    const menuShown = /จุดเช็คอิน/.test(staffMenuText);
    check("G8b STAFF ล็อกอินใหม่ → เมนู 'จุดเช็คอิน' โผล่ในเมนูผู้ใช้", menuShown, staffMenuText.slice(0, 160));
    if (menuShown) {
      await menuLink.first().click();
      await page.waitForURL(/\/staff\/checkin/, { timeout: 15_000 }).catch(() => {});
      check("G8c กดเมนูแล้วไปหน้าจุดเช็คอินจริง", /\/staff\/checkin/.test(page.url()), page.url());
    }

    console.log("[stage] G5a");
    // ---------- G5a: งานที่จบไปแล้ว ไม่โผล่ในตัวเลือกงาน ----------
    await page.goto(`${BASE}/staff/checkin`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /เช็คอินหน้างาน/ }).waitFor({ timeout: 15_000 });
    const optG = await page.locator("#gate-concert option", { hasText: "งานทดสอบในกรอบ (G)" }).count();
    const optP = await page.locator("#gate-concert option", { hasText: "งานทดสอบจบไปแล้ว (P)" }).count();
    check("G5a งานที่จบไปเกิน 6 ชม. ไม่โผล่ในตัวเลือกงาน (แต่งาน G โผล่)", optG === 1 && optP === 0, `G=${optG} P=${optP}`);

    // เปิดจุดสแกนของงาน L ค้างไว้ตั้งแต่ตอนที่ยังเลือกได้ — จะกลับมาสแกนทีหลังตอนเลยเวลาปิดแล้ว
    const lateTab = await staffCtx.newPage();
    await lateTab.goto(`${BASE}/staff/checkin?concert=${L.concert.id}`, { waitUntil: "domcontentloaded" });
    await lateTab.getByRole("heading", { name: /เช็คอินหน้างาน/ }).waitFor({ timeout: 15_000 });
    check(
      "G5d0 งาน L เปิดจุดสแกนได้ตอนยังไม่เลยเวลา (มีช่องสแกน)",
      (await lateTab.getByPlaceholder(/ยิงสแกนเนอร์ที่ช่องนี้/).count()) === 1,
    );

    // ---------- ตัวช่วยสแกน ----------
    async function scanAt(concertId: bigint, text: string) {
      await page.goto(`${BASE}/staff/checkin?concert=${concertId}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: /เช็คอินหน้างาน/ }).waitFor({ timeout: 15_000 });
      const input = page.getByPlaceholder(/ยิงสแกนเนอร์ที่ช่องนี้/);
      await input.fill(text);
      await input.press("Enter");
      const box = page.getByRole("alert").filter({ hasText: /ไม่ให้เข้า|ตั๋ว|รหัส|เวลา/ }).first();
      const ok = page.getByRole("status").filter({ hasText: /เช็คอินสำเร็จ/ });
      await Promise.race([
        box.waitFor({ timeout: 15_000 }).catch(() => {}),
        ok.waitFor({ timeout: 15_000 }).catch(() => {}),
      ]);
      await page.waitForTimeout(400);
      return (await page.locator("main").innerText()).replace(/\s+/g, " ");
    }
    const qrFor = (t: { id: bigint; qrSecret: string }, offsetWindows = 0) => {
      const idx = Math.floor(Date.now() / ENTRY_CODE_WINDOW_MS) + offsetWindows;
      return buildEntryQrText(t.id.toString(), entryCodeForWindow(t.qrSecret, idx));
    };

    console.log("[stage] G4");
    // ---------- G4: ตั๋วงานที่ยังไม่ถึงเวลา (เร็วกว่า 12 ชม.) ----------
    const t4 = F.tickets[0];
    const txt4 = await scanAt(F.concert.id, qrFor(t4));
    check("G4a ตั๋วงานที่เริ่มอีก 20 ชม. → ปฏิเสธ 'ยังไม่ถึงเวลาเปิดสแกน'", /ยังไม่ถึงเวลาเปิดสแกน/.test(txt4), txt4.slice(0, 220));
    const b4 = await prisma.ticket.findUniqueOrThrow({ where: { id: t4.id }, select: { checkedInAt: true } });
    check("G4b ปฏิเสธเพราะนอกเวลา → ไม่เผาตั๋ว", b4.checkedInAt === null);

    console.log("[stage] G5b");
    // ---------- G5b: งานที่จบไปแล้ว ยิง ?concert= ตรง ๆ → ประตูไม่ยอมเปิดเลย ----------
    await page.goto(`${BASE}/staff/checkin?concert=${P.concert.id}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /เช็คอินหน้างาน/ }).waitFor({ timeout: 15_000 });
    const pBody = await page.locator("main").innerText();
    check(
      "G5b งานจบไปแล้ว ยิง ?concert= ตรง ๆ → ประตูไม่เปิด (ไม่มีช่องสแกน + บอกให้เลือกงาน)",
      (await page.getByPlaceholder(/ยิงสแกนเนอร์ที่ช่องนี้/).count()) === 0 && /เลือกคอนเสิร์ต/.test(pBody),
      pBody.replace(/\s+/g, " ").slice(0, 200),
    );

    console.log("[stage] G6");
    // ---------- G6: ตั๋วที่คืนแล้ว ----------
    const t6 = G.tickets[1];
    await prisma.ticket.update({ where: { id: t6.id }, data: { returnedAt: new Date() } });
    const txt6 = await scanAt(G.concert.id, qrFor(t6));
    check("G6 ตั๋วที่คืนเข้าระบบแล้ว → ปฏิเสธ 'ถูกคืนเข้าระบบแล้ว'", /คืนเข้าระบบแล้ว/.test(txt6), txt6.slice(0, 220));

    console.log("[stage] G7");
    // ---------- G7: QR ของช่วงเก่า (แคปหน้าจอไว้ ~2 นาที) ----------
    const t7 = G.tickets[0];
    const txt7 = await scanAt(G.concert.id, qrFor(t7, -4)); // ย้อนหลัง 4 ช่วง = 2 นาที
    check("G7a QR ของ 2 นาทีก่อน → ปฏิเสธ 'รหัส QR หมดอายุ'", /หมดอายุ/.test(txt7), txt7.slice(0, 220));
    const b7 = await prisma.ticket.findUniqueOrThrow({ where: { id: t7.id }, select: { checkedInAt: true } });
    check("G7b QR หมดอายุ → ไม่เผาตั๋ว", b7.checkedInAt === null);

    console.log("[stage] G1 offline");
    // ---------- G1/G2/G3: หน้าตั๋วตอนออฟไลน์ ----------
    // ใช้ session เดิมของ staffCtx (คนเดียวกัน) แทนการล็อกอินใหม่ — ล็อกอินซ้ำ ๆ จะไปชน rate-limit 10 ครั้ง/15 นาที/อีเมล
    const holderCtx = await browser.newContext({
      userAgent: UA,
      locale: "th-TH",
      viewport: { width: 430, height: 900 },
      storageState: await staffCtx.storageState(),
    });
    const holder = await holderCtx.newPage();
    let actionCalls = 0;
    holder.on("request", (req) => {
      if (req.method() === "POST" && req.headers()["next-action"]) actionCalls++;
    });
    await holder.goto(`${BASE}/account/tickets`, { waitUntil: "domcontentloaded" });
    // ต้องเจาะจงใบของงาน G (หน้านี้โชว์ตั๋วทุกงาน) — t6 ถูกคืนไปแล้วจึงเหลือใบเดียวของงาน G คือ t7
    const qrImg = holder.locator(`img[alt*="งานทดสอบในกรอบ (G)"]`).first();
    await qrImg.waitFor({ timeout: 20_000 });
    check("G1a0 เล็งถูกใบ (ตั๋วงาน G เหลือใบเดียวหลังคืนอีกใบ)", (await holder.locator(`img[alt*="งานทดสอบในกรอบ (G)"]`).count()) === 1);
    await holder.waitForTimeout(1_500);
    const src0 = await qrImg.getAttribute("src");
    check("G1a หน้าตั๋วโหลดภาพ QR ได้ (ก่อนตัดเน็ต)", !!src0?.startsWith("data:image"));

    // ตัดเน็ต (โหมดเครื่องบิน) แล้วรอข้ามขอบช่วง 30 วิ
    await holderCtx.setOffline(true);
    const callsAtOffline = actionCalls;
    const { msLeft } = currentEntryCode(t7.qrSecret);
    await holder.waitForTimeout(msLeft + 3_000); // เข้าไป ~3 วิ ในช่วงใหม่
    const src1 = await qrImg.getAttribute("src");
    check("G1b ตัดเน็ตแล้ว QR ยังหมุนเป็นภาพใหม่", !!src1 && src1 !== src0);
    // ภาพที่โชว์ต้องเท่ากับภาพที่ประตูคาดหวัง ณ วินาทีนี้ (สร้างด้วย pipeline เดียวกับ server)
    const expected = await QRCode.toDataURL(buildEntryQrText(t7.id.toString(), currentEntryCode(t7.qrSecret).code), {
      width: 200,
      margin: 1,
    });
    check("G1c ภาพ QR ที่หมุนเองตอนออฟไลน์ = ภาพที่ประตูคาดหวัง (byte ตรง)", src1 === expected);
    check("G1d ยังไม่ติดป้าย 'ออฟไลน์' (ชุดยังเหลือ)", /QR หมุนอัตโนมัติ/.test(await holder.locator("body").innerText()));
    check("G1e หมุนเองโดยไม่ยิง server (ออฟไลน์อยู่)", actionCalls === callsAtOffline, `calls=${actionCalls} base=${callsAtOffline}`);

    // G2: เอา QR ที่หน้าจอโชว์อยู่ตอนออฟไลน์ ไปสแกนที่ประตูจริง
    const txt2 = await scanAt(G.concert.id, buildEntryQrText(t7.id.toString(), currentEntryCode(t7.qrSecret).code));
    check("G2 QR ที่หมุนเองตอนออฟไลน์ สแกนผ่านที่ประตูจริง (เขียว)", /เช็คอินสำเร็จ/.test(txt2), txt2.slice(0, 220));
    await prisma.ticket.update({ where: { id: t7.id }, data: { checkedInAt: null, checkedInById: null } });

    console.log("[stage] G3 burst");
    // ---------- G3: ออฟไลน์นานเกินชุด (>5 นาที) ----------
    // เลื่อนนาฬิกาในหน้าไปข้างหน้า 6 นาที (ไม่แตะ setTimeout) แล้วปลุก tick → เข้าสาขา "ชุดหมด"
    // นับจำนวนคำขอ "ในหน้า" ไม่ใช่ผ่าน event ของ Playwright — ถ้าเกิด loop จริง event จะท่วมช่อง CDP จนสั่งงานหน้าไม่ได้
    holder.removeAllListeners("request");
    await holder.evaluate(() => {
      const w = window as unknown as { __n: number };
      w.__n = 0;
      const orig = window.fetch;
      window.fetch = (...a: Parameters<typeof fetch>) => {
        w.__n++;
        return orig(...a);
      };
      const real = Date.now.bind(Date);
      Date.now = () => real() + 6 * 60 * 1000;
      window.dispatchEvent(new Event("focus"));
    });
    // หน้าตั๋วมี TicketEntryQr หลายตัว (ตั๋วหลายใบของ user@local ในเทสนี้) — แต่ละตัวมีชุดของตัวเอง
    //   จึงยิงได้ "ใบละ 1 ครั้ง" ตอนชุดหมด แล้วต้องเงียบจนถึงเวลา retry (backoff เริ่ม 10 วิ) — ก่อน hotfix วนยิง 59k/3 นาที
    const qrCount = await holder.locator('img[alt^="QR ตั๋ว"]').count();
    await holder.waitForTimeout(3_000);
    const burst = await holder.evaluate(() => (window as unknown as { __n: number }).__n);
    const bodyAfter = await holder.locator("body").innerText();
    check("G3a ออฟไลน์เกิน 5 นาที → ติดป้าย 'ออฟไลน์ — QR อาจหมดอายุ'", /ออฟไลน์/.test(bodyAfter), bodyAfter.slice(0, 200));
    check(
      "G3b ชุด QR หมดตอนออฟไลน์ → ต้องไม่ยิง server รัวเป็น loop (คาด ≤ 1 ครั้งต่อตั๋ว ใน 3 วิ)",
      burst <= Math.max(1, qrCount),
      `ยิงไป ${burst} ครั้งใน 3 วินาที / ตั๋วบนหน้า ${qrCount} ใบ`,
    );
    await holder.waitForTimeout(5_000);
    const burst8 = await holder.evaluate(() => (window as unknown as { __n: number }).__n);
    check(
      "G3b2 ระหว่างรอ backoff (วัดที่ 8 วิ) ต้องไม่ยิงเพิ่ม",
      burst8 <= Math.max(1, qrCount),
      `ยิงไป ${burst8} ครั้งใน 8 วินาที / ตั๋วบนหน้า ${qrCount} ใบ`,
    );
    // G3c: เน็ตกลับมาแล้ว QR ฟื้นเองได้มั้ย (loop ที่ยิงรัวไปแล้วอาจกิน rate-limit 30/นาที จนขอชุดใหม่ไม่ได้)
    await holderCtx.setOffline(false);
    // กันหน้าค้างจนสั่งงานไม่ได้ (ถ้า loop จริง คำสั่งผ่าน CDP อาจตอบช้ามาก) — ตัดจบที่ 25 วิ แล้วรายงานตามที่เห็น
    const recovered = await Promise.race([
      (async () => {
        await holder.evaluate(() => window.dispatchEvent(new Event("online")));
        await holder.waitForTimeout(8_000);
        return !/ออฟไลน์/.test(await holder.locator("body").innerText());
      })(),
      new Promise<null>((r) => setTimeout(() => r(null), 25_000)),
    ]);
    check(
      "G3c เน็ตกลับมา → หน้าตั๋วฟื้นเอง (ป้ายออฟไลน์หาย)",
      recovered === true,
      recovered === null ? "หน้าไม่ตอบสนองภายใน 25 วิ (หน้าค้างเพราะ loop)" : "ยังติดป้ายออฟไลน์",
    );
    await holderCtx.close();

    console.log("[stage] G5d late gate");
    // ---------- G5d: จุดสแกนที่เปิดค้างไว้ พอเลยเวลาปิดงานแล้วต้องปฏิเสธ ----------
    const msPastClose = Date.now() - (now + 60_000);
    if (msPastClose < 0) await lateTab.waitForTimeout(-msPastClose + 2_000);
    const lateInput = lateTab.getByPlaceholder(/ยิงสแกนเนอร์ที่ช่องนี้/);
    await lateInput.fill(qrFor(L.tickets[0]));
    await lateInput.press("Enter");
    // อย่ารอ role=alert เฉย ๆ — Next มี route-announcer เป็น alert ว่างอยู่แล้ว ต้อง filter ข้อความจริง
    await lateTab
      .getByRole("alert")
      .filter({ hasText: /ไม่ให้เข้า|เวลา|ตั๋ว|รหัส/ })
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
    await lateTab.waitForTimeout(400);
    const lateTxt = (await lateTab.locator("main").innerText()).replace(/\s+/g, " ");
    check("G5d จุดสแกนเปิดค้างไว้ พอเลยเวลาปิดงาน → ปฏิเสธ 'เลยเวลาเช็คอิน'", /เลยเวลาเช็คอิน/.test(lateTxt), lateTxt.slice(0, 220));
    const bL = await prisma.ticket.findUniqueOrThrow({ where: { id: L.tickets[0].id }, select: { checkedInAt: true } });
    check("G5e ปฏิเสธเพราะเลยเวลา → ไม่เผาตั๋ว", bL.checkedInAt === null);

    await staffCtx.close();
  } finally {
    await browser.close();
    await prisma.user.update({ where: { id: user.id }, data: { role: originalRole } });
    for (const c of created) {
      await prisma.ticket.deleteMany({ where: { id: { in: c.tickets.map((t) => t.id) } } });
      await prisma.orderItem.deleteMany({ where: { orderId: c.orderId } });
      await prisma.order.deleteMany({ where: { id: c.orderId } });
      await prisma.seat.deleteMany({ where: { zone: { concertId: c.concert.id } } });
      await prisma.zone.deleteMany({ where: { concertId: c.concert.id } });
      await prisma.concert.deleteMany({ where: { id: c.concert.id } });
    }
    await prisma.$disconnect();
  }

  console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ผ่าน ${pass} / ไม่ผ่าน ${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
