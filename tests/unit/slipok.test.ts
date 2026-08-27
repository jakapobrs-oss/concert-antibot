// Unit tests — lib/slipok.ts: ผู้ให้บริการตรวจสลิปเจ้าที่ 2 (SLIP_PROVIDER=slipok) — rev 40 (2026-08-27)
// ต้องพิสูจน์ว่า:
//   - คุยกับ SlipOK ตามสัญญา: POST /api/line/apikey/{branchId} header x-authorization, multipart files/amount/log
//   - แกะคำตอบสำเร็จเป็น SlipVerifyResult เดิม (ยอด/ผู้จ่าย/ปลายทาง/transRef/เวลาไทย) → ด่านนโยบายกลางทำงานเหมือน EasySlip
//   - รหัส error แยกฝั่งระบบ (1001–1004) / ชั่วคราว (1009/1010) / สลิป (1005–1008, 1011–1014) + log รหัส
//   - ไม่ตั้งคีย์: production fail-closed · dev mock (กติกาเดียวกับ EasySlip)
//   - โควต้า (/quota) → สถานะ + คำเตือน ไม่ throw
import { describe, it, expect, vi, afterEach } from "vitest";

interface LoadOpts {
  configured?: boolean;
  production?: boolean;
  log?: boolean;
  receiverName?: string;
}

async function loadSlipOk(opts: LoadOpts = {}) {
  const { configured = true, production = false, log = false, receiverName = undefined } = opts;
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      SLIP_PROVIDER: "slipok",
      SLIPOK_API_KEY: configured ? "sk-test-key" : "",
      SLIPOK_BRANCH_ID: configured ? "12345" : "",
      SLIPOK_LOG: log,
      EASYSLIP_API_KEY: "",
      PROMPTPAY_ID: "0621991966",
      PAYMENTS_RECEIVER_CHECK: true,
      PAYMENTS_RECEIVER_NAME: receiverName,
    },
    isSlipOkConfigured: configured,
    isEasySlipConfigured: false,
    isProduction: production,
  }));
  return import("@/lib/slipok");
}

function stubFetchJson(body: unknown, httpStatus = 200) {
  const fn = vi.fn().mockResolvedValue({ ok: httpStatus < 400, status: httpStatus, json: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const IMAGE = `data:image/png;base64,${PNG_1X1}`;

// คำตอบสำเร็จของ SlipOK (shape ตาม SDK) — ข้อมูลล้อกับสลิปจริงที่ user โอน 2 บาท 27 ส.ค. 2026
function okBody(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      success: true,
      message: "",
      rqUID: "rq-1",
      language: "TH",
      transRef: "0462395o947q99kneEYF",
      sendingBank: "004",
      receivingBank: "006",
      transDate: "20260827",
      transTime: "09:36:12",
      sender: {
        displayName: "นาย ทดสอบ ใ",
        name: "นายทดสอบ ใจดี",
        proxy: { type: null, value: null },
        account: { type: "BANKAC", value: "xxx-x-x5710-x" },
      },
      receiver: {
        displayName: "นาย จักรภพ ร",
        name: "จักรภพ รามศักดิ์",
        proxy: { type: "MSISDN", value: "xxx-xxx-1966" },
        account: { type: "BANKAC", value: "xxx-x-x1234-x" },
      },
      amount: 2,
      paidLocalAmount: 2,
      paidLocalCurrency: "764",
      countryCode: "TH",
      transFeeAmount: 0,
      ref1: "",
      ref2: "",
      ref3: "",
      toMerchantId: "",
      ...overrides,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("verifySlipWithSlipOk — สำเร็จ", () => {
  it("แกะคำตอบเป็น SlipVerifyResult: ยอด/ref/ผู้จ่าย(บัญชี+ธนาคาร)/ปลายทาง(พร็อกซี)/เวลาไทย → UTC ถูก", async () => {
    const { verifySlipWithSlipOk } = await loadSlipOk();
    stubFetchJson(okBody());
    const r = await verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(r.success).toBe(true);
    expect(r.devMode).toBe(false);
    expect(r.amount).toBe(2);
    expect(r.ref).toBe("0462395o947q99kneEYF");
    expect(r.senderName).toBe("นาย ทดสอบ ใ");
    expect(r.senderAccount).toBe("xxx-x-x5710-x");
    expect(r.senderBank).toBe("004");
    expect(r.receiverAccount).toBe("xxx-xxx-1966"); // PromptPay เบอร์โทร masked — เทียบกับ PROMPTPAY_ID ได้
    // 27 ส.ค. 2026 09:36:12 เวลาไทย = 02:36:12Z
    expect(r.transAt?.toISOString()).toBe("2026-08-27T02:36:12.000Z");
  });

  it("ส่งคำขอตามสัญญา: URL มี branchId · header x-authorization · multipart files + amount + log=false (ค่าเริ่มต้น)", async () => {
    const { verifySlipWithSlipOk } = await loadSlipOk();
    const fetchMock = stubFetchJson(okBody());
    await verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.slipok.com/api/line/apikey/12345");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-authorization"]).toBe("sk-test-key");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const file = form.get("files");
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).size).toBe(Buffer.from(PNG_1X1, "base64").length); // ตัด prefix + decode ไบนารีถูก
    expect((file as Blob).type).toBe("image/png");
    expect(form.get("amount")).toBe("2");
    expect(form.get("log")).toBe("false");
  });

  it("SLIPOK_LOG=true → ส่ง log=true · payload จาก QR → ส่งฟิลด์ data แทนไฟล์", async () => {
    const { verifySlipWithSlipOk } = await loadSlipOk({ log: true });
    const fetchMock = stubFetchJson(okBody());
    await verifySlipWithSlipOk({ payload: "0046000600000101030040220...", expectedAmount: 2 });
    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.get("log")).toBe("true");
    expect(form.get("data")).toBe("0046000600000101030040220...");
    expect(form.get("files")).toBeNull();
  });

  it("ด่านนโยบายกลางยังทำงาน: ปลายทางไม่ใช่ PROMPTPAY_ID → ปฏิเสธ · ชื่อผู้รับ (displayName ถูกตัดท้าย) เทียบกับ PAYMENTS_RECEIVER_NAME ได้", async () => {
    const mod = await loadSlipOk();
    stubFetchJson(okBody({ receiver: { displayName: "นาย คนอื่น", name: "คนอื่น", proxy: { type: "MSISDN", value: "xxx-xxx-9999" }, account: { type: "BANKAC", value: "" } } }));
    const wrong = await mod.verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(wrong.success).toBe(false);
    expect(wrong.error).toContain("ไม่ได้โอนเข้าบัญชีของระบบ");

    const named = await loadSlipOk({ receiverName: "จักรภพ รามศักดิ์,Jakapob R" });
    stubFetchJson(okBody());
    const ok = await named.verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(ok.success).toBe(true);

    stubFetchJson(okBody({ receiver: { displayName: "นาย สมชาย ใ", name: "สมชาย ใจดี", proxy: { type: "MSISDN", value: "xxx-xxx-1966" }, account: { type: "BANKAC", value: "" } } }));
    const badName = await named.verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(badName.success).toBe(false);
    expect(badName.error).toContain("ชื่อบัญชีผู้รับ");
  });

  it("ไม่มี transRef → ปฏิเสธ (fail-closed กันสลิปซ้ำ)", async () => {
    const { verifySlipWithSlipOk } = await loadSlipOk();
    stubFetchJson(okBody({ transRef: "" }));
    const r = await verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("transRef");
  });
});

describe("verifySlipWithSlipOk — เมื่อ SlipOK ปฏิเสธ", () => {
  it("1002 (คีย์ผิด) → ฝั่งระบบ: บอกผู้ใช้ว่าไม่ใช่ความผิดของสลิป + errorCode + log รหัส", async () => {
    const { verifySlipWithSlipOk } = await loadSlipOk();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetchJson({ success: false, code: "1002", message: "Authorization Header ไม่ถูกต้อง" }, 401);
    const r = await verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("1002");
    expect(r.error).toContain("ไม่ใช่ความผิดของสลิป");
    expect(r.error).toContain("1002");
    expect(String(err.mock.calls[0][0])).toContain("SLIPOK_API_KEY");
  });

  it("1012 สลิปซ้ำ (มี data แนบมา) → ต้องปฏิเสธ ไม่หลงว่าสำเร็จเพราะมี data", async () => {
    const { verifySlipWithSlipOk } = await loadSlipOk();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetchJson({ success: false, code: "1012", message: "สลิปซ้ำ", data: okBody().data }, 400);
    const r = await verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("1012");
    expect(r.error).toContain("ซ้ำ");
  });

  it("1013 ยอดไม่ตรง → บอกยอดในสลิปเทียบยอดที่ต้องชำระ · 1014 ผิดบัญชี → บอกว่าไม่ได้โอนเข้าบัญชีของระบบ", async () => {
    const { verifySlipWithSlipOk } = await loadSlipOk();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetchJson({ success: false, code: "1013", message: "ยอดไม่ตรง", data: okBody({ amount: 5 }).data }, 400);
    const amt = await verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(amt.success).toBe(false);
    expect(amt.error).toBe("ยอดไม่ตรง: โอนมา 5 บาท แต่ต้องชำระ 2 บาท");

    stubFetchJson({ success: false, code: "1014", message: "บัญชีผู้รับไม่ตรง", data: okBody().data }, 400);
    const recv = await verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(recv.success).toBe(false);
    expect(recv.error).toContain("ไม่ได้โอนเข้าบัญชีของระบบ");
  });

  it("1010 ธนาคารหน่วง → บอกชื่อธนาคาร + นาทีที่ต้องรอ · 1009 ขัดข้องชั่วคราว → บอกให้ลองใหม่ใน 15 นาที (ไม่ใช่ 'ติดต่อผู้ดูแล')", async () => {
    const { verifySlipWithSlipOk, describeSlipOkError } = await loadSlipOk();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetchJson({ success: false, code: "1010", message: "รอ", data: { qrcodeData: "x", bankCode: "002", bankName: "กรุงเทพ", delay: 5 } }, 400);
    const wait = await verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(wait.success).toBe(false);
    expect(wait.error).toContain("กรุงเทพ");
    expect(wait.error).toContain("5 นาที");
    expect(describeSlipOkError("1009").kind).toBe("transient");
    expect(describeSlipOkError("1009").userMessage).toContain("15 นาที");
    expect(describeSlipOkError("1009").userMessage).not.toContain("ติดต่อผู้ดูแล");
  });

  it("รหัสสลิป (1005/1006/1007/1008/1011) → kind=slip บอกวิธีแก้ · รหัสไม่รู้จัก → ข้อความกลาง + รหัส", async () => {
    const { describeSlipOkError } = await loadSlipOk();
    for (const code of ["1005", "1006", "1007", "1008", "1011"]) {
      expect(describeSlipOkError(code).kind).toBe("slip");
      expect(describeSlipOkError(code).userMessage).not.toContain("ติดต่อผู้ดูแล");
    }
    for (const code of ["1001", "1002", "1003", "1004"]) expect(describeSlipOkError(code).kind).toBe("system");
    const unknown = describeSlipOkError("9999", { message: "?" });
    expect(unknown.kind).toBe("unknown");
    expect(unknown.userMessage).toContain("9999");
  });

  it("network พัง → ปฏิเสธอย่างปลอดภัย ไม่ throw", async () => {
    const { verifySlipWithSlipOk } = await loadSlipOk();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const r = await verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("เชื่อมต่อ");
  });
});

describe("verifySlipWithSlipOk — ไม่ตั้งคีย์ (กติกาเดียวกับ EasySlip)", () => {
  it("production → ปฏิเสธ (fail-closed) ไม่เรียก fetch · log บอก env ที่ขาด", async () => {
    const { verifySlipWithSlipOk } = await loadSlipOk({ configured: false, production: true });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("ยังไม่พร้อมใช้งาน");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(err.mock.calls[0][0])).toContain("SLIPOK_API_KEY");
    expect(String(err.mock.calls[0][0])).toContain("SLIPOK_BRANCH_ID");
  });

  it("development → mock ผ่าน (devMode) แต่ยังบังคับแนบสลิป", async () => {
    const { verifySlipWithSlipOk } = await loadSlipOk({ configured: false, production: false });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const none = await verifySlipWithSlipOk({ expectedAmount: 2 });
    expect(none.success).toBe(false);
    expect(none.error).toContain("กรุณาแนบสลิป");
    const mock = await verifySlipWithSlipOk({ slipImageBase64: IMAGE, expectedAmount: 2 });
    expect(mock.success).toBe(true);
    expect(mock.devMode).toBe(true);
    expect(mock.amount).toBe(2);
  });
});

describe("parseSlipOkDateTime", () => {
  it("YYYYMMDD + HH:mm:ss (เวลาไทย) → Date ถูก · รูปแบบผิด → undefined", async () => {
    const { parseSlipOkDateTime } = await loadSlipOk();
    expect(parseSlipOkDateTime("20260827", "09:36:12")?.toISOString()).toBe("2026-08-27T02:36:12.000Z");
    expect(parseSlipOkDateTime("20260827", "09:36")?.toISOString()).toBe("2026-08-27T02:36:00.000Z");
    expect(parseSlipOkDateTime("2026-08-27", "09:36:12")).toBeUndefined();
    expect(parseSlipOkDateTime(undefined, undefined)).toBeUndefined();
  });
});

describe("fetchSlipOkQuotaStatus / slipOkHealthWarnings", () => {
  it("โควต้าปกติ → ok ไม่เตือน · เรียก GET /quota ด้วย header เดียวกัน", async () => {
    const { fetchSlipOkQuotaStatus, slipOkHealthWarnings } = await loadSlipOk();
    const fetchMock = stubFetchJson({
      success: true,
      data: { quota: 90, specialQuota: 10, overQuota: 0, endDate: "2026-09-27", specialEndDate: null },
    });
    const s = await fetchSlipOkQuotaStatus();
    expect(s.ok).toBe(true);
    expect(s.remaining).toBe(100);
    expect(s.periodEndsAt?.toISOString()).toBe("2026-09-27T16:59:59.000Z"); // สิ้นวัน 27 ก.ย. เวลาไทย
    expect(slipOkHealthWarnings(s)).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.slipok.com/api/line/apikey/12345/quota");
    expect((init.headers as Record<string, string>)["x-authorization"]).toBe("sk-test-key");
  });

  it("โควต้าหมด → ok=false + เตือน 'หมดแล้ว' · เหลือน้อย → เตือนจำนวน · คีย์ผิด → error ไม่ throw · ไม่ตั้งคีย์ → configured=false", async () => {
    const mod = await loadSlipOk();
    stubFetchJson({ success: true, data: { quota: 0, specialQuota: 0, overQuota: 3 } });
    const empty = await mod.fetchSlipOkQuotaStatus();
    expect(empty.ok).toBe(false);
    expect(mod.slipOkHealthWarnings(empty)[0]).toContain("หมดแล้ว");

    stubFetchJson({ success: true, data: { quota: 4, specialQuota: 0, overQuota: 0 } });
    const low = await mod.fetchSlipOkQuotaStatus();
    expect(mod.slipOkHealthWarnings(low)[0]).toContain("เหลือ 4");

    stubFetchJson({ success: false, code: "1002", message: "bad key" }, 401);
    const bad = await mod.fetchSlipOkQuotaStatus();
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("1002");

    const none = await loadSlipOk({ configured: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const s = await none.fetchSlipOkQuotaStatus();
    expect(s.configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
