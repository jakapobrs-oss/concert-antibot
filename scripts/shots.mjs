// สคริปต์ screenshot หน้าที่ต้อง login — ใช้ playwright-core + Edge ที่ติดตั้งในเครื่อง
import { chromium } from "playwright-core";
import path from "node:path";

const BASE = "http://localhost:3000";
const DIR = path.resolve(".shots");

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1200);
}

async function shot(page, url, name, { full = true, wait = 1200 } = {}) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(DIR, `${name}.png`), fullPage: full });
  console.log("OK", name);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });

// ── Admin ──
const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const admin = await adminCtx.newPage();
await login(admin, "admin@local", "Admin123!");

// user dropdown เปิดอยู่ (ถ่ายเฉพาะ viewport บนให้เห็นเมนู)
await admin.goto(`${BASE}/`, { waitUntil: "networkidle" });
await admin.click('button[aria-haspopup="menu"]');
await admin.waitForTimeout(500);
await admin.screenshot({ path: path.join(DIR, "06-user-dropdown.png"), fullPage: false });
console.log("OK 06-user-dropdown");

await shot(admin, "/admin", "07-admin-dashboard");
await shot(admin, "/admin/concerts", "08-admin-concerts");
await adminCtx.close();

// ── User ──
const userCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const user = await userCtx.newPage();
await login(user, "user@local", "Password123!");
await shot(user, "/account/tickets", "09-tickets");
await shot(user, "/concerts/bts-bangkok-2026/queue", "10-waiting-room", { wait: 4500 });
await userCtx.close();

await browser.close();
console.log("DONE");
