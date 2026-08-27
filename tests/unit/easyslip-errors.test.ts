// Unit tests — lib/easyslip.ts ส่วน "บอกความจริงเมื่อ EasySlip ปฏิเสธ" + สถานะแอป (2026-08-27)
// บั๊กที่จับ: โอนจริงครั้งแรกบน prod → EasySlip ตอบ 403 application_expired (แอปหมดอายุตั้งแต่ 10 มิ.ย.)
//   แต่ผู้ใช้เห็น "ตรวจสอบสลิปไม่สำเร็จ — สลิปอาจไม่ถูกต้อง" ทั้งที่สลิปถูก และ log ไม่มีรหัส error ให้ไล่
// ต้องพิสูจน์ว่า:
//   - error ฝั่งระบบ (คีย์/แอป/โควต้า) → บอกผู้ใช้ว่า "ไม่ใช่ความผิดของสลิป" + log รหัส
//   - error ฝั่งสลิป (อ่านไม่ได้/ไม่พบ/ซ้ำ) → บอกวิธีแก้ที่ผู้ใช้ทำได้
//   - รูปถูกส่งเป็น multipart ฟิลด์ "file" แบบไบนารี (ตัด prefix data URL) + Bearer key
//   - fetchEasySlipAccountStatus / easySlipHealthWarnings แปล /me เป็นสถานะหมดอายุ/โควต้า ไม่ throw
import { describe, it, expect, vi, afterEach } from "vitest";

// โหลดโมดูลใหม่พร้อม mock env (verifySlip อ่านค่าคงที่จาก lib/env ตอน import)
async function loadEasySlip(opts: { configured?: boolean; production?: boolean } = {}) {
  const { configured = true, production = false } = opts;
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      EASYSLIP_API_KEY: configured ? "test-key" : "",
      PROMPTPAY_ID: "0812345678",
      PAYMENTS_RECEIVER_CHECK: true,
      PAYMENTS_RECEIVER_NAME: undefined,
    },
    isEasySlipConfigured: configured,
    isProduction: production,
  }));
  vi.doMock("@/lib/slip-match", () => ({
    receiverMatchesPromptPay: () => true,
    receiverNameMatches: () => true,
  }));
  vi.doMock("@/lib/slip-date", () => ({
    parseSlipDate: (s?: string) => (s ? new Date(s) : undefined),
  }));
  return import("@/lib/easyslip");
}

function stubFetchJson(body: unknown, httpStatus = 200) {
  const fn = vi.fn().mockResolvedValue({ status: httpStatus, json: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

// PNG 1x1 จริง (base64) — ใช้เช็คว่า decode เป็นไบนารีถูก
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("describeEasySlipError — แยกให้ชัดว่าใครต้องแก้", () => {
  it("รหัสฝั่งระบบ (application_expired/unauthorized/quota_exceeded) → kind=system + บอกผู้ใช้ว่าไม่ใช่ความผิดของสลิป", async () => {
    const { describeEasySlipError } = await loadEasySlip();
    for (const code of ["application_expired", "unauthorized", "quota_exceeded", "account_not_verified"]) {
      const d = describeEasySlipError(code);
      expect(d.kind).toBe("system");
      expect(d.userMessage).toContain("ไม่ใช่ความผิดของสลิป");
      expect(d.userMessage).toContain(code); // รหัสสั้น ๆ ให้แจ้งแอดมินได้
      expect(d.userMessage).not.toContain("สลิปอาจไม่ถูกต้อง");
    }
    expect(describeEasySlipError("application_expired").adminMessage).toContain("EASYSLIP_API_KEY");
  });

  it("รหัสฝั่งสลิป → kind=slip + บอกวิธีแก้ที่ผู้ใช้ทำได้", async () => {
    const { describeEasySlipError } = await loadEasySlip();
    expect(describeEasySlipError("invalid_image").userMessage).toContain("QR");
    expect(describeEasySlipError("slip_not_found").userMessage).toContain("ไม่พบรายการโอน");
    expect(describeEasySlipError("duplicate_slip").userMessage).toContain("ซ้ำ");
    expect(describeEasySlipError("image_size_too_large").userMessage).toContain("4MB");
    for (const code of ["invalid_image", "slip_not_found", "duplicate_slip", "slip_pending"]) {
      expect(describeEasySlipError(code).kind).toBe("slip");
    }
  });

  it("รหัสไม่รู้จัก/ไม่มี → ข้อความกลาง ๆ ของเดิม (ยังคง fail-closed)", async () => {
    const { describeEasySlipError } = await loadEasySlip();
    expect(describeEasySlipError(undefined).kind).toBe("unknown");
    expect(describeEasySlipError(undefined).userMessage).toContain("ตรวจสอบสลิปไม่สำเร็จ");
    expect(describeEasySlipError("something_new").userMessage).toContain("something_new");
  });
});

describe("verifySlip — เมื่อ EasySlip ปฏิเสธ", () => {
  it("403 application_expired → ปฏิเสธ + ข้อความ 'ไม่ใช่ความผิดของสลิป' + errorCode + log รหัส", async () => {
    const { verifySlip } = await loadEasySlip();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetchJson({ status: 403, message: "application_expired" }, 403);
    const r = await verifySlip({ slipImageBase64: `data:image/png;base64,${PNG_1X1}`, expectedAmount: 2 });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("application_expired");
    expect(r.error).toContain("ไม่ใช่ความผิดของสลิป");
    expect(r.error).not.toContain("สลิปอาจไม่ถูกต้อง");
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain("application_expired");
  });

  it("404 slip_not_found → ปฏิเสธด้วยข้อความที่ผู้ใช้แก้ได้ (ไม่ใช่ 'ติดต่อผู้ดูแล')", async () => {
    const { verifySlip } = await loadEasySlip();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetchJson({ status: 404, message: "slip_not_found" }, 404);
    const r = await verifySlip({ slipImageBase64: `data:image/png;base64,${PNG_1X1}`, expectedAmount: 2 });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("slip_not_found");
    expect(r.error).toContain("ไม่พบรายการโอน");
  });

  it("ส่งรูปเป็น multipart ฟิลด์ 'file' ไบนารี (ตัด prefix data URL) + Authorization Bearer + ไม่ตั้ง Content-Type เอง", async () => {
    const { verifySlip } = await loadEasySlip();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = stubFetchJson({ status: 400, message: "invalid_image" }, 400);
    await verifySlip({ slipImageBase64: `data:image/png;base64,${PNG_1X1}`, expectedAmount: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://developer.easyslip.com/api/v1/verify");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined(); // ให้ fetch ใส่ boundary เอง
    expect(init.body).toBeInstanceOf(FormData);
    const file = (init.body as FormData).get("file");
    expect(file).toBeInstanceOf(Blob);
    // ขนาดต้องเท่ากับไบนารีของ base64 ล้วน — ถ้าไม่ได้ตัด prefix หรือ decode ผิด ขนาดจะไม่ตรง
    expect((file as Blob).size).toBe(Buffer.from(PNG_1X1, "base64").length);
    expect((file as Blob).type).toBe("image/png");
  });

  it("decodeSlipImage: ไม่มี prefix → ถือเป็น jpeg · มี whitespace ในเนื้อ base64 → ตัดทิ้ง", async () => {
    const { decodeSlipImage } = await loadEasySlip();
    const plain = decodeSlipImage(PNG_1X1);
    expect(plain.mime).toBe("image/jpeg");
    const expectedLen = Buffer.from(PNG_1X1, "base64").length;
    expect(plain.bytes.length).toBe(expectedLen);
    const spaced = decodeSlipImage(`data:image/jpeg;base64,${PNG_1X1.slice(0, 10)}\n${PNG_1X1.slice(10)}`);
    expect(spaced.bytes.length).toBe(expectedLen);
    expect(spaced.ext).toBe("jpg");
  });
});

describe("fetchEasySlipAccountStatus / easySlipHealthWarnings — /me", () => {
  const now = new Date("2026-08-27T10:00:00+07:00");

  it("แอปหมดอายุ (เคสจริง 2026-06-10) → expired=true, daysLeft ติดลบ, ok=false + คำเตือนบอกให้อัปเดตคีย์", async () => {
    const { fetchEasySlipAccountStatus, easySlipHealthWarnings } = await loadEasySlip();
    stubFetchJson({
      status: 200,
      data: { application: "Concert", usedQuota: 1, maxQuota: 50, remainingQuota: 49, expiredAt: "2026-06-10T20:19:03+07:00", currentCredit: 0 },
    });
    const s = await fetchEasySlipAccountStatus({ now });
    expect(s.configured).toBe(true);
    expect(s.ok).toBe(false);
    expect(s.expired).toBe(true);
    expect(s.daysLeft).toBeLessThan(0);
    expect(s.application).toBe("Concert");
    expect(s.remainingQuota).toBe(49);
    const warnings = easySlipHealthWarnings(s);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("หมดอายุแล้ว");
    expect(warnings[0]).toContain("EASYSLIP_API_KEY");
  });

  it("แอปปกติ → ok=true ไม่มีคำเตือน · ใกล้หมดอายุ (≤7 วัน) / โควต้าเหลือ ≤10 → เตือน", async () => {
    const { fetchEasySlipAccountStatus, easySlipHealthWarnings } = await loadEasySlip();
    stubFetchJson({
      status: 200,
      data: { application: "Concert", usedQuota: 5, maxQuota: 50, remainingQuota: 45, expiredAt: "2026-12-31T00:00:00+07:00" },
    });
    const fine = await fetchEasySlipAccountStatus({ now });
    expect(fine.ok).toBe(true);
    expect(easySlipHealthWarnings(fine)).toEqual([]);

    stubFetchJson({
      status: 200,
      data: { application: "Concert", usedQuota: 45, maxQuota: 50, remainingQuota: 5, expiredAt: "2026-08-30T00:00:00+07:00" },
    });
    const soon = await fetchEasySlipAccountStatus({ now });
    expect(soon.ok).toBe(true);
    expect(soon.daysLeft).toBe(2);
    const warnings = easySlipHealthWarnings(soon);
    expect(warnings.some((w) => w.includes("จะหมดอายุ"))).toBe(true);
    expect(warnings.some((w) => w.includes("โควต้า"))).toBe(true);
  });

  it("คีย์ผิด (401) หรือ network พัง → ok=false + error ไม่ throw · ไม่ตั้งคีย์ → configured=false ไม่เรียก fetch", async () => {
    const { fetchEasySlipAccountStatus, easySlipHealthWarnings } = await loadEasySlip();
    stubFetchJson({ status: 401, message: "unauthorized" }, 401);
    const bad = await fetchEasySlipAccountStatus({ now });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("unauthorized");
    expect(easySlipHealthWarnings(bad)[0]).toContain("unauthorized");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const down = await fetchEasySlipAccountStatus({ now });
    expect(down.ok).toBe(false);
    expect(down.error).toContain("network down");

    const mod = await loadEasySlip({ configured: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const none = await mod.fetchEasySlipAccountStatus({ now });
    expect(none.configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mod.easySlipHealthWarnings(none)).toEqual([]);
  });
});
