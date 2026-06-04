// Unit tests — การจับคู่บัญชีปลายทางในสลิป กับ PROMPTPAY_ID ของระบบ
// พิสูจน์ว่า "เช็ค receiver" ปิดช่องโหว่ "แนบสลิปที่โอนหาคนอื่นยอดเท่ากัน"
import { describe, it, expect } from "vitest";
import { digitsOnly, receiverMatchesPromptPay } from "@/lib/slip-match";

describe("digitsOnly", () => {
  it("ตัด mask/dash/space เหลือแต่ตัวเลข", () => {
    expect(digitsOnly("0xx-xxx-5678")).toBe("05678");
    expect(digitsOnly("xxx-x-x1234-5")).toBe("12345");
    expect(digitsOnly("xxxxxx7890")).toBe("7890");
  });

  it("คืนค่าว่างถ้าไม่มีตัวเลข", () => {
    expect(digitsOnly("xxx-xxx-xxxx")).toBe("");
    expect(digitsOnly("")).toBe("");
  });
});

describe("receiverMatchesPromptPay — กันโอนผิดบัญชี", () => {
  it("ผ่านเมื่อเลขท้าย 4 ตัวตรงกับ PROMPTPAY_ID ของเรา", () => {
    // เราใช้เบอร์ 0812345678 รับเงิน, สลิปโชว์ปลายทาง 0xx-xxx-5678
    expect(receiverMatchesPromptPay("0xx-xxx-5678", "0812345678")).toBe(true);
  });

  it("❌ ปฏิเสธสลิปที่โอนเข้าบัญชีคนอื่น (เลขท้ายไม่ตรง)", () => {
    // นี่คือ attack ที่ user เจอ: โอนหาคนอื่นยอดเท่ากันแล้วเอาสลิปมาแนบ
    expect(receiverMatchesPromptPay("0xx-xxx-9999", "0812345678")).toBe(false);
  });

  it("จับคู่ด้วยเลขท้าย แม้รูปแบบ dash/space ต่างกัน", () => {
    // ปลายทางโชว์ ...5678 ตรงกับเลขท้ายเบอร์เรา
    expect(receiverMatchesPromptPay("089-xxx-5678", "08-9000-5678")).toBe(true);
  });

  it("รองรับเลขบัตรประชาชน 13 หลักเป็น PromptPay ID", () => {
    expect(receiverMatchesPromptPay("xxxxx-xx-3210", "1103700123210")).toBe(true);
    expect(receiverMatchesPromptPay("xxxxx-xx-9876", "1103700123210")).toBe(false);
  });

  it("❌ ปฏิเสธเมื่อสลิปเห็นเลขปลายทางน้อยกว่า 4 หลัก (ตรวจไม่ได้ = ไม่ปลอดภัย)", () => {
    expect(receiverMatchesPromptPay("xxx-xxx-x12", "0812345612")).toBe(false);
  });

  it("❌ ปฏิเสธเมื่อไม่มีข้อมูลบัญชีปลายทางเลย", () => {
    expect(receiverMatchesPromptPay("", "0812345678")).toBe(false);
  });

  it("❌ ปฏิเสธเมื่อยังไม่ได้ตั้ง PROMPTPAY_ID", () => {
    expect(receiverMatchesPromptPay("0xx-xxx-5678", "")).toBe(false);
  });

  it("ปรับจำนวนหลักที่เทียบให้เข้มขึ้นได้ (n=6)", () => {
    expect(receiverMatchesPromptPay("xx-xx-345678", "0812345678", 6)).toBe(true);
    expect(receiverMatchesPromptPay("xx-xx-945678", "0812345678", 6)).toBe(false);
  });
});

describe("receiverMatchesPromptPay — F5: เทียบเต็มเมื่อเลขไม่ถูก mask (ยาวเท่ากัน)", () => {
  it("ผ่าน: เลขเต็มตรงกันทั้งหมด (EasySlip คืนพร็อกซีเต็ม)", () => {
    expect(receiverMatchesPromptPay("0812345678", "0812345678")).toBe(true);
  });

  it("❌ ปฏิเสธ: เลขท้าย 4 ตัวบังเอิญชน แต่บัญชีคนละเลข (ยาวเท่ากัน → เทียบเต็ม)", () => {
    // ของเดิมเทียบแค่ 4 ตัวท้าย "5678"=="5678" จะ false-positive → ผ่านทั้งที่คนละบัญชี
    // F5: ยาวเท่ากัน 10 หลัก → เทียบเต็ม → จับได้ว่าต่างกัน
    expect(receiverMatchesPromptPay("0899995678", "0812345678")).toBe(false);
  });

  it("ยังเทียบเลขท้าย 4 ตามเดิม เมื่อสลิปถูก mask (ยาวไม่เท่ากัน)", () => {
    // ฝั่งสลิปสั้นกว่า (ถูก mask) → ไม่เทียบเต็ม กัน false-negative
    expect(receiverMatchesPromptPay("xxxxxx5678", "0812345678")).toBe(true);
  });
});
