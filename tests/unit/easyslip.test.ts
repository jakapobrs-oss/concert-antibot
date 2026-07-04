// Unit tests — EasySlip slip verification (lib/easyslip.ts: verifySlip)
// นี่คือชั้น "ยืนยันว่าเงินเข้าจริง" — ต้องพิสูจน์ว่า:
//   - บังคับแนบสลิปเสมอ (กดจ่ายเปล่าไม่ได้)
//   - ไม่มี key + production → ปฏิเสธ (fail-closed) ไม่แจกตั๋วฟรี  [H1]
//   - ไม่มี key + dev → mock ผ่าน (ยังบังคับแนบสลิป)
//   - มี key → ตรวจ receiver ตรงบัญชีเรา + ต้องมี transRef [H3] + map shape ของ EasySlip ถูก
//
// เทคนิค: verifySlip อ่าน isEasySlipConfigured / isProduction (ค่าคงที่จาก lib/env)
//   → ใช้ vi.resetModules + vi.doMock + dynamic import เพื่อสลับ config ต่อ test
import { describe, it, expect, vi, afterEach } from "vitest";

interface LoadOpts {
  isEasySlipConfigured?: boolean;
  isProduction?: boolean;
  promptPayId?: string;
  receiverCheck?: boolean;
  receiverMatch?: boolean;
  receiverName?: string; // ค่า env PAYMENTS_RECEIVER_NAME (undefined = ไม่ตั้ง = ข้ามเช็คชื่อ)
  receiverNameMatch?: boolean; // ผล mock ของ receiverNameMatches
}

// โหลด verifySlip ใหม่พร้อม mock env/slip-match/slip-date ตาม config ที่ต้องการ
async function loadVerifySlip(opts: LoadOpts = {}) {
  const {
    isEasySlipConfigured = false,
    isProduction = false,
    promptPayId = "0812345678",
    receiverCheck = true,
    receiverMatch = true,
    receiverName = undefined,
    receiverNameMatch = true,
  } = opts;

  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      EASYSLIP_API_KEY: isEasySlipConfigured ? "test-key" : "",
      PROMPTPAY_ID: promptPayId,
      PAYMENTS_RECEIVER_CHECK: receiverCheck,
      PAYMENTS_RECEIVER_NAME: receiverName,
    },
    isEasySlipConfigured,
    isProduction,
  }));
  // mock การจับคู่ receiver (มี unit test แยกใน slip-match.test.ts แล้ว) — ที่นี่คุมผล true/false ตรงๆ
  vi.doMock("@/lib/slip-match", () => ({
    receiverMatchesPromptPay: () => receiverMatch,
    receiverNameMatches: () => receiverNameMatch,
  }));
  vi.doMock("@/lib/slip-date", () => ({
    parseSlipDate: (s?: string) => (s ? new Date(s) : undefined),
  }));

  const mod = await import("@/lib/easyslip");
  return mod.verifySlip;
}

// stub global fetch ให้คืน JSON ที่กำหนด (ใช้เลียนแบบ response ของ EasySlip)
function stubFetchJson(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => body }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("verifySlip — ชั้นที่ 1: บังคับแนบสลิป", () => {
  it("ไม่แนบทั้งรูปและ payload → ปฏิเสธทันที (ทุกโหมด)", async () => {
    const verifySlip = await loadVerifySlip({ isEasySlipConfigured: true });
    const r = await verifySlip({ expectedAmount: 100 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("กรุณาแนบสลิป");
  });
});

describe("verifySlip — ไม่มี key (fail-closed บน production)", () => {
  it("production + ไม่มี key → ปฏิเสธ ไม่แจกตั๋วฟรี [H1]", async () => {
    const verifySlip = await loadVerifySlip({ isEasySlipConfigured: false, isProduction: true });
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 500 });
    expect(r.success).toBe(false);
    expect(r.devMode).toBe(false);
    expect(r.error).toContain("ผู้ดูแล");
  });

  it("development + ไม่มี key → mock ผ่าน (ถือว่าโอนตรงยอด) แต่ flag devMode", async () => {
    const verifySlip = await loadVerifySlip({ isEasySlipConfigured: false, isProduction: false });
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 777 });
    expect(r.success).toBe(true);
    expect(r.devMode).toBe(true);
    expect(r.amount).toBe(777); // mock = ตรงยอดที่ order ต้องการ
    expect(r.ref).toMatch(/^DEV-/);
    expect(r.receiverAccount).toBe("0812345678");
  });
});

describe("verifySlip — มี key: เรียก EasySlip จริง (mock fetch)", () => {
  // response ปกติของ EasySlip ที่ผ่านทุกด่าน
  function okBody(overrides: Record<string, unknown> = {}) {
    return {
      status: 200,
      data: {
        amount: { amount: 1500 },
        transRef: "TXN-ABC-123",
        sender: { account: { name: { th: "นายทดสอบ ใจดี" } } },
        receiver: { account: { proxy: { account: "0xx-xxx-5678" } } },
        date: "2026-06-06T10:00:00+07:00",
        ...overrides,
      },
    };
  }

  it("สลิปถูกต้องครบ → success + map ยอด/ref/ผู้โอน/ปลายทาง ถูกต้อง", async () => {
    const verifySlip = await loadVerifySlip({ isEasySlipConfigured: true, receiverMatch: true });
    stubFetchJson(okBody());
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.success).toBe(true);
    expect(r.devMode).toBe(false);
    expect(r.amount).toBe(1500);
    expect(r.ref).toBe("TXN-ABC-123");
    expect(r.senderName).toBe("นายทดสอบ ใจดี");
    expect(r.receiverAccount).toBe("0xx-xxx-5678");
    expect(r.transAt).toBeInstanceOf(Date);
  });

  it("EasySlip คืน status != 200 → ปฏิเสธ (สลิปไม่ถูกต้อง)", async () => {
    const verifySlip = await loadVerifySlip({ isEasySlipConfigured: true });
    stubFetchJson({ status: 400, data: null });
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("ตรวจสอบสลิปไม่สำเร็จ");
  });

  it("ชั้นที่ 2: receiver ไม่ตรงบัญชีเรา → ปฏิเสธ (กันแนบสลิปที่โอนหาคนอื่น)", async () => {
    const verifySlip = await loadVerifySlip({ isEasySlipConfigured: true, receiverMatch: false });
    stubFetchJson(okBody());
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("ไม่ได้โอนเข้าบัญชีของระบบ");
  });

  it("เปิด receiver check แต่ไม่ได้ตั้ง PROMPTPAY_ID → ปฏิเสธ (misconfig = fail-closed)", async () => {
    const verifySlip = await loadVerifySlip({ isEasySlipConfigured: true, promptPayId: "" });
    stubFetchJson(okBody());
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("PROMPTPAY_ID");
  });

  it("สลิปไม่มี transRef → ปฏิเสธ [H3] (กัน slipRef NULL ซ้ำ → dedup หลุด)", async () => {
    const verifySlip = await loadVerifySlip({ isEasySlipConfigured: true, receiverMatch: true });
    stubFetchJson(okBody({ transRef: undefined, ref: undefined }));
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("transRef");
  });

  it("ปิด receiver check → ข้ามการตรวจปลายทาง (ผ่านแม้ receiver ไม่ match)", async () => {
    const verifySlip = await loadVerifySlip({
      isEasySlipConfigured: true,
      receiverCheck: false,
      receiverMatch: false,
    });
    stubFetchJson(okBody());
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.success).toBe(true);
  });

  it("รองรับ amount แบบ flat (data.amount เป็นตัวเลขตรงๆ ไม่ใช่ object)", async () => {
    const verifySlip = await loadVerifySlip({ isEasySlipConfigured: true });
    stubFetchJson(okBody({ amount: 2000 }));
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 2000 });
    expect(r.success).toBe(true);
    expect(r.amount).toBe(2000);
  });

  it("senderName fallback ไป d.sender.name เมื่อไม่มี account.name", async () => {
    const verifySlip = await loadVerifySlip({ isEasySlipConfigured: true });
    stubFetchJson(okBody({ sender: { name: "JOHN DOE" } }));
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.senderName).toBe("JOHN DOE");
  });

  it("receiverAccount fallback ไป bank.account เมื่อไม่มี proxy", async () => {
    const verifySlip = await loadVerifySlip({ isEasySlipConfigured: true, receiverMatch: true });
    stubFetchJson(okBody({ receiver: { account: { bank: { account: "123-4-56789-0" } } } }));
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.receiverAccount).toBe("123-4-56789-0");
  });

  it("fetch error (network) → ปฏิเสธอย่างปลอดภัย ไม่ throw", async () => {
    const verifySlip = await loadVerifySlip({ isEasySlipConfigured: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("EasySlip");
  });

  // ---- ชั้นที่ 2.5 (Codex #1): เช็คชื่อบัญชีผู้รับ — กันบัญชี attacker ที่เลขท้ายพ้องกับร้าน ----
  it("ชั้นที่ 2.5: ตั้ง PAYMENTS_RECEIVER_NAME + ชื่อผู้รับตรง → ผ่าน", async () => {
    const verifySlip = await loadVerifySlip({
      isEasySlipConfigured: true,
      receiverName: "จักรภพ ยมรัตน์",
      receiverNameMatch: true,
    });
    stubFetchJson(
      okBody({
        receiver: { account: { proxy: { account: "0xx-xxx-5678" }, name: { th: "นาย จักรภพ ย." } } },
      })
    );
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.success).toBe(true);
  });

  it("ชั้นที่ 2.5: ❌ ชื่อผู้รับไม่ตรง → ปฏิเสธ (เลขท้ายพ้องกันแต่เป็นบัญชีคนอื่น)", async () => {
    const verifySlip = await loadVerifySlip({
      isEasySlipConfigured: true,
      receiverName: "จักรภพ ยมรัตน์",
      receiverNameMatch: false,
    });
    stubFetchJson(
      okBody({
        receiver: { account: { proxy: { account: "0xx-xxx-5678" }, name: { th: "นาย คนอื่น จริงๆ" } } },
      })
    );
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("ชื่อบัญชีผู้รับ");
  });

  it("ชั้นที่ 2.5: ❌ สลิปไม่มีชื่อผู้รับเลย → ปฏิเสธ (ตรวจไม่ได้ = fail-closed)", async () => {
    const verifySlip = await loadVerifySlip({
      isEasySlipConfigured: true,
      receiverName: "จักรภพ ยมรัตน์",
      receiverNameMatch: true, // ต่อให้ matcher ใจดี แต่ไม่มีชื่อให้เทียบ → ต้องปฏิเสธก่อนถึง matcher
    });
    stubFetchJson(okBody()); // okBody เดิมมีแต่ proxy account ไม่มีชื่อผู้รับ
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.success).toBe(false);
    expect(r.error).toContain("ชื่อบัญชีผู้รับ");
  });

  it("ชั้นที่ 2.5: ไม่ได้ตั้ง PAYMENTS_RECEIVER_NAME → ข้ามเช็คชื่อ (พฤติกรรมเดิมไม่พัง)", async () => {
    const verifySlip = await loadVerifySlip({
      isEasySlipConfigured: true,
      receiverName: undefined,
      receiverNameMatch: false, // matcher บอกไม่ตรง แต่ไม่ได้ตั้ง env → ไม่เรียกใช้
    });
    stubFetchJson(okBody());
    const r = await verifySlip({ slipImageBase64: "data:image/png;base64,AAAA", expectedAmount: 1500 });
    expect(r.success).toBe(true);
  });
});
