// Unit tests — lib/health.ts: สรุปผล probe เป็น status/body สั้น ๆ + withTimeout ไม่แขวน
import { describe, it, expect } from "vitest";
import { summarizeHealth, withTimeout } from "@/lib/health";

describe("summarizeHealth", () => {
  it("ทั้งคู่ผ่าน → 200 ok", () => {
    expect(summarizeHealth(true, true)).toEqual({ status: 200, body: { ok: true, db: "ok", redis: "ok" } });
  });

  it("DB ล้ม → 503 และบอกว่า db fail (redis ยัง ok)", () => {
    expect(summarizeHealth(false, true)).toEqual({ status: 503, body: { ok: false, db: "fail", redis: "ok" } });
  });

  it("Redis ล้ม → 503", () => {
    expect(summarizeHealth(true, false).status).toBe(503);
    expect(summarizeHealth(true, false).body.redis).toBe("fail");
  });

  it("ล้มทั้งคู่ → 503 ทั้ง fail", () => {
    expect(summarizeHealth(false, false).body).toEqual({ ok: false, db: "fail", redis: "fail" });
  });

  it("body ไม่มี field อื่นหลุด (ไม่เปิดเผยรายละเอียด)", () => {
    expect(Object.keys(summarizeHealth(true, true).body).sort()).toEqual(["db", "ok", "redis"]);
  });
});

describe("withTimeout", () => {
  it("เสร็จก่อนหมดเวลา → คืนค่าปกติ", async () => {
    await expect(withTimeout(Promise.resolve("PONG"), 50)).resolves.toBe("PONG");
  });

  it("ช้ากว่ากำหนด → reject (ผู้เรียก map เป็น fail) ไม่แขวน", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200));
    await expect(withTimeout(slow, 20)).rejects.toThrow(/timeout/);
  });

  it("promise ที่ reject เอง → reject ต่อ (ไม่กลืน error)", async () => {
    await expect(withTimeout(Promise.reject(new Error("db down")), 50)).rejects.toThrow("db down");
  });
});
