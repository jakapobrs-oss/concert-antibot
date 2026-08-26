// Unit tests — lib/email-templates.ts: เนื้อหาอีเมลครบ + escape ค่าจากผู้ใช้ + ใบเสร็จต้องไม่มี secret ของบัตร
import { describe, it, expect } from "vitest";
import { buildOrderPaidEmail, buildPasswordResetEmail, escapeHtml } from "@/lib/email-templates";

describe("escapeHtml", () => {
  it("แปลงอักขระพิเศษของ HTML ทั้ง 5 ตัว", () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
  });
});

describe("buildPasswordResetEmail", () => {
  const mail = buildPasswordResetEmail({ appName: "Concert", resetUrl: "https://x.test/reset?token=abc", ttlMinutes: 30 });

  it("มีลิงก์ทั้งใน html และ text + บอกอายุลิงก์ + บอกว่าไม่ได้ขอไม่ต้องทำอะไร", () => {
    expect(mail.html).toContain("https://x.test/reset?token=abc");
    expect(mail.text).toContain("https://x.test/reset?token=abc");
    expect(mail.html).toContain("30 นาที");
    expect(mail.text).toContain("ไม่ได้ขอ");
    expect(mail.subject).toContain("Concert");
  });
});

describe("buildOrderPaidEmail", () => {
  const mail = buildOrderPaidEmail({
    appName: "Concert",
    orderId: "123",
    concertTitle: `BTS <script>alert(1)</script> & "Friends"`,
    venue: "ราชมังคลากีฬาสถาน",
    eventAtText: "15 สิงหาคม 2569 เวลา 19:00",
    totalText: "฿8,500",
    seats: [
      { label: "VIP A1", holderName: "สมชาย <b>ใจดี</b>" },
      { label: "VIP A2", holderName: "สมหญิง" },
    ],
    ticketsUrl: "https://x.test/account/tickets",
  });

  it("subject มีชื่องานและเลขคำสั่งซื้อ", () => {
    expect(mail.subject).toContain("#123");
    expect(mail.subject).toContain("BTS");
  });

  it("html escape ชื่องาน/ชื่อผู้ถือ (ไม่มี <script>/<b> ดิบ)", () => {
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>ใจดี</b>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("&quot;Friends&quot;");
  });

  it("มีที่นั่งทุกใบ ผู้ถือ ยอด สถานที่ วันเวลา และลิงก์หน้าตั๋ว ทั้ง html และ text", () => {
    for (const s of ["VIP A1", "VIP A2", "สมหญิง", "฿8,500", "ราชมังคลากีฬาสถาน", "15 สิงหาคม 2569"]) {
      expect(mail.html).toContain(s);
      expect(mail.text).toContain(s);
    }
    expect(mail.html).toContain("https://x.test/account/tickets");
    expect(mail.text).toContain("https://x.test/account/tickets");
  });

  it("ไม่มี QR/รหัสบัตรในอีเมล — บอกให้เปิดในหน้าตั๋วของฉันแทน", () => {
    expect(mail.html).not.toMatch(/qr(Secret|Code)|TKT-/i);
    expect(mail.html).toContain("ตั๋วของฉัน");
  });
});
