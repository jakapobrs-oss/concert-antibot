// Regression: clientIpFromXff — ต้องเอา hop ขวาสุด ไม่ใช่ซ้ายสุด (ที่ client ปลอมได้) (Codex §3/§4 F4)
import { describe, it, expect } from "vitest";
import { clientIpFromXff } from "@/lib/get-ip";

describe("clientIpFromXff (TRUSTED_PROXY_HOPS default 0)", () => {
  it("null / ว่าง → unknown", () => {
    expect(clientIpFromXff(null)).toBe("unknown");
    expect(clientIpFromXff("")).toBe("unknown");
    expect(clientIpFromXff(undefined)).toBe("unknown");
  });

  it("IP เดียว → คืนตรง ๆ", () => {
    expect(clientIpFromXff("203.0.113.7")).toBe("203.0.113.7");
  });

  it("หลาย hop → เอาขวาสุด (ค่าที่ infra ใกล้สุดเติม) ไม่ใช่ซ้ายสุดที่ client ปลอม", () => {
    // client ยัด 6.6.6.6 ไว้ซ้าย เพื่อปลอม; hop จริงขวาสุด = 9.9.9.9
    expect(clientIpFromXff("6.6.6.6, 10.0.0.1, 9.9.9.9")).toBe("9.9.9.9");
  });

  it("เว้นวรรค/ค่าว่างระหว่าง comma → ข้าม", () => {
    expect(clientIpFromXff(" , 8.8.8.8 ")).toBe("8.8.8.8");
  });
});
