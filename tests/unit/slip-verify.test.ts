// Unit tests — lib/slip-verify.ts: สวิตช์ SLIP_PROVIDER เลือกผู้ให้บริการโดยไม่แก้โค้ด (rev 40, 2026-08-27)
import { describe, it, expect, vi, afterEach } from "vitest";

interface LoadOpts {
  provider: "easyslip" | "slipok";
  easyKey?: string;
  okKey?: string;
  branch?: string;
  production?: boolean;
}

async function loadSlipVerify(opts: LoadOpts) {
  const { provider, easyKey = "", okKey = "", branch = "", production = false } = opts;
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      SLIP_PROVIDER: provider,
      EASYSLIP_API_KEY: easyKey,
      SLIPOK_API_KEY: okKey,
      SLIPOK_BRANCH_ID: branch,
      SLIPOK_LOG: false,
      PROMPTPAY_ID: "0812345678",
      PAYMENTS_RECEIVER_CHECK: false,
      PAYMENTS_RECEIVER_NAME: undefined,
    },
    isEasySlipConfigured: !!easyKey,
    isSlipOkConfigured: !!(okKey && branch),
    isProduction: production,
  }));
  return import("@/lib/slip-verify");
}

function stubFetchJson(body: unknown, httpStatus = 200) {
  const fn = vi.fn().mockResolvedValue({ ok: httpStatus < 400, status: httpStatus, json: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const IMAGE = "data:image/png;base64,iVBORw0KGgo=";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("verifySlip — เลือกผู้ให้บริการตาม SLIP_PROVIDER", () => {
  it("slipok → ยิง api.slipok.com ด้วย branch/คีย์ของ SlipOK (ไม่แตะ EasySlip)", async () => {
    const mod = await loadSlipVerify({ provider: "slipok", okKey: "sk", branch: "777", easyKey: "easy-key-ignored" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = stubFetchJson({ success: false, code: "1002", message: "bad" }, 401);
    const r = await mod.verifySlip({ slipImageBase64: IMAGE, expectedAmount: 10 });
    expect(mod.activeSlipProvider).toBe("slipok");
    expect(mod.isSlipVerifierConfigured).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.slipok.com/api/line/apikey/777");
    expect(r.errorCode).toBe("1002");
  });

  it("easyslip (ค่าเริ่มต้น) → ยิง developer.easyslip.com", async () => {
    const mod = await loadSlipVerify({ provider: "easyslip", easyKey: "easy" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = stubFetchJson({ status: 403, message: "application_expired" }, 403);
    const r = await mod.verifySlip({ slipImageBase64: IMAGE, expectedAmount: 10 });
    expect(fetchMock.mock.calls[0][0]).toBe("https://developer.easyslip.com/api/v1/verify");
    expect(r.errorCode).toBe("application_expired");
  });

  it("เปิด slipok แต่ตั้งคีย์ไว้แค่ EasySlip → ถือว่ายังไม่พร้อม: production ปฏิเสธ (fail-closed) และไม่เรียก fetch", async () => {
    const mod = await loadSlipVerify({ provider: "slipok", easyKey: "easy", production: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(mod.isSlipVerifierConfigured).toBe(false);
    const r = await mod.verifySlip({ slipImageBase64: IMAGE, expectedAmount: 10 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("ยังไม่พร้อมใช้งาน");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getSlipProviderStatus / warnSlipProviderHealth", () => {
  it("slipok ยังไม่ตั้งคีย์ → tone danger + บอก env ที่ขาด", async () => {
    const mod = await loadSlipVerify({ provider: "slipok" });
    const s = await mod.getSlipProviderStatus();
    expect(s.provider).toBe("slipok");
    expect(s.label).toBe("SlipOK");
    expect(s.configured).toBe(false);
    expect(s.tone).toBe("danger");
    expect(s.line).toContain("SLIPOK_API_KEY");
    expect(s.line).toContain("SLIPOK_BRANCH_ID");
  });

  it("slipok โควต้าปกติ → success + บอกโควต้าเหลือ · โควต้าหมด → danger + boot-warn log [SLIPOK]", async () => {
    const mod = await loadSlipVerify({ provider: "slipok", okKey: "sk", branch: "777" });
    stubFetchJson({ success: true, data: { quota: 95, specialQuota: 5, overQuota: 0 } });
    const fine = await mod.getSlipProviderStatus();
    expect(fine.tone).toBe("success");
    expect(fine.line).toContain("โควต้าเหลือ 100");
    expect(fine.hint).toBeUndefined();

    stubFetchJson({ success: true, data: { quota: 0, specialQuota: 0, overQuota: 2 } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const empty = await mod.getSlipProviderStatus();
    expect(empty.tone).toBe("danger");
    await mod.warnSlipProviderHealth();
    expect(err).toHaveBeenCalled();
    expect(String(err.mock.calls[0][0])).toContain("[PAYMENT][SLIPOK]");
  });

  it("easyslip แอปหมดอายุ → danger + hint ชวนสลับ SLIP_PROVIDER", async () => {
    const mod = await loadSlipVerify({ provider: "easyslip", easyKey: "easy" });
    stubFetchJson({
      status: 200,
      data: { application: "Concert", usedQuota: 1, maxQuota: 50, remainingQuota: 49, expiredAt: "2026-06-10T20:19:03+07:00" },
    });
    const s = await mod.getSlipProviderStatus({ now: new Date("2026-08-27T10:00:00+07:00") });
    expect(s.label).toBe("EasySlip");
    expect(s.tone).toBe("danger");
    expect(s.line).toContain("หมดอายุแล้ว");
    expect(s.hint).toContain("SLIP_PROVIDER=slipok");
  });
});
