// Unit tests — lib/local-datetime.ts: ค่าจาก datetime-local ต้องถูกตีความเป็นเวลาไทยเสมอ ไม่ใช่ TZ ของ server
// บั๊กที่จับ (user-test 2026-08-26): กรอก 20 ธ.ค. 19:00 บนหน้าแอดมิน → โชว์ "21 ธันวาคม 02:00" เพราะ server (UTC) อ่านเป็น UTC
import { describe, it, expect } from "vitest";
import { parseThaiDateTimeLocal } from "@/lib/local-datetime";

describe("parseThaiDateTimeLocal — สตริงจาก <input type=datetime-local>", () => {
  it("ไม่มี timezone → ถือเป็นเวลาไทย (+07:00): 19:00 ไทย = 12:00Z", () => {
    expect(parseThaiDateTimeLocal("2026-12-20T19:00")?.toISOString()).toBe("2026-12-20T12:00:00.000Z");
  });

  it("มีวินาทีมาด้วยก็ยังถือเป็นเวลาไทย", () => {
    expect(parseThaiDateTimeLocal("2026-08-26T16:00:30")?.toISOString()).toBe("2026-08-26T09:00:30.000Z");
  });

  it("ข้ามวันตอนแปลง: 02:00 ไทย = 19:00Z ของวันก่อนหน้า", () => {
    expect(parseThaiDateTimeLocal("2026-12-21T02:00")?.toISOString()).toBe("2026-12-20T19:00:00.000Z");
  });

  it("มี Z อยู่แล้ว (client แปลงเป็น ISO มาก่อน) → ใช้ตามนั้น ไม่เลื่อนซ้ำ", () => {
    expect(parseThaiDateTimeLocal("2026-12-20T12:00:00.000Z")?.toISOString()).toBe("2026-12-20T12:00:00.000Z");
  });

  it("มี offset อยู่แล้ว → ใช้ตามนั้น", () => {
    expect(parseThaiDateTimeLocal("2026-12-20T19:00:00+07:00")?.toISOString()).toBe("2026-12-20T12:00:00.000Z");
  });

  it("ว่าง / null / รูปแบบพัง → null (ไม่คืน Invalid Date เงียบ ๆ)", () => {
    expect(parseThaiDateTimeLocal("")).toBeNull();
    expect(parseThaiDateTimeLocal(null)).toBeNull();
    expect(parseThaiDateTimeLocal(undefined)).toBeNull();
    expect(parseThaiDateTimeLocal("20/12/2026 19:00")).toBeNull();
    expect(parseThaiDateTimeLocal("2026-13-45T99:99")).toBeNull();
  });
});
