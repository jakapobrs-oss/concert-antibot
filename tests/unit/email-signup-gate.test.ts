// Unit tests — lib/email-signup-gate.ts: production ที่ไม่มี email provider ต้องปิดรับสมัครด้วยอีเมล
// บั๊กที่จับ (readiness audit 2026-08-26): prod ไม่มี RESEND_API_KEY แต่ยังรับสมัคร → บัญชียืนยันไม่ได้ + token ลง log
import { describe, it, expect } from "vitest";
import { isEmailSignupOpen, EMAIL_SIGNUP_CLOSED_MESSAGE } from "@/lib/email-signup-gate";

describe("isEmailSignupOpen — ด่านสมัครด้วยอีเมล", () => {
  it("production + ไม่มี RESEND_API_KEY → ปิด (fail-closed)", () => {
    expect(isEmailSignupOpen({ isProduction: true, isEmailEnabled: false })).toBe(false);
  });

  it("production + ตั้ง RESEND_API_KEY แล้ว → เปิด", () => {
    expect(isEmailSignupOpen({ isProduction: true, isEmailEnabled: true })).toBe(true);
  });

  it("dev ไม่มี provider → ยังเปิด (ลิงก์ยืนยันโผล่ใน console ให้ copy)", () => {
    expect(isEmailSignupOpen({ isProduction: false, isEmailEnabled: false })).toBe(true);
  });

  it("ข้อความบอกทางออก (Google) ไม่ใช่แค่บอกว่าปิด", () => {
    expect(EMAIL_SIGNUP_CLOSED_MESSAGE).toContain("Google");
  });
});
