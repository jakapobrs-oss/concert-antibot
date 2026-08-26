// Unit tests — Payer Key + per-payer limit (lib/payer-key.ts)
// พิสูจน์ตรรกะ "จำกัดตั๋วต่อบัญชีผู้จ่าย" (กัน account farming) ที่เป็นหัวใจมาตรการนี้
import { describe, it, expect } from "vitest";
import { computePayerKey, exceedsPayerLimit } from "@/lib/payer-key";

describe("computePayerKey — สร้างคีย์ผู้จ่ายจากสลิป", () => {
  it("มีเลขบัญชี (masked) → ใช้เลขที่เห็นเป็นคีย์ acct:", () => {
    expect(computePayerKey({ senderAccount: "xxx-x-x1234-5" })).toBe("acct:12345");
    expect(computePayerKey({ senderAccount: "012-3-45678-9" })).toBe("acct:0123456789");
  });

  it("เลขบัญชีชนะชื่อเมื่อมีทั้งคู่ (เลขเสถียรกว่า)", () => {
    expect(computePayerKey({ senderAccount: "0xx-xxx-5678", senderName: "นายทดสอบ" })).toBe("acct:05678");
  });

  it("เลขน้อยกว่า 4 หลัก → ตกไปใช้ชื่อแทน", () => {
    expect(computePayerKey({ senderAccount: "xx-x", senderName: "John Doe" })).toBe("name:john doe");
  });

  it("มีแต่ชื่อ → name: (lower-case + ยุบช่องว่าง)", () => {
    expect(computePayerKey({ senderName: "  JOHN   DOE  " })).toBe("name:john doe");
    expect(computePayerKey({ senderName: "นาย ทดสอบ ใจดี" })).toBe("name:นาย ทดสอบ ใจดี");
  });

  it("ไม่มีทั้งเลขและชื่อ → null (บังคับ cap ไม่ได้ → ไม่ block ผิดคน)", () => {
    expect(computePayerKey({})).toBeNull();
    expect(computePayerKey({ senderAccount: "", senderName: "" })).toBeNull();
    expect(computePayerKey({ senderAccount: "xxx-xxx", senderName: "   " })).toBeNull();
  });
});

describe("computePayerKey — fallback ชื่อ + ธนาคารต้นทาง (SECURITY_TODO #3)", () => {
  it("ไม่มีเลขบัญชี แต่มีธนาคาร → name:<ธนาคาร>:<ชื่อ> (normalize ทั้งคู่)", () => {
    expect(computePayerKey({ senderName: "John Doe", senderBank: "004" })).toBe("name:004:john doe");
    expect(computePayerKey({ senderName: "  JOHN  DOE ", senderBank: " KBANK " })).toBe("name:kbank:john doe");
  });

  it("ชื่อเดียวกัน คนละธนาคาร → คนละคีย์ (ไม่ชนกันเหมือนเดิม)", () => {
    const kbank = computePayerKey({ senderName: "สมชาย ใจดี", senderBank: "004" });
    const scb = computePayerKey({ senderName: "สมชาย ใจดี", senderBank: "014" });
    expect(kbank).not.toBe(scb);
  });

  it("มีเลขบัญชี → ใช้ acct: ไม่สนธนาคาร (เลขบัญชีเสถียรกว่า)", () => {
    expect(computePayerKey({ senderAccount: "xxx-x-x1234-5", senderName: "John", senderBank: "004" })).toBe(
      "acct:12345"
    );
  });

  it("ไม่มีธนาคาร (สลิปไม่บอก) → รูปแบบเดิม name:<ชื่อ> (ยังบังคับ cap ไม่ปล่อยหลุด)", () => {
    expect(computePayerKey({ senderName: "John Doe", senderBank: "" })).toBe("name:john doe");
    expect(computePayerKey({ senderName: "John Doe", senderBank: "   " })).toBe("name:john doe");
    expect(computePayerKey({ senderName: "John Doe", senderBank: null })).toBe("name:john doe");
  });

  it("มีธนาคารแต่ไม่มีชื่อ → null (ธนาคารอย่างเดียวระบุคนไม่ได้)", () => {
    expect(computePayerKey({ senderBank: "004" })).toBeNull();
  });
});

describe("exceedsPayerLimit — ตัดสินว่าเกินเพดานต่อผู้จ่ายมั้ย", () => {
  it("ยังไม่เกิน (รวมแล้วเท่าลิมิตพอดี) → false", () => {
    expect(exceedsPayerLimit({ priorPaid: 8, requested: 2, limit: 10 })).toBe(false);
    expect(exceedsPayerLimit({ priorPaid: 0, requested: 4, limit: 10 })).toBe(false);
  });

  it("เกินลิมิต → true (กันซื้อเกินเพดานต่อบัญชีผู้จ่าย)", () => {
    expect(exceedsPayerLimit({ priorPaid: 9, requested: 2, limit: 10 })).toBe(true);
    expect(exceedsPayerLimit({ priorPaid: 10, requested: 1, limit: 10 })).toBe(true);
  });
});
