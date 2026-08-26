// Unit tests — lib/password-reset.ts: token รีเซ็ตกับ token ยืนยันอีเมลต้องใช้ข้ามกันไม่ได้ + กติการหัสใหม่
import { describe, it, expect } from "vitest";
import {
  RESET_IDENTIFIER_PREFIX,
  RESET_TOKEN_TTL_MS,
  PASSWORD_MIN_LENGTH,
  resetIdentifierFor,
  isResetIdentifier,
  emailFromResetIdentifier,
  generateResetToken,
  resetTokenExpiry,
  evaluateResetToken,
  checkNewPassword,
} from "@/lib/password-reset";

describe("identifier ของ token รีเซ็ต", () => {
  it("ขึ้นต้นด้วย prefix และถอดกลับเป็นอีเมลเดิมได้", () => {
    const id = resetIdentifierFor("a@b.co");
    expect(id).toBe(`${RESET_IDENTIFIER_PREFIX}a@b.co`);
    expect(isResetIdentifier(id)).toBe(true);
    expect(emailFromResetIdentifier(id)).toBe("a@b.co");
  });

  it("identifier ของ token ยืนยันอีเมล (อีเมลล้วน) ไม่ใช่ token รีเซ็ต", () => {
    expect(isResetIdentifier("a@b.co")).toBe(false);
    expect(emailFromResetIdentifier("a@b.co")).toBeNull();
    expect(emailFromResetIdentifier(RESET_IDENTIFIER_PREFIX)).toBeNull(); // prefix เปล่า
  });
});

describe("token", () => {
  it("สุ่ม 32 ไบต์เป็น hex 64 ตัว ไม่ซ้ำกัน", () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
  });

  it("หมดอายุ 30 นาทีหลังออก", () => {
    const now = new Date("2026-08-27T10:00:00Z");
    expect(resetTokenExpiry(now).getTime() - now.getTime()).toBe(RESET_TOKEN_TTL_MS);
    expect(RESET_TOKEN_TTL_MS).toBe(30 * 60 * 1000);
  });
});

describe("evaluateResetToken — ตัดสินจาก record ใน DB", () => {
  const now = new Date("2026-08-27T10:00:00Z");
  const future = new Date(now.getTime() + 60_000);
  const past = new Date(now.getTime() - 1);

  it("ไม่มี record → missing", () => {
    expect(evaluateResetToken(null, now)).toEqual({ usable: false, reason: "missing" });
  });

  it("token ยืนยันอีเมลเอามาใช้รีเซ็ต → not-reset (ใช้ข้ามชนิดไม่ได้)", () => {
    expect(evaluateResetToken({ identifier: "a@b.co", expires: future }, now)).toEqual({ usable: false, reason: "not-reset" });
  });

  it("หมดอายุ (รวมวินาทีที่เท่ากันพอดี) → expired", () => {
    expect(evaluateResetToken({ identifier: resetIdentifierFor("a@b.co"), expires: past }, now).usable).toBe(false);
    expect(evaluateResetToken({ identifier: resetIdentifierFor("a@b.co"), expires: now }, now)).toEqual({ usable: false, reason: "expired" });
  });

  it("token รีเซ็ตที่ยังไม่หมดอายุ → usable พร้อมอีเมล", () => {
    expect(evaluateResetToken({ identifier: resetIdentifierFor("a@b.co"), expires: future }, now)).toEqual({ usable: true, email: "a@b.co" });
  });
});

describe("checkNewPassword — กติกาเท่าตอนสมัคร", () => {
  it("ว่าง / สั้นกว่าขั้นต่ำ / ยาวเกิน / ไม่ตรงกับช่องยืนยัน → ไม่ผ่านพร้อมข้อความไทย", () => {
    expect(checkNewPassword("", "")).toMatchObject({ ok: false });
    expect(checkNewPassword(null, null)).toMatchObject({ ok: false });
    expect(checkNewPassword("short", "short")).toMatchObject({ ok: false, error: expect.stringContaining(String(PASSWORD_MIN_LENGTH)) });
    expect(checkNewPassword("x".repeat(201), "x".repeat(201))).toMatchObject({ ok: false });
    expect(checkNewPassword("correct-horse", "correct-horsE")).toMatchObject({ ok: false, error: expect.stringContaining("ไม่ตรงกัน") });
  });

  it("ผ่าน → คืนรหัสให้ไป hash", () => {
    expect(checkNewPassword("correct-horse", "correct-horse")).toEqual({ ok: true, password: "correct-horse" });
  });
});
