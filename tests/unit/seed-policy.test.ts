// Unit tests — lib/seed-policy.ts: seed บน deploy ที่โฮสต์ต้องไม่สร้าง/ต้องล็อกบัญชีรหัสสาธารณะ
// บั๊กที่จับ (gap map 2026-08-27 Critical): admin@local/Admin123! ถูก seed ลง prod ทุก deploy บน repo PUBLIC
import { describe, it, expect } from "vitest";
import {
  isHostedDeploy,
  resolveSeedAccountPolicy,
  DEMO_ACCOUNT_EMAILS,
  SEED_ADMIN_MIN_PASSWORD_LENGTH,
} from "@/lib/seed-policy";

const STRONG = "correct-horse-battery-staple-42"; // ≥ 12 ตัว

describe("isHostedDeploy — แยกเครื่อง dev ออกจาก deploy ที่แตะ DB จริง", () => {
  it("เครื่อง dev (ไม่มี VERCEL, NODE_ENV=development) → ไม่ใช่โฮสต์", () => {
    expect(isHostedDeploy({ NODE_ENV: "development" })).toBe(false);
    expect(isHostedDeploy({})).toBe(false);
  });

  it("Vercel production และ preview → โฮสต์ทั้งคู่ (preview ใช้ Neon ตัวเดียวกับ prod)", () => {
    expect(isHostedDeploy({ VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(true);
    expect(isHostedDeploy({ VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(true);
    expect(isHostedDeploy({ VERCEL_ENV: "preview" })).toBe(true);
  });

  it("self-host ที่ NODE_ENV=production โดยไม่มี VERCEL → โฮสต์", () => {
    expect(isHostedDeploy({ NODE_ENV: "production" })).toBe(true);
  });
});

describe("resolveSeedAccountPolicy — เครื่อง dev", () => {
  it("สร้างบัญชีเดโมได้ตามเดิม ไม่ล็อกอะไร ไม่เตือน", () => {
    const p = resolveSeedAccountPolicy({ isHosted: false });
    expect(p.createDemoAccounts).toBe(true);
    expect(p.lockEmails).toEqual([]);
    expect(p.adminFromEnv).toBeNull();
    expect(p.warnings).toEqual([]);
  });

  it("ตั้ง SEED_ADMIN_* บนเครื่อง dev → ใช้ได้ (ลอง flow เดียวกับ prod ได้) และยังมีบัญชีเดโม", () => {
    const p = resolveSeedAccountPolicy({ isHosted: false, seedAdminEmail: "me@example.com", seedAdminPassword: STRONG });
    expect(p.createDemoAccounts).toBe(true);
    expect(p.adminFromEnv).toEqual({ email: "me@example.com", password: STRONG });
  });
});

describe("resolveSeedAccountPolicy — deploy ที่โฮสต์ (fail-closed)", () => {
  it("ไม่มี env → ไม่สร้างบัญชีเดโม + ล็อกทั้ง admin@local และ user@local + เตือนบอกทางแก้", () => {
    const p = resolveSeedAccountPolicy({ isHosted: true });
    expect(p.createDemoAccounts).toBe(false);
    expect(p.lockEmails).toEqual([...DEMO_ACCOUNT_EMAILS]);
    expect(p.adminFromEnv).toBeNull();
    expect(p.warnings.join("\n")).toContain("SEED_ADMIN_EMAIL");
  });

  it("ตั้ง env ครบ → ได้แอดมินจาก env และยังล็อกบัญชีเดโมทั้งคู่", () => {
    const p = resolveSeedAccountPolicy({ isHosted: true, seedAdminEmail: " admin@example.com ", seedAdminPassword: STRONG });
    expect(p.createDemoAccounts).toBe(false);
    expect(p.adminFromEnv).toEqual({ email: "admin@example.com", password: STRONG }); // trim อีเมล
    expect(p.lockEmails).toEqual([...DEMO_ACCOUNT_EMAILS]);
    expect(p.warnings).toEqual([]);
  });

  it("เลือก admin@local เป็นแอดมินจริง (รหัสใหม่จาก env) → ไม่ล็อกอีเมลนั้น แต่ยังล็อก user@local", () => {
    const p = resolveSeedAccountPolicy({ isHosted: true, seedAdminEmail: "admin@local", seedAdminPassword: STRONG });
    expect(p.adminFromEnv?.email).toBe("admin@local");
    expect(p.lockEmails).toEqual(["user@local"]);
  });

  it(`รหัสสั้นกว่า ${SEED_ADMIN_MIN_PASSWORD_LENGTH} ตัว → ไม่สร้างแอดมิน + เตือน แต่ยังล็อกบัญชีเดโม (ไม่เปิดช่องกลับ)`, () => {
    const p = resolveSeedAccountPolicy({ isHosted: true, seedAdminEmail: "admin@example.com", seedAdminPassword: "short" });
    expect(p.adminFromEnv).toBeNull();
    expect(p.lockEmails).toEqual([...DEMO_ACCOUNT_EMAILS]);
    expect(p.warnings.join("\n")).toContain("SEED_ADMIN_PASSWORD");
  });

  it("ตั้งแค่รหัสไม่มีอีเมล / อีเมลไม่มี @ → ไม่สร้างแอดมิน + เตือน", () => {
    expect(resolveSeedAccountPolicy({ isHosted: true, seedAdminPassword: STRONG }).adminFromEnv).toBeNull();
    const p = resolveSeedAccountPolicy({ isHosted: true, seedAdminEmail: "not-an-email", seedAdminPassword: STRONG });
    expect(p.adminFromEnv).toBeNull();
    expect(p.warnings.join("\n")).toContain("SEED_ADMIN_EMAIL");
  });

  it("ข้อความเตือนต้องไม่มีรหัสผ่านปน (seed พิมพ์ลง build log ของ Vercel)", () => {
    const secret = "S3cret-Passw0rd-That-Is-Long";
    const cases = [
      resolveSeedAccountPolicy({ isHosted: true, seedAdminPassword: secret }),
      resolveSeedAccountPolicy({ isHosted: true, seedAdminEmail: "x@y.z", seedAdminPassword: "short" }),
      resolveSeedAccountPolicy({ isHosted: true, seedAdminEmail: "x@y.z", seedAdminPassword: secret }),
    ];
    for (const p of cases) {
      expect(p.warnings.join("\n")).not.toContain(secret);
      expect(p.warnings.join("\n")).not.toContain("short");
    }
  });
});
