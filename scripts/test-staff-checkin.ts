// ============================================================
// Integration (real browser + real DB) — เจ้าหน้าที่หน้างาน (role STAFF) + จุดสแกน /staff/checkin (rev 42)
// ============================================================
// รัน: pnpm test:staff-checkin   (ต้อง pnpm dev + pnpm db:up อยู่ · ต้องมี admin@local / user@local จาก pnpm db:seed)
//
// พิสูจน์ (ผ่าน UI จริงทั้งหมด ยกเว้น fixture ตั๋วที่สร้างตรงใน DB เพราะจ่ายเงินจริงบนเครื่อง dev ไม่ได้):
//   1. USER เข้า /staff/checkin และ /admin ไม่ได้ (เด้งหน้าแรก)
//   2. แอดมินแต่งตั้ง user@local เป็น STAFF จากหน้า /admin/staff · แต่งตั้งบัญชีแอดมินไม่ได้
//   3. STAFF เปิด /staff/checkin ได้ทันที "โดยไม่ต้องล็อกอินใหม่" (JWT ยัง USER — layout เช็ค DB)
//      · แผงกล้องโหลด (กด "เปิดกล้อง" ใน headless → ข้อความผิดพลาดที่อ่านรู้เรื่อง ไม่พัง)
//      · วางข้อความ QR → เช็คอินสำเร็จ + ชื่อผู้ถือ · ซ้ำ → ปฏิเสธ · ข้อความมั่ว → ปฏิเสธ
//      · DB บันทึก checkedInById = เจ้าหน้าที่คนที่สแกน
//      · STAFF ยังเข้า /admin ไม่ได้
//   4. หน้า /admin/staff นับ "สแกนแล้ว 1 ใบ" · ถอนสิทธิ์ → มีผลทันที (เปิด /staff/checkin ถูกเด้ง)
//   5. หน้าตั๋ว: ขอภาพ QR เป็นชุดครั้งเดียว แล้วภาพเปลี่ยนเองเมื่อข้ามช่วง 30 วิ โดยไม่ยิง server ซ้ำ
import { chromium, type BrowserContext, type Page } from "playwright-core";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { currentEntryCode, buildEntryQrText, ENTRY_CODE_WINDOW_MS } from "../lib/entry-code";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin123!";
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

async function login(ctx: BrowserContext, email: string, password: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
  return page;
}

async function main() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, select: { id: true, role: true } });
  const staff = await prisma.user.findUniqueOrThrow({
    where: { email: STAFF_EMAIL },
    select: { id: true, role: true, name: true },
  });
  if (admin.role !== "ADMIN") throw new Error(`${ADMIN_EMAIL} ต้องเป็น ADMIN (รัน pnpm db:seed)`);
  // เริ่มจาก USER เสมอ — ถ้ารอบก่อนพังค้าง STAFF ไว้ ให้รีเซ็ตก่อน
  if (staff.role !== "USER") await prisma.user.update({ where: { id: staff.id }, data: { role: "USER" } });

  // ---------- fixture: คอนเสิร์ต 1 ที่นั่ง + ตั๋วจ่ายแล้วของ user@local ----------
  const now = Date.now();
  const slug = `staff-checkin-${now}`;
  const concert = await prisma.concert.create({
    data: {
      title: "คอนเสิร์ตทดสอบจุดสแกน",
      slug,
      description: "ทดสอบอัตโนมัติ",
      venue: "โรงทดสอบ",
      // งานเริ่มอีก 2 ชม. — อยู่ในกรอบเปิดสแกน (CHECKIN_OPEN_BEFORE_HOURS ค่าเริ่มต้น 12) ของ lib/checkin-policy.ts
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
  // ประตูของ "อีกงาน" — ไว้พิสูจน์ว่าตั๋วของงาน A สแกนที่ประตูงาน B ต้องถูกปฏิเสธและไม่ถูกเผา (audit rev 42 High)
  const gateB = await prisma.concert.create({
    data: {
      title: "คอนเสิร์ตอีกงาน (ประตู B)",
      slug: `${slug}-b`,
      description: "ทดสอบอัตโนมัติ",
      venue: "โรงทดสอบ B",
      eventAt: new Date(now + 3 * 3_600_000),
      saleStartAt: new Date(now - 3_600_000),
      saleEndAt: new Date(now + 3_600_000),
      status: "ON_SALE",
      maxTicketsPerUser: 4,
    },
    select: { id: true },
  });
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
      qrCode: `E2E-${crypto.randomBytes(8).toString("hex")}`,
      price: 1,
      holderName: staff.name ?? "ผู้ใช้ทดสอบ",
      qrSecret,
    },
    select: { id: true },
  });
  const qrText = () => buildEntryQrText(ticket.id.toString(), currentEntryCode(qrSecret).code);

  const browser = await chromium.launch({ headless: true });
  try {
    console.log(`\n🧪 เจ้าหน้าที่หน้างาน + จุดสแกน (concert ${concert.id}, ticket ${ticket.id})\n`);

    const staffCtx = await browser.newContext({ userAgent: UA, locale: "th-TH", viewport: { width: 1280, height: 900 } });
    const adminCtx = await browser.newContext({ userAgent: UA, locale: "th-TH", viewport: { width: 1280, height: 900 } });

    // ---------- 1) USER ธรรมดา ----------
    const staffPage = await login(staffCtx, STAFF_EMAIL, STAFF_PASSWORD);
    await staffPage.goto(`${BASE}/staff/checkin`, { waitUntil: "domcontentloaded" });
    check("1a USER เปิด /staff/checkin → ถูกเด้งหน้าแรก", new URL(staffPage.url()).pathname === "/", staffPage.url());
    await staffPage.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    check("1b USER เปิด /admin → ถูกเด้งหน้าแรก", new URL(staffPage.url()).pathname === "/", staffPage.url());

    // ---------- 2) แอดมินแต่งตั้ง ----------
    const adminPage = await login(adminCtx, ADMIN_EMAIL, ADMIN_PASSWORD);
    await adminPage.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    check("2a แดชบอร์ดมีปุ่ม 'เจ้าหน้าที่หน้างาน'", (await adminPage.getByRole("link", { name: /เจ้าหน้าที่หน้างาน/ }).count()) > 0);
    await adminPage.goto(`${BASE}/admin/staff`, { waitUntil: "domcontentloaded" });
    const emailBox = adminPage.getByLabel("อีเมลเจ้าหน้าที่ที่จะแต่งตั้ง");
    await emailBox.fill(ADMIN_EMAIL);
    await adminPage.getByRole("button", { name: /แต่งตั้งเป็นเจ้าหน้าที่/ }).click();
    await adminPage.getByRole("status").waitFor({ timeout: 15_000 });
    check("2b แต่งตั้งบัญชีแอดมินไม่ได้", /แอดมิน/.test((await adminPage.getByRole("status").textContent()) ?? ""));
    await emailBox.fill(STAFF_EMAIL);
    await adminPage.getByRole("button", { name: /แต่งตั้งเป็นเจ้าหน้าที่/ }).click();
    await adminPage.getByText(/แต่งตั้งเป็นเจ้าหน้าที่แล้ว/).waitFor({ timeout: 15_000 });
    check("2c แต่งตั้ง user@local เป็น STAFF สำเร็จ (ข้อความบนหน้า)", true);
    await adminPage.reload({ waitUntil: "domcontentloaded" });
    check("2d ตารางเจ้าหน้าที่มีแถว user@local", (await adminPage.getByText(STAFF_EMAIL, { exact: true }).count()) > 0);
    const roleNow = await prisma.user.findUniqueOrThrow({ where: { id: staff.id }, select: { role: true } });
    check("2e DB role = STAFF", roleNow.role === "STAFF", roleNow.role);

    // ---------- 3) STAFF ใช้จุดสแกน (JWT ยังเป็น USER — ห้ามต้องล็อกอินใหม่) ----------
    await staffPage.goto(`${BASE}/staff/checkin`, { waitUntil: "domcontentloaded" });
    check("3a STAFF เปิด /staff/checkin ได้ทันทีโดยไม่ล็อกอินใหม่", new URL(staffPage.url()).pathname === "/staff/checkin", staffPage.url());
    await staffPage.getByRole("heading", { name: /เช็คอินหน้างาน/ }).waitFor({ timeout: 15_000 });
    // ยังไม่เลือกงาน → ไม่มีช่องสแกน (server ก็ปฏิเสธถ้าไม่มี concertId อยู่ดี)
    const noGateNotice = await staffPage.getByText(/เลือกคอนเสิร์ตด้านบนก่อน/).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
    check("3a2 ยังไม่เลือกงาน → มีข้อความให้เลือกก่อน และไม่มีช่องสแกน", noGateNotice && (await staffPage.getByPlaceholder(/ยิงสแกนเนอร์ที่ช่องนี้/).count()) === 0);
    check("3a3 ตัวเลือกงานมีคอนทดสอบ (อยู่ในกรอบเปิดสแกน)", (await staffPage.locator("#gate-concert option", { hasText: "คอนเสิร์ตทดสอบจุดสแกน" }).count()) === 1);
    await staffPage.goto(`${BASE}/staff/checkin?concert=${concert.id}`, { waitUntil: "domcontentloaded" });
    await staffPage.getByRole("heading", { name: /เช็คอินหน้างาน/ }).waitFor({ timeout: 15_000 });
    check("3a4 เลือกงานแล้ว แถบบอก 'กำลังสแกนงาน …' โชว์ชื่องาน", /กำลังสแกนงาน/.test(await staffPage.locator("body").innerText()));
    // แผงกล้องเป็น dynamic import (ssr:false) — โผล่หลัง hydrate ต้องรอ ไม่ใช่นับทันที
    const camBtn = staffPage.getByRole("button", { name: /เปิดกล้อง/ });
    const camReady = await camBtn.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    check("3b มีแผงกล้อง + ปุ่ม 'เปิดกล้อง' (dynamic import โหลดได้)", camReady);
    if (camReady) await camBtn.click();
    // หน้ามี role=alert ว่าง ๆ ของ Next (route announcer) อยู่ด้วย — ต้อง filter ข้อความ ไม่งั้น strict mode ชน
    const camAlert = staffPage.getByRole("alert").filter({ hasText: /กล้อง|https/ });
    await camAlert.waitFor({ timeout: 20_000 }).catch(() => {});
    const camMsg = (await camAlert.textContent().catch(() => "")) ?? "";
    check("3c headless ไม่มีกล้อง → ข้อความผิดพลาดที่อ่านรู้เรื่อง (ไลบรารีโหลดได้ ไม่พัง)", /กล้อง|https/.test(camMsg), camMsg);

    const input = staffPage.getByPlaceholder(/ยิงสแกนเนอร์ที่ช่องนี้/);
    await input.fill("hello");
    await input.press("Enter");
    await staffPage.getByRole("alert").filter({ hasText: /ไม่ให้เข้า/ }).waitFor({ timeout: 15_000 });
    check("3d ข้อความมั่ว → 'ไม่ให้เข้า' รูปแบบ QR ไม่ถูกต้อง", /รูปแบบ QR ไม่ถูกต้อง/.test(await staffPage.locator("body").innerText()));

    // ---------- ตั๋วงาน A ที่ประตูงาน B → ต้องปฏิเสธแบบ "คนละงาน" และไม่เผาตั๋ว ----------
    await staffPage.goto(`${BASE}/staff/checkin?concert=${gateB.id}`, { waitUntil: "domcontentloaded" });
    await staffPage.getByRole("heading", { name: /เช็คอินหน้างาน/ }).waitFor({ timeout: 15_000 });
    await input.fill(qrText());
    await input.press("Enter");
    const wrongGate = staffPage.getByRole("alert").filter({ hasText: /ตั๋วคนละงาน/ });
    const wrongGateShown = await wrongGate.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    const wrongGateText = wrongGateShown ? await wrongGate.innerText() : "";
    check("3d2 ตั๋วงาน A ที่ประตูงาน B → กล่องเหลือง 'ตั๋วคนละงาน' บอกชื่อทั้งสองงาน", wrongGateShown && /คอนเสิร์ตทดสอบจุดสแกน/.test(wrongGateText) && /ประตู B/.test(wrongGateText), wrongGateText);
    const notBurned = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, select: { checkedInAt: true } });
    check("3d3 สแกนผิดประตูไม่เผาตั๋ว (checkedInAt ยัง null)", notBurned.checkedInAt === null);
    await staffPage.goto(`${BASE}/staff/checkin?concert=${concert.id}`, { waitUntil: "domcontentloaded" });
    await staffPage.getByRole("heading", { name: /เช็คอินหน้างาน/ }).waitFor({ timeout: 15_000 });

    await input.fill(qrText());
    await input.press("Enter");
    await staffPage.getByRole("status").filter({ hasText: /เช็คอินสำเร็จ/ }).waitFor({ timeout: 15_000 });
    const okText = await staffPage.getByRole("status").filter({ hasText: /เช็คอินสำเร็จ/ }).innerText();
    check("3e QR จริง → เช็คอินสำเร็จ + ชื่อผู้ถือ", okText.includes(staff.name ?? "ผู้ใช้ทดสอบ"), okText);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, select: { checkedInAt: true, checkedInById: true } });
    check("3f DB: checkedInAt มีค่า + checkedInById = เจ้าหน้าที่ที่สแกน", !!after.checkedInAt && after.checkedInById === staff.id, String(after.checkedInById));

    await input.fill(qrText());
    await input.press("Enter");
    await staffPage.getByRole("alert").filter({ hasText: /เช็คอินไปแล้ว/ }).waitFor({ timeout: 15_000 });
    check("3g สแกนซ้ำ → 'เช็คอินไปแล้วเมื่อ …' ไม่ให้เข้าซ้ำ", true);

    await staffPage.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    check("3h STAFF เปิด /admin → ยังถูกเด้ง (เจ้าหน้าที่ไม่เห็นหน้าแอดมิน)", new URL(staffPage.url()).pathname === "/", staffPage.url());

    // ---------- 4) นับสแกน + ถอนสิทธิ์ ----------
    await adminPage.goto(`${BASE}/admin/staff`, { waitUntil: "domcontentloaded" });
    const rowText = await adminPage.locator("tr", { hasText: STAFF_EMAIL }).innerText();
    check("4a ตารางแสดง 'สแกนแล้ว 1 ใบ' ของ user@local", /1 ใบ/.test(rowText), rowText);
    await adminPage.locator("tr", { hasText: STAFF_EMAIL }).getByRole("button", { name: /ถอนสิทธิ์/ }).click();
    await adminPage.getByRole("button", { name: /ยืนยันถอน/ }).click();
    await adminPage.getByText(STAFF_EMAIL, { exact: true }).waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    const roleAfter = await prisma.user.findUniqueOrThrow({ where: { id: staff.id }, select: { role: true } });
    check("4b ถอนสิทธิ์ → DB role = USER", roleAfter.role === "USER", roleAfter.role);
    await staffPage.goto(`${BASE}/staff/checkin`, { waitUntil: "domcontentloaded" });
    check("4c ถอนแล้วเปิด /staff/checkin ถูกเด้งทันที (ไม่ต้องรอ JWT หมดอายุ)", new URL(staffPage.url()).pathname === "/", staffPage.url());

    // ---------- 5) หน้าตั๋ว: QR ล่วงหน้าเป็นชุด + หมุนเองไม่ยิง server ซ้ำ ----------
    await prisma.ticket.update({ where: { id: ticket.id }, data: { checkedInAt: null, checkedInById: null } });
    let actionCalls = 0;
    staffPage.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/account/tickets") && req.headers()["next-action"]) actionCalls++;
    });
    await staffPage.goto(`${BASE}/account/tickets`, { waitUntil: "domcontentloaded" });
    const qrImg = staffPage.locator(`img[alt^="QR ตั๋ว"]`).first();
    await qrImg.waitFor({ timeout: 20_000 });
    await staffPage.waitForTimeout(1_500);
    const src1 = await qrImg.getAttribute("src");
    check("5a หน้าตั๋วโชว์ภาพ QR (data URL) + ป้าย 'QR หมุนอัตโนมัติ'", !!src1?.startsWith("data:image") && /QR หมุนอัตโนมัติ/.test(await staffPage.locator("body").innerText()));
    const callsAfterLoad = actionCalls;
    check("5b ขอภาพเป็นชุดครั้งเดียวตอนโหลด", callsAfterLoad === 1, `calls=${callsAfterLoad}`);
    // รอข้ามขอบช่วง 30 วิ (ไม่รู้ว่าเหลืออีกเท่าไร → รอเต็มช่วง + เผื่อ)
    await staffPage.waitForTimeout(ENTRY_CODE_WINDOW_MS + 1_500);
    const src2 = await qrImg.getAttribute("src");
    check("5c ข้ามช่วง 30 วิ แล้วภาพ QR เปลี่ยน", !!src2 && src2 !== src1);
    check("5d หมุนเองโดยไม่ยิง server ซ้ำ (ใช้ภาพจากชุดที่ขอไว้)", actionCalls === callsAfterLoad, `calls=${actionCalls}`);

    await staffCtx.close();
    await adminCtx.close();
  } finally {
    await browser.close();
    // ---------- cleanup ----------
    await prisma.user.update({ where: { id: staff.id }, data: { role: "USER" } });
    await prisma.ticket.deleteMany({ where: { id: ticket.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.deleteMany({ where: { id: order.id } });
    await prisma.seat.deleteMany({ where: { zone: { concertId: concert.id } } });
    await prisma.zone.deleteMany({ where: { concertId: concert.id } });
    await prisma.concert.deleteMany({ where: { id: concert.id } });
    await prisma.concert.deleteMany({ where: { id: gateB.id } });
    await prisma.$disconnect();
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ผ่าน ${pass} / ไม่ผ่าน ${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
