// Unit tests — Anti-Bot Engine Layer 1 (lib/antibot.ts: assessRequest)
// พิสูจน์ว่า "scoring engine" ตัดสิน ALLOW / CHALLENGE / BLOCK ถูกต้องตามตารางคะแนน
// (กันคนจริงโดน block = false positive และกันบอทหลุด = false negative)
//
// ตารางคะแนน (อ้างอิง lib/antibot.ts):
//   Turnstile : missing +40 · fail +55 · pass 0
//   UserAgent : empty  +35 · bot  +50 · suspicious(<30) +20 · ok 0
//   Headers   : incomplete +15 · complete 0
//   Fingerprint: missing +10 · present 0
//   action: score<40 ALLOW · 40-69 CHALLENGE · >=70 BLOCK
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock Turnstile — แยก Layer 1 scoring ออกจากการเรียก Cloudflare จริง (ทดสอบเป็น pure unit)
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn(),
}));

import { verifyTurnstile } from "@/lib/turnstile";
import { assessRequest, ANTIBOT_CONFIG } from "@/lib/antibot";

const mockedVerify = vi.mocked(verifyTurnstile);

// UA ของ Chrome จริง (ยาว > 30, ไม่มี keyword บอท) → "ok"
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// header ครบแบบ browser จริง (มีทั้ง accept-language + accept)
function completeHeaders(): Headers {
  return new Headers({ "accept-language": "th,en;q=0.9", accept: "text/html" });
}
// header ขาด accept-language (บอทมักขาด)
function incompleteHeaders(): Headers {
  return new Headers({ accept: "text/html" });
}

beforeEach(() => {
  mockedVerify.mockReset();
  // default: Turnstile ผ่าน (ไม่ใช่ dev) — แต่ละ test override ได้
  mockedVerify.mockResolvedValue({ success: true, devMode: false });
});

describe("assessRequest — มนุษย์ปกติ (สัญญาณครบ) → ALLOW", () => {
  it("Turnstile ผ่าน + UA Chrome + header ครบ + มี fingerprint → score 0, ALLOW", async () => {
    const result = await assessRequest({
      turnstileToken: "valid-token",
      userAgent: CHROME_UA,
      headers: completeHeaders(),
      fingerprintHash: "fp-abc123",
    });
    expect(result.score).toBe(0);
    expect(result.action).toBe("ALLOW");
    expect(result.signals).toEqual({
      turnstile: "pass",
      userAgent: "ok",
      headers: "complete",
      fingerprint: "present",
    });
  });

  it("Turnstile dev key (devMode) → ติด label 'dev-pass' แต่ยังไม่เพิ่มคะแนน", async () => {
    mockedVerify.mockResolvedValue({ success: true, devMode: true });
    const result = await assessRequest({
      turnstileToken: "dev-token",
      userAgent: CHROME_UA,
      headers: completeHeaders(),
      fingerprintHash: "fp-abc123",
    });
    expect(result.score).toBe(0);
    expect(result.action).toBe("ALLOW");
    expect(result.signals.turnstile).toBe("dev-pass");
  });
});

describe("assessRequest — Turnstile signal", () => {
  it("ไม่ส่ง token เลย → +40 = CHALLENGE (boundary พอดี 40)", async () => {
    const result = await assessRequest({
      turnstileToken: undefined,
      userAgent: CHROME_UA,
      headers: completeHeaders(),
      fingerprintHash: "fp-abc123",
    });
    expect(result.score).toBe(40);
    expect(result.action).toBe("CHALLENGE");
    expect(result.signals.turnstile).toBe("missing");
  });

  it("Turnstile fail → +55 = CHALLENGE", async () => {
    mockedVerify.mockResolvedValue({ success: false, devMode: false });
    const result = await assessRequest({
      turnstileToken: "bad-token",
      userAgent: CHROME_UA,
      headers: completeHeaders(),
      fingerprintHash: "fp-abc123",
    });
    expect(result.score).toBe(55);
    expect(result.action).toBe("CHALLENGE");
    expect(result.signals.turnstile).toBe("fail");
  });

  it("ส่ง verifyTurnstile ด้วย token + ip ที่รับมา", async () => {
    await assessRequest({
      turnstileToken: "tok",
      userAgent: CHROME_UA,
      headers: completeHeaders(),
      fingerprintHash: "fp",
      ip: "203.0.113.7",
    });
    expect(mockedVerify).toHaveBeenCalledWith("tok", "203.0.113.7");
  });
});

describe("assessRequest — User-Agent signal", () => {
  it("UA ว่าง/null → +35, label 'empty' (35 < 40 = ยัง ALLOW)", async () => {
    const result = await assessRequest({
      turnstileToken: "valid-token",
      userAgent: null,
      headers: completeHeaders(),
      fingerprintHash: "fp-abc123",
    });
    expect(result.score).toBe(35);
    expect(result.action).toBe("ALLOW");
    expect(result.signals.userAgent).toBe("empty");
  });

  it("UA สั้นผิดปกติ (< 30 ตัว, ไม่มี keyword) → +20, label 'suspicious'", async () => {
    const result = await assessRequest({
      turnstileToken: "valid-token",
      userAgent: "Mozilla/5.0", // 11 ตัว
      headers: completeHeaders(),
      fingerprintHash: "fp-abc123",
    });
    expect(result.score).toBe(20);
    expect(result.action).toBe("ALLOW");
    expect(result.signals.userAgent).toBe("suspicious");
  });

  it.each(["headless", "selenium", "puppeteer", "curl/7.81.0", "python-requests/2.31"])(
    "UA ที่มี keyword บอท '%s' → +50, label 'bot'",
    async (keyword) => {
      const result = await assessRequest({
        turnstileToken: "valid-token",
        userAgent: `Mozilla/5.0 compatible ${keyword} agent`,
        headers: completeHeaders(),
        fingerprintHash: "fp-abc123",
      });
      expect(result.score).toBe(50);
      expect(result.signals.userAgent).toBe("bot");
      expect(result.action).toBe("CHALLENGE"); // 50 อยู่ช่วง 40-69
    }
  );
});

describe("assessRequest — Header + Fingerprint signal", () => {
  it("ขาด accept-language → +15, label 'incomplete'", async () => {
    const result = await assessRequest({
      turnstileToken: "valid-token",
      userAgent: CHROME_UA,
      headers: incompleteHeaders(),
      fingerprintHash: "fp-abc123",
    });
    expect(result.score).toBe(15);
    expect(result.signals.headers).toBe("incomplete");
  });

  it("ไม่มี fingerprint → +10, label 'missing'", async () => {
    const result = await assessRequest({
      turnstileToken: "valid-token",
      userAgent: CHROME_UA,
      headers: completeHeaders(),
      fingerprintHash: null,
    });
    expect(result.score).toBe(10);
    expect(result.signals.fingerprint).toBe("missing");
  });
});

describe("assessRequest — รวมหลายสัญญาณ → BLOCK / boundary / clamp", () => {
  it("ไม่ส่ง token + UA บอท → 40+50 = 90 = BLOCK", async () => {
    const result = await assessRequest({
      turnstileToken: undefined,
      userAgent: "python-requests/2.31.0",
      headers: completeHeaders(),
      fingerprintHash: "fp-abc123",
    });
    expect(result.score).toBe(90);
    expect(result.action).toBe("BLOCK");
  });

  it("Turnstile fail + header ขาด → 55+15 = 70 = BLOCK (boundary พอดี 70)", async () => {
    mockedVerify.mockResolvedValue({ success: false, devMode: false });
    const result = await assessRequest({
      turnstileToken: "bad-token",
      userAgent: CHROME_UA,
      headers: incompleteHeaders(),
      fingerprintHash: "fp-abc123",
    });
    expect(result.score).toBe(70);
    expect(result.action).toBe("BLOCK");
  });

  it("Turnstile fail + ไม่มี fingerprint → 55+10 = 65 = CHALLENGE (ต่ำกว่า 70 พอดี)", async () => {
    mockedVerify.mockResolvedValue({ success: false, devMode: false });
    const result = await assessRequest({
      turnstileToken: "bad-token",
      userAgent: CHROME_UA,
      headers: completeHeaders(),
      fingerprintHash: null,
    });
    expect(result.score).toBe(65);
    expect(result.action).toBe("CHALLENGE");
  });

  it("ทุกสัญญาณแย่ → clamp ไม่เกิน 100, BLOCK", async () => {
    mockedVerify.mockResolvedValue({ success: false, devMode: false });
    // fail(55) + bot UA(50) + incomplete(15) + no fp(10) = 130 → clamp 100
    const result = await assessRequest({
      turnstileToken: "bad-token",
      userAgent: "curl/8.0",
      headers: incompleteHeaders(),
      fingerprintHash: null,
    });
    expect(result.score).toBe(100);
    expect(result.action).toBe("BLOCK");
  });
});

describe("ANTIBOT_CONFIG — สัญญา threshold ที่ระบบใช้", () => {
  it("CHALLENGE=40, BLOCK=70 (กันแก้ค่าหลุดโดยไม่ตั้งใจ)", () => {
    expect(ANTIBOT_CONFIG).toEqual({ CHALLENGE_THRESHOLD: 40, BLOCK_THRESHOLD: 70 });
  });
});
