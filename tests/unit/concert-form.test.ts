// Unit tests — lib/concert-form.ts (ฟอร์มสร้าง/แก้ไขคอนเสิร์ตของแอดมิน, rev 41) + toThaiDateTimeLocal
import { describe, it, expect } from "vitest";
import {
  parseConcertForm,
  canDeleteConcert,
  changesAffectingBuyers,
  normalizeSlug,
  CONCERT_STATUSES,
} from "@/lib/concert-form";
import { parseThaiDateTimeLocal, toThaiDateTimeLocal } from "@/lib/local-datetime";

// ฟอร์มที่ถูกต้องครบ (เวลาไทย) — ใช้เป็นฐานแล้ว override ทีละฟิลด์
function validForm(overrides: Record<string, string> = {}) {
  return {
    title: "BTS World Tour Bangkok 2026",
    description: "รายละเอียด",
    venue: "ราชมังคลากีฬาสถาน",
    eventAt: "2026-12-20T19:00",
    saleStartAt: "2026-11-01T10:00",
    saleEndAt: "2026-12-20T18:00",
    maxTicketsPerUser: "4",
    coverImageUrl: "",
    ...overrides,
  };
}

describe("parseConcertForm — ฟอร์มถูกต้อง", () => {
  it("แปลง datetime-local เป็นเวลาไทย (UTC+7) และคืนข้อมูลพร้อมเขียน DB", () => {
    const r = parseConcertForm(validForm());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.title).toBe("BTS World Tour Bangkok 2026");
    expect(r.data.eventAt.toISOString()).toBe("2026-12-20T12:00:00.000Z"); // 19:00 ไทย
    expect(r.data.saleStartAt.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(r.data.maxTicketsPerUser).toBe(4);
    expect(r.data.coverImageUrl).toBeNull();
    expect(r.data.slug).toBeUndefined();
    expect(r.data.status).toBeUndefined();
  });

  it("ตัดช่องว่างหัวท้าย · โปสเตอร์ http(s) รับได้ · ว่าง = null", () => {
    const r = parseConcertForm(validForm({ title: "  Ed Sheeran  ", coverImageUrl: " https://img.example/p.jpg " }));
    expect(r.ok && r.data.title).toBe("Ed Sheeran");
    expect(r.ok && r.data.coverImageUrl).toBe("https://img.example/p.jpg");
  });
});

describe("parseConcertForm — กติกา", () => {
  it("ฟิลด์บังคับว่าง → error ระบุฟิลด์", () => {
    for (const key of ["title", "description", "venue"]) {
      const r = parseConcertForm(validForm({ [key]: "   " }));
      expect(r.ok).toBe(false);
      expect(!r.ok && r.field).toBe(key);
    }
  });

  it("วันเวลาไม่ถูกต้อง → error ฟิลด์นั้น", () => {
    const r = parseConcertForm(validForm({ eventAt: "20/12/2026" }));
    expect(!r.ok && r.field).toBe("eventAt");
    const r2 = parseConcertForm(validForm({ saleStartAt: "" }));
    expect(!r2.ok && r2.field).toBe("saleStartAt");
  });

  it("ปิดขายต้องอยู่หลังเริ่มขาย และไม่เกินเวลาแสดง (ขายหลังงานเริ่มไม่ได้ — เคสคอนพี่เจี๊ยบ)", () => {
    const beforeStart = parseConcertForm(validForm({ saleEndAt: "2026-11-01T09:00" }));
    expect(!beforeStart.ok && beforeStart.error).toContain("หลังเวลาเริ่มขาย");
    const afterEvent = parseConcertForm(validForm({ saleEndAt: "2026-12-21T10:00" }));
    expect(!afterEvent.ok && afterEvent.error).toContain("ไม่เกินเวลาแสดง");
    // ปิดขายเท่ากับเวลาแสดงพอดี → ได้
    const equal = parseConcertForm(validForm({ saleEndAt: "2026-12-20T19:00" }));
    expect(equal.ok).toBe(true);
  });

  it("จำกัดตั๋วต้องเป็นจำนวนเต็ม 1–20", () => {
    for (const bad of ["0", "21", "2.5", "abc", ""]) {
      const r = parseConcertForm(validForm({ maxTicketsPerUser: bad }));
      expect(!r.ok && r.field).toBe("maxTicketsPerUser");
    }
    expect(parseConcertForm(validForm({ maxTicketsPerUser: "20" })).ok).toBe(true);
  });

  it("โปสเตอร์ต้องเป็นลิงก์ http(s)", () => {
    const r = parseConcertForm(validForm({ coverImageUrl: "poster.jpg" }));
    expect(!r.ok && r.field).toBe("coverImageUrl");
    const r2 = parseConcertForm(validForm({ coverImageUrl: "javascript:alert(1)" }));
    expect(r2.ok).toBe(false);
  });

  it("slug (ฟอร์มแก้ไข): ว่าง = ไม่เปลี่ยน · lowercase ให้ · รูปแบบผิด/ไทย → error · ถ้าไม่เปิด withSlug จะไม่อ่าน", () => {
    const keep = parseConcertForm(validForm({ slug: "  " }), { withSlug: true });
    expect(keep.ok && keep.data.slug).toBeUndefined();
    const upper = parseConcertForm(validForm({ slug: "BTS-Bangkok-2026" }), { withSlug: true });
    expect(upper.ok && upper.data.slug).toBe("bts-bangkok-2026");
    for (const bad of ["คอนพี่เจี๊ยบ", "-lead", "trail-", "a--b", "has space", "x".repeat(101)]) {
      const r = parseConcertForm(validForm({ slug: bad }), { withSlug: true });
      expect(!r.ok && r.field).toBe("slug");
    }
    const ignored = parseConcertForm(validForm({ slug: "!!!" }));
    expect(ignored.ok).toBe(true);
    expect(normalizeSlug("  ABC ")).toBe("abc");
  });

  it("status (ฟอร์มแก้ไข): ต้องเป็นค่าในลิสต์", () => {
    for (const s of CONCERT_STATUSES) {
      const r = parseConcertForm(validForm({ status: s }), { withStatus: true });
      expect(r.ok && r.data.status).toBe(s);
    }
    const bad = parseConcertForm(validForm({ status: "CANCELLED" }), { withStatus: true });
    expect(!bad.ok && bad.field).toBe("status");
    const missing = parseConcertForm(validForm(), { withStatus: true });
    expect(missing.ok).toBe(false);
  });
});

describe("canDeleteConcert / changesAffectingBuyers", () => {
  it("มีคำสั่งซื้อ → ลบไม่ได้ พร้อมเหตุผล · ไม่มี → ลบได้", () => {
    const blocked = canDeleteConcert({ orderCount: 3 });
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.reason).toContain("3 รายการ");
    expect(canDeleteConcert({ orderCount: 0 }).ok).toBe(true);
  });

  it("บอกว่าเปลี่ยนวันแสดง/สถานที่หรือไม่ (ไว้เตือนแอดมินแจ้งผู้ซื้อ)", () => {
    const d = new Date("2026-12-20T12:00:00Z");
    expect(changesAffectingBuyers({ eventAt: d, venue: "A" }, { eventAt: d, venue: "A" })).toEqual([]);
    expect(
      changesAffectingBuyers({ eventAt: d, venue: "A" }, { eventAt: new Date("2026-12-21T12:00:00Z"), venue: "B" })
    ).toEqual(["วันเวลาแสดง", "สถานที่"]);
  });
});

describe("toThaiDateTimeLocal", () => {
  it("คู่กลับของ parseThaiDateTimeLocal — ไม่ขึ้นกับ TZ ของเครื่อง", () => {
    const parsed = parseThaiDateTimeLocal("2026-12-20T19:05");
    expect(parsed).not.toBeNull();
    expect(toThaiDateTimeLocal(parsed!)).toBe("2026-12-20T19:05");
    // 2026-08-27T03:00Z = 10:00 ไทย (คอนพี่เจี๊ยบ)
    expect(toThaiDateTimeLocal(new Date("2026-08-27T03:00:00Z"))).toBe("2026-08-27T10:00");
    // ข้ามวันเมื่อบวก 7 ชม.
    expect(toThaiDateTimeLocal(new Date("2026-08-27T20:30:00Z"))).toBe("2026-08-28T03:30");
  });
});
