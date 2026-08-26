// Unit tests — lib/money.ts: เทียบยอดเงินเป็นสตางค์จำนวนเต็ม (SECURITY_TODO #4)
// จุดตายของเส้นทางเงิน: ยอดสลิป (float) กับยอด order (Decimal string) ต้อง "ตรงเป๊ะ"
//   แต่ต้องไม่ปฏิเสธยอดที่เท่ากันจริงเพราะ float drift และต้องไม่ปล่อยยอดที่ต่างกัน 1 สตางค์
import { describe, it, expect } from "vitest";
import { toSatang, sameAmount } from "@/lib/money";

describe("toSatang — บาท → สตางค์จำนวนเต็ม", () => {
  it("number / string จาก Decimal.toString() → สตางค์เดียวกัน", () => {
    expect(toSatang(1500)).toBe(150000);
    expect(toSatang("1500.00")).toBe(150000);
    expect(toSatang("1500.5")).toBe(150050);
  });

  it("ค่าที่ float แทนไม่ตรง (19.99*100 = 1998.9999999999998) → ปัดถูก", () => {
    expect(toSatang(19.99)).toBe(1999);
    expect(toSatang(0.1 + 0.2)).toBe(30);
    expect(toSatang(1500.0000000001)).toBe(150000);
  });

  it("อ่านเป็นตัวเลขไม่ได้ / Infinity → NaN (ไม่ใช่ 0 — ห้ามให้สลิปพัง ๆ เทียบเท่ายอด 0)", () => {
    expect(toSatang("abc")).toBeNaN();
    expect(toSatang("")).toBeNaN(); // Number("") = 0 — ห้ามหลุดเป็น 0 บาท
    expect(toSatang("1,500")).toBeNaN();
    expect(toSatang("1e3")).toBeNaN();
    expect(toSatang("0x10")).toBeNaN(); // Number("0x10") = 16
    expect(toSatang(Infinity)).toBeNaN();
    expect(toSatang(NaN)).toBeNaN();
  });
});

describe("sameAmount — ยอดสองฝั่งเท่ากันที่ระดับสตางค์", () => {
  it("ยอดเดียวกันต่างแค่ float drift / รูปแบบ → เท่ากัน", () => {
    expect(sameAmount(1500.0000000001, "1500.00")).toBe(true);
    expect(sameAmount("1500", 1500)).toBe(true);
    expect(sameAmount(1999.99, "1999.99")).toBe(true);
  });

  it("ต่างกัน 1 สตางค์ → ไม่เท่า (tolerance 0 ตามนโยบาย)", () => {
    expect(sameAmount(1500.01, "1500.00")).toBe(false);
    expect(sameAmount(1499.99, 1500)).toBe(false);
  });

  it("ฝั่งใดขาด/อ่านไม่ได้ → ไม่เท่า (fail-closed — ห้ามเดาว่าตรง)", () => {
    expect(sameAmount(undefined, "1500")).toBe(false);
    expect(sameAmount(null, 1500)).toBe(false);
    expect(sameAmount(NaN, NaN)).toBe(false);
    expect(sameAmount("abc", "abc")).toBe(false);
  });
});
