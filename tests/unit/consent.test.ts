// Unit tests — lib/consent.ts: server ต้องตัดสิน "ยอมรับข้อกำหนดแล้ว" จากค่าที่ส่งมาจริง ไม่ใช่เชื่อ required ฝั่งเบราว์เซอร์
// บั๊กที่กัน (gap map 2026-08-27 — PDPA): สมัครโดยไม่เคยยอมรับการเก็บ fingerprint/พฤติกรรม/สลิป
import { describe, it, expect } from "vitest";
import { hasAcceptedTerms, CONSENT_FIELD, CONSENT_REQUIRED_MESSAGE } from "@/lib/consent";

describe("hasAcceptedTerms — ค่าจาก checkbox ในฟอร์มสมัคร", () => {
  it("checkbox ติ๊กแล้ว (เบราว์เซอร์ส่ง \"on\") → ยอมรับ", () => {
    expect(hasAcceptedTerms("on")).toBe(true);
  });

  it("ค่าจริงแบบอื่นที่ client อาจส่ง (true/1/yes, ไม่สนตัวพิมพ์/ช่องว่าง) → ยอมรับ", () => {
    expect(hasAcceptedTerms("true")).toBe(true);
    expect(hasAcceptedTerms(" YES ")).toBe(true);
    expect(hasAcceptedTerms("1")).toBe(true);
  });

  it("ไม่ได้ติ๊ก = ฟอร์มไม่ส่งช่องนี้มาเลย (null/undefined) → ไม่ยอมรับ", () => {
    expect(hasAcceptedTerms(null)).toBe(false);
    expect(hasAcceptedTerms(undefined)).toBe(false);
  });

  it("ค่าปลอม/ว่าง/off → ไม่ยอมรับ (กันสคริปต์ส่งอะไรก็ได้มาผ่าน)", () => {
    expect(hasAcceptedTerms("")).toBe(false);
    expect(hasAcceptedTerms("off")).toBe(false);
    expect(hasAcceptedTerms("false")).toBe(false);
    expect(hasAcceptedTerms("0")).toBe(false);
    expect(hasAcceptedTerms("accepted")).toBe(false);
  });

  it("ส่งไฟล์มาแทนข้อความ → ไม่ยอมรับ", () => {
    const file = new File(["on"], "on.txt", { type: "text/plain" });
    expect(hasAcceptedTerms(file)).toBe(false);
  });

  it("ชื่อช่องและข้อความ error เป็นค่าคงที่ที่ฟอร์มกับ server ใช้ร่วมกัน", () => {
    expect(CONSENT_FIELD).toBe("acceptTerms");
    expect(CONSENT_REQUIRED_MESSAGE).toContain("นโยบายความเป็นส่วนตัว");
  });
});
