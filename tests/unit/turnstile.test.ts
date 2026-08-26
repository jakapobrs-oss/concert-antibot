// Unit tests — lib/turnstile.ts: verifyTurnstile ต้องเช็ค action + hostname (SECURITY_TODO #2)
// สิ่งที่ต้องพิสูจน์:
//   - คีย์จริง: token ที่ Cloudflare ยืนยันแล้วแต่ "ผิดด่าน" (action) หรือ "ผิดโดเมน" (hostname) ต้องไม่ผ่าน
//   - Host header มี port / ตัวใหญ่ ต้องเทียบตรงกับ hostname ที่ Cloudflare คืน (ไม่มี port)
//   - dev mode (test key) ข้ามเช็ค 2 ข้อนี้ — test key คืนค่าตายตัวของ Cloudflare ไม่ใช่ของเรา
//   - ของเดิมไม่พัง: success:false ยังไม่ผ่าน / ไม่มี token ไม่ยิง fetch / ส่ง secret+response+remoteip
// เทคนิค: โมดูลอ่าน TURNSTILE_SECRET_KEY ตอน import → vi.stubEnv + vi.resetModules + dynamic import
import { describe, it, expect, vi, afterEach } from "vitest";

const HOST = "concert-antibot.vercel.app";
// response ปกติของ siteverify เมื่อ token ถูกแก้จาก widget ด่านคิว บนโดเมนจริง
const OK_RESPONSE = { success: true, hostname: HOST, action: "queue_join", "error-codes": [] };

async function loadVerify(opts: { realSecret?: boolean } = {}) {
  vi.resetModules();
  vi.stubEnv("TURNSTILE_SECRET_KEY", opts.realSecret ? "real-secret-for-test" : "");
  return import("@/lib/turnstile");
}

// stub global fetch ให้คืน JSON ที่กำหนด (เลียนแบบ siteverify ของ Cloudflare)
function stubSiteverify(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("verifyTurnstile — คีย์จริง: token ต้องตรงด่าน (action) และตรงโดเมน (hostname)", () => {
  it("action + hostname ตรง → ผ่าน", async () => {
    const { verifyTurnstile } = await loadVerify({ realSecret: true });
    stubSiteverify(OK_RESPONSE);
    const r = await verifyTurnstile("tok", "203.0.113.7", { action: "queue_join", hostname: HOST });
    expect(r.success).toBe(true);
    expect(r.devMode).toBe(false);
  });

  it("action ไม่ตรง (token จาก widget ด่านคิว เอามาใช้ตอนกดซื้อ) → ไม่ผ่าน action-mismatch", async () => {
    const { verifyTurnstile } = await loadVerify({ realSecret: true });
    stubSiteverify(OK_RESPONSE); // Cloudflare บอกว่า token นี้ action=queue_join
    const r = await verifyTurnstile("tok", undefined, { action: "purchase", hostname: HOST });
    expect(r.success).toBe(false);
    expect(r.errorCodes).toEqual(["action-mismatch"]);
  });

  it("Cloudflare ไม่คืน action เลย (widget ไม่ได้ตั้ง = ไม่ใช่ widget ของเรา) → ไม่ผ่าน", async () => {
    const { verifyTurnstile } = await loadVerify({ realSecret: true });
    stubSiteverify({ success: true, hostname: HOST });
    const r = await verifyTurnstile("tok", undefined, { action: "queue_join", hostname: HOST });
    expect(r.success).toBe(false);
    expect(r.errorCodes).toEqual(["action-mismatch"]);
  });

  it("hostname ไม่ตรง (token แก้บนโดเมนอื่น) → ไม่ผ่าน hostname-mismatch", async () => {
    const { verifyTurnstile } = await loadVerify({ realSecret: true });
    stubSiteverify({ ...OK_RESPONSE, hostname: "evil.example.com" });
    const r = await verifyTurnstile("tok", undefined, { action: "queue_join", hostname: HOST });
    expect(r.success).toBe(false);
    expect(r.errorCodes).toEqual(["hostname-mismatch"]);
  });

  it("Host header มี port / ตัวใหญ่ → ยังเทียบตรง (localhost:3000 vs localhost)", async () => {
    const { verifyTurnstile } = await loadVerify({ realSecret: true });
    stubSiteverify({ ...OK_RESPONSE, hostname: "localhost" });
    const r = await verifyTurnstile("tok", undefined, { action: "queue_join", hostname: "LocalHost:3000" });
    expect(r.success).toBe(true);
  });

  it("ไม่ทราบ host ของคำขอ (null) → ข้ามเช็ค hostname แต่ยังเช็ค action", async () => {
    const { verifyTurnstile } = await loadVerify({ realSecret: true });
    stubSiteverify({ ...OK_RESPONSE, hostname: "whatever.example" });
    const ok = await verifyTurnstile("tok", undefined, { action: "queue_join", hostname: null });
    expect(ok.success).toBe(true);
    const bad = await verifyTurnstile("tok", undefined, { action: "purchase", hostname: null });
    expect(bad.success).toBe(false);
    expect(bad.errorCodes).toEqual(["action-mismatch"]);
  });

  it("Cloudflare ตอบ success:false → ไม่ผ่านแม้ action/hostname ตรง (พฤติกรรมเดิม)", async () => {
    const { verifyTurnstile } = await loadVerify({ realSecret: true });
    stubSiteverify({ ...OK_RESPONSE, success: false, "error-codes": ["timeout-or-duplicate"] });
    const r = await verifyTurnstile("tok", undefined, { action: "queue_join", hostname: HOST });
    expect(r.success).toBe(false);
    expect(r.errorCodes).toEqual(["timeout-or-duplicate"]);
  });

  it("ไม่ส่ง expectation (ผู้เรียกเก่า) → ผ่านตาม success ของ Cloudflare เท่านั้น", async () => {
    const { verifyTurnstile } = await loadVerify({ realSecret: true });
    stubSiteverify({ ...OK_RESPONSE, action: "something-else", hostname: "other.example" });
    const r = await verifyTurnstile("tok");
    expect(r.success).toBe(true);
  });

  it("ส่ง secret + response + remoteip ไป siteverify", async () => {
    const { verifyTurnstile } = await loadVerify({ realSecret: true });
    const fetchMock = stubSiteverify(OK_RESPONSE);
    await verifyTurnstile("tok-123", "203.0.113.7", { action: "queue_join", hostname: HOST });
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: URLSearchParams }];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.body.get("secret")).toBe("real-secret-for-test");
    expect(init.body.get("response")).toBe("tok-123");
    expect(init.body.get("remoteip")).toBe("203.0.113.7");
  });
});

describe("verifyTurnstile — dev mode (test key ของ Cloudflare)", () => {
  it("ข้ามเช็ค action/hostname (test key คืนค่าตายตัว ไม่ใช่ของเรา) แต่ flag devMode", async () => {
    const { verifyTurnstile } = await loadVerify({ realSecret: false });
    stubSiteverify({ success: true, hostname: "example.com" }); // ไม่มี action + hostname ไม่ใช่ของเรา
    const r = await verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", undefined, {
      action: "queue_join",
      hostname: HOST,
    });
    expect(r.success).toBe(true);
    expect(r.devMode).toBe(true);
  });

  it("ไม่มี token → missing-input-response โดยไม่ยิง fetch", async () => {
    const { verifyTurnstile } = await loadVerify({ realSecret: false });
    const fetchMock = stubSiteverify(OK_RESPONSE);
    const r = await verifyTurnstile(null, undefined, { action: "queue_join", hostname: HOST });
    expect(r.success).toBe(false);
    expect(r.errorCodes).toEqual(["missing-input-response"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("normalizeHostname — ทำ Host header ให้เทียบกับ hostname ของ Cloudflare ได้", () => {
  it("ตัด port / lower-case / จุดท้าย / ช่องว่าง", async () => {
    const { normalizeHostname } = await loadVerify();
    expect(normalizeHostname("localhost:3000")).toBe("localhost");
    expect(normalizeHostname("Concert-Antibot.Vercel.App")).toBe("concert-antibot.vercel.app");
    expect(normalizeHostname("  example.com.  ")).toBe("example.com");
  });

  it("IPv6 literal ในวงเล็บ → เหลือแค่ address", async () => {
    const { normalizeHostname } = await loadVerify();
    expect(normalizeHostname("[::1]:3000")).toBe("::1");
  });

  it("ว่าง/null → สตริงว่าง (ผู้เรียกถือว่า 'ไม่ทราบ' = ข้ามเช็ค)", async () => {
    const { normalizeHostname } = await loadVerify();
    expect(normalizeHostname(null)).toBe("");
    expect(normalizeHostname("   ")).toBe("");
  });
});
