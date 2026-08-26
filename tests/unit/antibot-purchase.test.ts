// เทสด่าน anti-bot ตอนกดซื้อ (SECURITY_TODO #1)
// จุดที่ต้องคุมให้แน่น: คนจริงห้ามโดนเด้ง / บอทชัด ๆ ต้องโดน / ทำ Turnstile ผ่านแล้วห้ามวนซ้ำ
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock Turnstile ก่อน import ตัวที่ทดสอบ — ไม่อยากยิงเน็ตจริงในเทส
const verifyTurnstileMock = vi.fn();
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: (...args: unknown[]) => verifyTurnstileMock(...args),
}));

const { assessPurchase, PURCHASE_ANTIBOT_CONFIG } = await import("@/lib/antibot-purchase");

// header ครบแบบ browser จริง
function realBrowserHeaders(): Headers {
  return new Headers({
    accept: "text/html,application/xhtml+xml",
    "accept-language": "th-TH,th;q=0.9",
  });
}

const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

beforeEach(() => {
  verifyTurnstileMock.mockReset();
});

describe("assessPurchase — token ต้องเป็นของด่านซื้อ (SECURITY_TODO #2)", () => {
  it("ส่ง action=purchase + Host ของคำขอให้ verifyTurnstile (token จากด่านคิวใช้ตรงนี้ไม่ได้)", async () => {
    verifyTurnstileMock.mockResolvedValue({ success: true, devMode: false });
    const headers = realBrowserHeaders();
    headers.set("host", "concert-antibot.vercel.app");
    await assessPurchase({ userAgent: REAL_UA, headers, turnstileToken: "tok", ip: "203.0.113.7" });
    expect(verifyTurnstileMock).toHaveBeenCalledWith("tok", "203.0.113.7", {
      action: "purchase",
      hostname: "concert-antibot.vercel.app",
    });
  });

  it("verifyTurnstile ตอบไม่ผ่านเพราะ action-mismatch → นับเป็น fail (+55) เหมือน token ปลอม", async () => {
    verifyTurnstileMock.mockResolvedValue({ success: false, devMode: false, errorCodes: ["action-mismatch"] });
    const r = await assessPurchase({ userAgent: REAL_UA, headers: realBrowserHeaders(), turnstileToken: "tok" });
    expect(r.signals.turnstile).toBe("fail");
    expect(r.score).toBe(55);
    expect(r.action).toBe("CHALLENGE");
  });
});

describe("assessPurchase — คนซื้อจริง", () => {
  it("เบราว์เซอร์ปกติที่ไม่มี Turnstile token ต้องผ่าน (ไม่ใช่ CHALLENGE ยกแผง)", async () => {
    const r = await assessPurchase({
      userAgent: REAL_UA,
      headers: realBrowserHeaders(),
    });
    expect(r.action).toBe("ALLOW");
    expect(r.score).toBe(0);
    // จุดตายของด่านนี้: ถ้าไปยืมกติกาด่านคิว (ไม่ส่ง token = +40) คนจริงจะโดนเด้งทุกคน
    expect(r.signals.turnstile).toBe("not-required");
  });

  it("ไม่เรียก verifyTurnstile เลยถ้าไม่มี token (ไม่เผาโควตา/latency บนเส้นทางเงิน)", async () => {
    await assessPurchase({ userAgent: REAL_UA, headers: realBrowserHeaders() });
    expect(verifyTurnstileMock).not.toHaveBeenCalled();
  });

  it("สัญญาณอ่อนตัวเดียว (header ไม่ครบ) ยังไม่พอให้เด้ง", async () => {
    const r = await assessPurchase({
      userAgent: REAL_UA,
      headers: new Headers({ accept: "*/*" }), // ขาด accept-language
    });
    expect(r.signals.headers).toBe("incomplete");
    expect(r.action).toBe("ALLOW");
  });
});

describe("assessPurchase — บอท", () => {
  it("UA ที่เขียนว่าเป็นสคริปต์ + header ไม่ครบ → CHALLENGE เป็นอย่างน้อย", async () => {
    const r = await assessPurchase({
      userAgent: "python-requests/2.31.0",
      headers: new Headers(),
    });
    expect(r.signals.userAgent).toBe("bot");
    expect(r.action).not.toBe("ALLOW");
  });

  it("UA สคริปต์ + Layer 2 บอกว่า botlike → BLOCK", async () => {
    const r = await assessPurchase({
      userAgent: "curl/8.5.0",
      headers: new Headers(),
      behaviorLikelyBot: true,
    });
    expect(r.action).toBe("BLOCK");
  });

  it("เคยโดน BLOCK สด ๆ + ไม่มี UA → BLOCK", async () => {
    const r = await assessPurchase({
      userAgent: "",
      headers: new Headers(),
      hasRecentBlock: true,
    });
    expect(r.signals.history).toBe("recent-block");
    expect(r.action).toBe("BLOCK");
  });

  it("ส่ง Turnstile token มาแล้วไม่ผ่าน = แย่กว่าไม่ส่ง", async () => {
    verifyTurnstileMock.mockResolvedValue({ success: false });
    const withBadToken = await assessPurchase({
      userAgent: REAL_UA,
      headers: realBrowserHeaders(),
      turnstileToken: "ปลอม",
    });
    const withoutToken = await assessPurchase({
      userAgent: REAL_UA,
      headers: realBrowserHeaders(),
    });
    expect(withBadToken.score).toBeGreaterThan(withoutToken.score);
    expect(withBadToken.signals.turnstile).toBe("fail");
  });
});

describe("assessPurchase — ทำ challenge ผ่านแล้วห้ามวนซ้ำ", () => {
  it("Layer 2 ว่า botlike แต่เพิ่งทำ Turnstile ผ่าน → ปลดเป็น ALLOW", async () => {
    verifyTurnstileMock.mockResolvedValue({ success: true, devMode: false });
    const r = await assessPurchase({
      userAgent: REAL_UA,
      headers: realBrowserHeaders(),
      turnstileToken: "ok",
      behaviorLikelyBot: true,
    });
    // ถ้าไม่ปลด ผู้ใช้จะติดกับ: ทำ Turnstile ผ่านแล้วโดนขอ Turnstile ซ้ำไม่จบ
    // (บั๊กแบบเดียวกับที่ด่านคิวเคยเจอจาก row isLikelyBot ค้าง)
    expect(r.action).toBe("ALLOW");
    expect(r.signals.behavior).toBe("likely-bot"); // สัญญาณยังถูกบันทึกไว้ ไม่ได้ลบทิ้ง
  });

  it("แต่ Turnstile ผ่านต้อง **ไม่** ปลด BLOCK — สคริปต์ก็ทำ Turnstile ผ่านได้", async () => {
    verifyTurnstileMock.mockResolvedValue({ success: true, devMode: false });
    const r = await assessPurchase({
      userAgent: "python-requests/2.31.0",
      headers: new Headers(),
      turnstileToken: "ok",
      hasRecentBlock: true,
    });
    expect(r.action).toBe("BLOCK");
  });

  it("dev-pass ก็ถือว่าผ่าน (ให้ demo ในเครื่องเดินได้โดยไม่ต้องมีคีย์จริง)", async () => {
    verifyTurnstileMock.mockResolvedValue({ success: true, devMode: true });
    const r = await assessPurchase({
      userAgent: REAL_UA,
      headers: realBrowserHeaders(),
      turnstileToken: "dev",
      behaviorLikelyBot: true,
    });
    expect(r.signals.turnstile).toBe("dev-pass");
    expect(r.action).toBe("ALLOW");
  });
});

describe("assessPurchase — ขอบเขตคะแนน", () => {
  it("คะแนนไม่ทะลุ 100 แม้สัญญาณเสียครบทุกตัว", async () => {
    verifyTurnstileMock.mockResolvedValue({ success: false });
    const r = await assessPurchase({
      userAgent: "",
      headers: new Headers(),
      turnstileToken: "ปลอม",
      behaviorLikelyBot: true,
      hasRecentBlock: true,
    });
    expect(r.score).toBe(100);
    expect(r.action).toBe("BLOCK");
  });

  it("หน้าต่างเวลาที่นับ BotEvent เก่ายังเป็น 30 นาที (กันแก้ค่าหลุดโดยไม่ตั้งใจ)", () => {
    expect(PURCHASE_ANTIBOT_CONFIG.RECENT_BLOCK_WINDOW_MS).toBe(30 * 60_000);
  });
});
