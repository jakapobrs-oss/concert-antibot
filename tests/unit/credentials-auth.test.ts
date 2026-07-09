// ============================================================
// Regression: credentials login core (Codex §4 F1/F3/F4/F5)
// ============================================================
// พิสูจน์ state machine ของ login ด้วย mock prisma/rate-limit/argon2:
//   F1: รหัสถูกแต่ยังไม่ยืนยันอีเมล → ปฏิเสธ (กัน pre-registration takeover)
//   F3: lock หมดอายุ → reset counter (ผิดรหัสครั้งถัดไปไม่ re-lock ทันที)
//   F4: rate-limit ต่อ email + ต่อ IP
//   F5: unknown user ก็เสียเวลา argon2 (timing equalize)
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

function makeUser(o: Record<string, unknown> = {}) {
  return {
    id: BigInt(7),
    email: "a@b.com",
    passwordHash: "REAL_HASH",
    name: "A",
    image: null,
    role: "USER",
    emailVerified: new Date(),
    failedLoginCount: 0,
    lockedUntil: null,
    ...o,
  };
}

const PW = "correcthorse";

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ allowed: true });
  hashPassword.mockResolvedValue("DUMMY_HASH");
  userUpdate.mockResolvedValue({});
});

describe("authenticateCredentials — rate limits (F4)", () => {
  it("ติด limit ต่อ email → null โดยไม่แตะ DB", async () => {
    checkRateLimit.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve({ allowed: !key.startsWith("login:email") })
    );
    const r = await authenticateCredentials({ email: "a@b.com", password: PW });
    expect(r).toBeNull();
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("ติด limit ต่อ IP → null โดยไม่แตะ DB (กัน spray จาก IP เดียว)", async () => {
    checkRateLimit.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve({ allowed: !key.startsWith("login:ip") })
    );
    const r = await authenticateCredentials({ email: "a@b.com", password: PW, ip: "1.2.3.4" });
    expect(r).toBeNull();
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});

describe("authenticateCredentials — F5 timing / unknown user", () => {
  it("ไม่พบ user → null แต่ยังเรียก argon2 (equalize timing กัน enumeration)", async () => {
    userFindUnique.mockResolvedValue(null);
    const r = await authenticateCredentials({ email: "nobody@x.com", password: PW });
    expect(r).toBeNull();
    expect(verifyPassword).toHaveBeenCalled(); // verify กับ dummy hash
  });
});

describe("authenticateCredentials — F1 emailVerified gate", () => {
  it("รหัสถูก + ยืนยันอีเมลแล้ว → คืน user", async () => {
    userFindUnique.mockResolvedValue(makeUser());
    verifyPassword.mockResolvedValue(true);
    const r = await authenticateCredentials({ email: "a@b.com", password: PW });
    expect(r).toMatchObject({ id: "7", email: "a@b.com", role: "USER" });
  });

  it("รหัสถูก แต่ 'ยังไม่ยืนยันอีเมล' → null (กัน pre-registration takeover)", async () => {
    userFindUnique.mockResolvedValue(makeUser({ emailVerified: null }));
    verifyPassword.mockResolvedValue(true);
    const r = await authenticateCredentials({ email: "a@b.com", password: PW });
    expect(r).toBeNull();
  });
});

describe("authenticateCredentials — lockout state machine (F3)", () => {
  it("รหัสผิดครั้งที่ 5 → ล็อก (ตั้ง lockedUntil)", async () => {
    userFindUnique.mockResolvedValue(makeUser({ failedLoginCount: 4 }));
    verifyPassword.mockResolvedValue(false);
    const r = await authenticateCredentials({ email: "a@b.com", password: "wrong" });
    expect(r).toBeNull();
    const data = userUpdate.mock.calls[0][0].data;
    expect(data.failedLoginCount).toBe(5);
    expect(data.lockedUntil).toBeInstanceOf(Date);
  });

  it("รหัสผิดแต่ยังไม่ถึง 5 → ไม่ล็อก", async () => {
    userFindUnique.mockResolvedValue(makeUser({ failedLoginCount: 1 }));
    verifyPassword.mockResolvedValue(false);
    await authenticateCredentials({ email: "a@b.com", password: "wrong" });
    expect(userUpdate.mock.calls[0][0].data.lockedUntil).toBeNull();
  });

  it("ยังอยู่ในช่วงล็อก → null โดยไม่ verify password", async () => {
    userFindUnique.mockResolvedValue(
      makeUser({ lockedUntil: new Date(Date.now() + 600_000), failedLoginCount: 5 })
    );
    const r = await authenticateCredentials({ email: "a@b.com", password: PW });
    expect(r).toBeNull();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("F3: lock หมดอายุแล้ว + รหัสผิด → reset counter (นับ 1 ไม่ใช่ 6) = ไม่ re-lock ถาวร", async () => {
    userFindUnique.mockResolvedValue(
      makeUser({ lockedUntil: new Date(Date.now() - 1000), failedLoginCount: 5 })
    );
    verifyPassword.mockResolvedValue(false);
    const r = await authenticateCredentials({ email: "a@b.com", password: "wrong" });
    expect(r).toBeNull();
    const data = userUpdate.mock.calls[0][0].data;
    expect(data.failedLoginCount).toBe(1); // reset 0 → +1 (เดิมค้าง = 6 แล้วล็อกใหม่ทันที)
    expect(data.lockedUntil).toBeNull(); // ไม่ re-lock
  });
});
