// Unit tests — F7: ตรวจว่ารูปสลิป "หน้าตาเป็นรูป base64" จริง
import { describe, it, expect } from "vitest";
import { isLikelyBase64Image, MAX_SLIP_BASE64_LEN } from "@/lib/slip-image";

// รูป png 1x1 (base64 ล้วน) ใช้เป็น fixture
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("isLikelyBase64Image — F7: รับเฉพาะรูป base64", () => {
  it("ผ่าน: data URL ของ png", () => {
    expect(isLikelyBase64Image(`data:image/png;base64,${PNG_1x1}`)).toBe(true);
  });

  it("ผ่าน: data URL ของ jpeg / webp", () => {
    expect(isLikelyBase64Image(`data:image/jpeg;base64,${PNG_1x1}`)).toBe(true);
    expect(isLikelyBase64Image(`data:image/webp;base64,${PNG_1x1}`)).toBe(true);
  });

  it("ผ่าน: base64 ล้วน (ไม่มี data: นำหน้า)", () => {
    expect(isLikelyBase64Image(PNG_1x1)).toBe(true);
  });

  it("ผ่าน: base64 ที่มี newline คั่น (encoder บางตัวใส่มา)", () => {
    expect(isLikelyBase64Image("iVBORw0KGgoA\nAAANSUhEUg==")).toBe(true);
  });

  it("❌ ปฏิเสธ: data URL ที่ไม่ใช่รูป (data:text/html)", () => {
    expect(isLikelyBase64Image("data:text/html;base64,PGgxPg==")).toBe(false);
  });

  it("❌ ปฏิเสธ: ข้อความทั่วไป/มีอักขระนอก base64", () => {
    expect(isLikelyBase64Image("hello world!")).toBe(false);
    expect(isLikelyBase64Image("<script>alert(1)</script>")).toBe(false);
  });

  it("❌ ปฏิเสธ: ค่าว่าง", () => {
    expect(isLikelyBase64Image("")).toBe(false);
    expect(isLikelyBase64Image("   ")).toBe(false);
  });

  it("เพดานขนาด base64 ตั้งไว้ราว 2MB (~2.8M chars)", () => {
    expect(MAX_SLIP_BASE64_LEN).toBe(2_800_000);
  });
});
