// Unit tests — ขอบเขตการเช็คอิน (rev 42 audit High): ตั๋วต้องเป็นของคอนที่จุดสแกนเลือก + อยู่ในกรอบเวลา
import { describe, it, expect } from "vitest";
import { decideCheckInScope, isConcertSelectableAtGate } from "@/lib/checkin-policy";

const H = 60 * 60 * 1000;
const eventAt = new Date("2026-12-20T12:00:00Z"); // 19:00 ไทย
const base = {
  ticketConcertId: "47",
  ticketConcertTitle: "ราชมังฯ ทดสอบ",
  gateConcertId: "47",
  gateConcertTitle: "ราชมังฯ ทดสอบ",
  eventAt,
  openBeforeMs: 12 * H,
  closeAfterMs: 6 * H,
};

describe("decideCheckInScope", () => {
  it("คอนตรง + อยู่ในกรอบเวลา → ผ่าน", () => {
    expect(decideCheckInScope({ ...base, now: new Date(eventAt.getTime() - 2 * H) })).toEqual({ ok: true });
    expect(decideCheckInScope({ ...base, now: new Date(eventAt.getTime() + 1 * H) })).toEqual({ ok: true });
  });

  it("ตั๋วคอนอื่น (เช่น ตั๋ว ฿1 ของคอนทดสอบ) → wrong_concert พร้อมชื่อทั้งสองงาน", () => {
    const r = decideCheckInScope({
      ...base,
      ticketConcertId: "18",
      ticketConcertTitle: "ทดสอบระบบจ่ายเงิน (1 บาท)",
      now: new Date(eventAt.getTime() - 1 * H),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("wrong_concert");
      expect(r.error).toContain("ทดสอบระบบจ่ายเงิน (1 บาท)");
      expect(r.error).toContain("ราชมังฯ ทดสอบ");
    }
  });

  it("คอนตรงแต่ยังไม่ถึงกรอบเปิดสแกน (เร็วกว่า 12 ชม.) → too_early", () => {
    const r = decideCheckInScope({ ...base, now: new Date(eventAt.getTime() - 13 * H) });
    expect(r).toMatchObject({ ok: false, kind: "too_early" });
  });

  it("คอนตรงแต่เลยกรอบปิดสแกน (เกิน 6 ชม. หลังเริ่ม) → too_late", () => {
    const r = decideCheckInScope({ ...base, now: new Date(eventAt.getTime() + 7 * H) });
    expect(r).toMatchObject({ ok: false, kind: "too_late" });
  });

  it("ขอบพอดีนับว่าอยู่ในกรอบ", () => {
    expect(decideCheckInScope({ ...base, now: new Date(eventAt.getTime() - 12 * H) })).toEqual({ ok: true });
    expect(decideCheckInScope({ ...base, now: new Date(eventAt.getTime() + 6 * H) })).toEqual({ ok: true });
  });

  it("ผิดคอนถูกตรวจก่อนเรื่องเวลา (ข้อความต้องบอกว่าผิดงาน ไม่ใช่ผิดเวลา)", () => {
    const r = decideCheckInScope({ ...base, ticketConcertId: "18", now: new Date(eventAt.getTime() + 99 * H) });
    expect(r).toMatchObject({ ok: false, kind: "wrong_concert" });
  });
});

describe("isConcertSelectableAtGate", () => {
  it("งานที่ยังไม่เลยกรอบปิดสแกน → เลือกได้ · เลยแล้ว → ไม่โชว์", () => {
    expect(isConcertSelectableAtGate({ eventAt, now: new Date(eventAt.getTime() + 5 * H), closeAfterMs: 6 * H })).toBe(true);
    expect(isConcertSelectableAtGate({ eventAt, now: new Date(eventAt.getTime() + 7 * H), closeAfterMs: 6 * H })).toBe(false);
    expect(isConcertSelectableAtGate({ eventAt, now: new Date(eventAt.getTime() - 400 * H), closeAfterMs: 6 * H })).toBe(true);
  });
});
