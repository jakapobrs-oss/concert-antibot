// Regression — header ความปลอดภัยที่เคยทำฟีเจอร์พังเงียบ ๆ (rev 42 hotfix รอบ 3, 2026-08-27)
//   Permissions-Policy: camera=() ปิดกล้องทุกหน้า + CSP ไม่มี worker-src → กล้องสแกนที่ /staff/checkin
//   ใช้ไม่ได้ 100% บน prod ตั้งแต่ deploy โดยเทสเบราว์เซอร์ (headless ไม่มีกล้อง) ผ่านตลอด
//   เทสนี้จับ regression ประเภทนี้ได้ใน ms โดยไม่ต้องมีกล้อง — อ่านค่าจาก next.config.ts ตรง ๆ
import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

// รวม header จากทุก rule ที่เป็น catch-all (source แบบ "/(.*)" หรือ "/:path*") หรือตรง path — โปรเจกต์นี้มี rule เดียวคลุมทุกเส้นทาง
async function headersFor(path: string): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers?.()) as HeaderRule[] | undefined;
  expect(rules?.length ?? 0).toBeGreaterThan(0);
  const out: Record<string, string> = {};
  for (const rule of rules ?? []) {
    const catchAll = /^\/(\(\.\*\)|:path\*|\*)?$/.test(rule.source) || rule.source.includes("(.*)") || rule.source.includes(":path*");
    if (catchAll || rule.source === path) {
      for (const h of rule.headers) out[h.key] = h.value;
    }
  }
  expect(Object.keys(out).length, `ไม่มี rule ไหนคลุม ${path} (sources: ${rules?.map((r) => r.source).join(", ")})`).toBeGreaterThan(0);
  return out;
}

describe("security headers — กล้องสแกนต้องใช้ได้ (ไม่ถูก header ปิดเงียบ)", () => {
  it("Permissions-Policy อนุญาต camera ให้ตัวเอง (self) — ไม่ใช่ camera=()", async () => {
    const h = await headersFor("/staff/checkin");
    expect(h["Permissions-Policy"]).toMatch(/camera=\(self\)/);
    expect(h["Permissions-Policy"]).not.toMatch(/camera=\(\)/);
  });

  it("CSP มี worker-src ที่อนุญาต blob: (qr-scanner สร้าง worker ถอดรหัสจาก blob URL)", async () => {
    const h = await headersFor("/staff/checkin");
    const csp = h["Content-Security-Policy"];
    expect(csp).toBeTruthy();
    const workerSrc = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("worker-src"));
    expect(workerSrc).toBeTruthy();
    expect(workerSrc).toMatch(/blob:/);
  });

  it("ของเดิมยังอยู่: frame-src Turnstile · object-src 'none' · base-uri 'self'", async () => {
    const h = await headersFor("/");
    const csp = h["Content-Security-Policy"];
    expect(csp).toMatch(/frame-src https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/base-uri 'self'/);
  });
});
