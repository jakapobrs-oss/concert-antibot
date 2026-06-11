// ถ่าย screenshot ทุกหน้าหลัง redesign — ใช้ตรวจงาน design ด้วยตาจริง
// รัน: pnpm exec tsx scripts/shoot-design.ts (ต้องมี dev server ที่ :3000 + db พร้อม)
// หมายเหตุ: ใช้ UA Chrome ปกติ เพราะ anti-bot ให้คะแนนลบกับ UA "headless"
import fs from "node:fs";
import { chromium, type Page, type BrowserContext } from "playwright-core";

const BASE = "http://localhost:3000";
const OUT = ".shots/design";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(900); // รอฟอนต์/animation เข้าที่
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`📸 ${name}`);
}

// login ผ่านหน้าเว็บจริง (form → server action → redirect)
async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1380, height: 900 },
    userAgent: UA,
    locale: "th-TH",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);

  // ---------- public ----------
  await page.goto(BASE, { waitUntil: "load" });
  await shot(page, "01-home");

  await page.goto(`${BASE}/concerts`, { waitUntil: "load" });
  await shot(page, "02-concerts");

  // หยิบลิงก์คอนเสิร์ตใบแรกจาก listing (กัน slug เปลี่ยน)
  const href = await page.getAttribute('main a[href^="/concerts/"]', "href");
  if (!href) throw new Error("ไม่พบการ์ดคอนเสิร์ตin listing");
  await page.goto(`${BASE}${href}`, { waitUntil: "load" });
  await shot(page, "03-concert-detail");

  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await shot(page, "04-login");
  await page.goto(`${BASE}/register`, { waitUntil: "load" });
  await shot(page, "05-register");

  // ---------- จอง flow (user) ----------
  await login(page, "user@local", "Password123!");
  console.log("✅ login user@local");

  await page.goto(`${BASE}${href}/queue`, { waitUntil: "load" });
  await page.waitForTimeout(2200); // ให้ join คิว + ขึ้นเลขตำแหน่ง
  await shot(page, "06-queue");

  // รอระบบ admit แล้วเด้งไปหน้าเลือกที่นั่ง (dev คิวว่าง admit เร็ว)
  let onSeats = false;
  try {
    await page.waitForURL("**/seats**", { timeout: 30000 });
    onSeats = true;
  } catch {
    console.log("⚠️ ยังไม่ถูก admit ใน 30s — ข้าม seats/checkout");
  }

  if (onSeats) {
    await page.waitForSelector("main button[title]", { timeout: 30000 });
    await shot(page, "07-seats");

    // เลือก 2 ที่นั่งว่างแรก
    const seats = page.locator("main button[title]:not([disabled])");
    await seats.nth(0).click();
    await seats.nth(1).click();
    await shot(page, "08-seats-selected");

    // ไป checkout (hold ที่นั่งจริง — เดี๋ยวกดยกเลิกคืนตอนท้าย)
    await Promise.all([
      page.waitForURL("**/checkout/**", { timeout: 30000 }),
      page.getByRole("button", { name: /ดำเนินการชำระเงิน/ }).click(),
    ]);
    await page.waitForSelector('img[alt="PromptPay QR"]', { timeout: 30000 });
    await shot(page, "09-checkout");

    // ยกเลิกคำสั่งซื้อเพื่อปล่อยที่นั่งคืน
    await Promise.all([
      page.waitForURL("**/concerts/**", { timeout: 30000 }),
      page.getByRole("button", { name: /ยกเลิกคำสั่งซื้อ/ }).click(),
    ]);
    console.log("✅ ยกเลิก order คืนที่นั่งแล้ว");
  }

  await page.goto(`${BASE}/account/tickets`, { waitUntil: "load" });
  await shot(page, "10-tickets");

  // ---------- admin ----------
  const ctxAdmin = await browser.newContext({
    viewport: { width: 1380, height: 900 },
    userAgent: UA,
    locale: "th-TH",
  });
  const ap = await ctxAdmin.newPage();
  ap.setDefaultTimeout(60000);
  await login(ap, "admin@local", "Admin123!");
  console.log("✅ login admin@local");

  await ap.goto(`${BASE}/admin`, { waitUntil: "load" });
  await shot(ap, "11-admin-dashboard");
  await ap.goto(`${BASE}/admin/bot-log`, { waitUntil: "load" });
  await shot(ap, "12-admin-botlog");
  await ap.goto(`${BASE}/admin/sales`, { waitUntil: "load" });
  await shot(ap, "13-admin-sales");
  await ap.goto(`${BASE}/admin/concerts`, { waitUntil: "load" });
  await shot(ap, "14-admin-concerts");
  await ap.goto(`${BASE}/admin/concerts/new`, { waitUntil: "load" });
  await shot(ap, "15-admin-new");

  // ---------- mobile ----------
  const ctxMobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: UA,
    locale: "th-TH",
  });
  const mp = await ctxMobile.newPage();
  mp.setDefaultTimeout(60000);
  await mp.goto(BASE, { waitUntil: "load" });
  await shot(mp, "16-home-mobile");
  await mp.goto(`${BASE}${href}`, { waitUntil: "load" });
  await shot(mp, "17-detail-mobile");

  await browser.close();
  console.log(`\n✅ เสร็จ — ดูรูปได้ที่ ${OUT}/`);
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
