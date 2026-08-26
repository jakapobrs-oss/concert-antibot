// ============================================================
// Regression: ด่าน F1 (ต้องยืนยันอีเมล) กับสวิตช์ requireVerifiedEmail (EMAIL_VERIFICATION=skip, 2026-08-27)
// ============================================================
// พิสูจน์ว่า:
//   - ไม่ส่ง flag = F1 เปิดอยู่เสมอ (default ปลอดภัย) → บัญชียังไม่ยืนยัน = null
//   - requireVerifiedEmail=true = เหมือนเดิม
//   - requireVerifiedEmail=false = โหมดเดโม ปล่อยบัญชีที่ยังไม่ยืนยันเข้าได้ (รหัสต้องถูกเหมือนเดิม)
import { describe, it, expect, vi, beforeEach } from "vitest";

const { userFindUnique, userUpdate, checkRateLimit, verifyPassword, hashPassword } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  checkRateLimit: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: userFindUnique, update: userUpdate } } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/password", () => ({ verifyPassword, hashPassword }));

import { authenticateCredentials } from "@/lib/credentials-auth";

const PW = "correcthorse";
const unverifiedUser = {
  id: BigInt(9),
  email: "new@b.com",
  passwordHash: "REAL_HASH",
  name: "N",
  image: null,
  role: "USER",
  emailVerified: null, // สมัครไว้ตอนยังไม่มีระบบส่งเมล / ยังไม่กดลิงก์
  failedLoginCount: 0,
  lockedUntil: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ allowed: true });
  hashPassword.mockResolvedValue("DUMMY_HASH");
  userUpdate.mockResolvedValue({});
  userFindUnique.mockResolvedValue(unverifiedUser);
  verifyPassword.mockResolvedValue(true);
});

describe("authenticateCredentials — requireVerifiedEmail", () => {
  it("ไม่ส่ง flag → F1 เปิด: บัญชียังไม่ยืนยัน = null แม้รหัสถูก", async () => {
    expect(await authenticateCredentials({ email: "new@b.com", password: PW })).toBeNull();
  });

  it("requireVerifiedEmail=true → เหมือน default (null)", async () => {
    expect(await authenticateCredentials({ email: "new@b.com", password: PW, requireVerifiedEmail: true })).toBeNull();
  });

  it("requireVerifiedEmail=false (โหมดเดโม) → เข้าได้", async () => {
    const r = await authenticateCredentials({ email: "new@b.com", password: PW, requireVerifiedEmail: false });
    expect(r).toEqual({ id: "9", email: "new@b.com", name: "N", image: undefined, role: "USER" });
  });

  it("โหมดเดโมไม่ได้ปลดด่านรหัสผ่าน: รหัสผิดยัง null", async () => {
    verifyPassword.mockResolvedValue(false);
    expect(await authenticateCredentials({ email: "new@b.com", password: "wrong-pass", requireVerifiedEmail: false })).toBeNull();
  });
});
