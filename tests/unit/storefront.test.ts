// Unit tests — UX แบบเว็บกดบัตรจริง (Phase 2.4, docs/24)
//   1) สถานะคำสั่งซื้อ + กลับไปจ่ายต่อ  2) นับถอยหลังเปิดขาย  3) ค้นหา/กรองรายการงาน
import { describe, it, expect } from "vitest";
import {
  orderDisplayStatus,
  canResumePayment,
  msLeftToPay,
  type OrderLike,
} from "@/lib/order-view";
import { countdownParts, formatCountdown, tickIntervalMs } from "@/lib/countdown";
import {
  matchesQuery,
  matchesStatus,
  filterConcerts,
  countByStatus,
} from "@/lib/concert-filter";

const MIN = 60 * 1000;
const now = new Date("2026-08-20T12:00:00+07:00");
const inFuture = (ms: number) => new Date(now.getTime() + ms);

// ============================================================
// 1. สถานะคำสั่งซื้อ
// ============================================================
describe("orderDisplayStatus — ผู้ใช้ต้องแยก 'รอจ่าย' กับ 'หมดเวลา' ออกจากกัน", () => {
  const pending = (expiresAt: Date, paymentStatus?: OrderLike["paymentStatus"]): OrderLike => ({
    status: "PENDING",
    expiresAt,
    paymentStatus,
  });

  it("ยังไม่หมดเวลา → รอชำระเงิน (กลับไปจ่ายต่อได้)", () => {
    const o = pending(inFuture(3 * MIN));
    expect(orderDisplayStatus(o, now)).toBe("AWAITING_PAYMENT");
    expect(canResumePayment(o, now)).toBe(true);
  });

  it("🔑 หมดเวลาแล้วแต่ sweeper ยังไม่มาเก็บ → ต้องขึ้น 'หมดเวลา' ไม่ใช่ 'รอจ่าย'", () => {
    const o = pending(inFuture(-1 * MIN));
    expect(orderDisplayStatus(o, now)).toBe("EXPIRED");
    expect(canResumePayment(o, now)).toBe(false);
  });

  it("ขอบเขต: หมดเวลาพอดีวินาทีนั้น → ถือว่าหมดแล้ว", () => {
    expect(orderDisplayStatus(pending(now), now)).toBe("EXPIRED");
  });

  it("จ่ายแล้ว / ยกเลิกแล้ว", () => {
    expect(orderDisplayStatus({ status: "PAID", expiresAt: inFuture(-MIN) }, now)).toBe("PAID");
    expect(orderDisplayStatus({ status: "CANCELLED", expiresAt: inFuture(-MIN) }, now)).toBe(
      "CANCELLED"
    );
  });

  it("🔑 เงินเข้าแล้วแต่ออกตั๋วไม่ได้ → ขึ้น 'รอทีมงานคืนเงิน' ชนะสถานะ order", () => {
    // order ถูกยกเลิกไปแล้วแต่ payment เป็น REFUND_REQUIRED — ผู้ใช้ต้องเห็นว่ากำลังรอเงินคืน
    const o: OrderLike = {
      status: "CANCELLED",
      expiresAt: inFuture(-MIN),
      paymentStatus: "REFUND_REQUIRED",
    };
    expect(orderDisplayStatus(o, now)).toBe("REFUND_REQUIRED");
  });

  it("คืนเงินแล้ว", () => {
    expect(
      orderDisplayStatus(
        { status: "CANCELLED", expiresAt: inFuture(-MIN), paymentStatus: "REFUNDED" },
        now
      )
    ).toBe("REFUNDED");
  });
});

describe("msLeftToPay — เลขที่ป้อนตัวนับถอยหลังบนหน้าจอ", () => {
  it("เหลือ 3 นาที", () => {
    expect(msLeftToPay({ status: "PENDING", expiresAt: inFuture(3 * MIN) }, now)).toBe(3 * MIN);
  });
  it("หมดแล้ว → 0 (ไม่ติดลบ)", () => {
    expect(msLeftToPay({ status: "PENDING", expiresAt: inFuture(-MIN) }, now)).toBe(0);
  });
});

// ============================================================
// 2. นับถอยหลัง
// ============================================================
describe("countdownParts — แยกวัน/ชม./นาที/วินาที", () => {
  it("2 วัน 3 ชม. 4 นาที 5 วิ", () => {
    const target = inFuture(((2 * 24 + 3) * 60 + 4) * MIN + 5000);
    expect(countdownParts(target, now)).toMatchObject({
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
      done: false,
    });
  });

  it("เลยเวลาแล้ว → 0 ทุกช่อง + done", () => {
    const p = countdownParts(inFuture(-5 * MIN), now);
    expect(p).toMatchObject({ days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0, done: true });
  });
});

describe("formatCountdown — ข้อความที่คนอ่านรู้เรื่อง", () => {
  it("เหลือหลายวัน → บอกเป็นวัน (ไม่ใช่ 51:23:07 ที่อ่านยาก)", () => {
    expect(formatCountdown(inFuture((2 * 24 + 3) * 60 * MIN), now)).toBe("2 วัน 3 ชม.");
  });
  it("เหลือไม่ถึงวัน → ชม.:นาที:วินาที", () => {
    expect(formatCountdown(inFuture(65 * MIN + 5000), now)).toBe("1:05:05 ชม.");
  });
  it("เหลือไม่ถึงชั่วโมง → นาที:วินาที", () => {
    expect(formatCountdown(inFuture(4 * MIN + 9000), now)).toBe("4:09 นาที");
  });
  it("ถึงเวลาแล้ว", () => {
    expect(formatCountdown(inFuture(-1000), now)).toBe("ถึงเวลาแล้ว");
  });
});

describe("tickIntervalMs — ไม่ต้องเต้นทุกวินาทีถ้าเหลือเป็นวัน", () => {
  it("เหลือเกิน 1 วัน → นาทีละครั้ง", () => {
    expect(tickIntervalMs(inFuture(2 * 24 * 60 * MIN), now)).toBe(60_000);
  });
  it("ใกล้ถึงแล้ว → วินาทีละครั้ง", () => {
    expect(tickIntervalMs(inFuture(30 * MIN), now)).toBe(1000);
  });
});

// ============================================================
// 3. ค้นหา/กรองรายการงาน
// ============================================================
const list = [
  { title: "BTS World Tour Bangkok 2026", venue: "ราชมังคลากีฬาสถาน", status: "ON_SALE" },
  { title: "Ed Sheeran Live in Bangkok", venue: "อิมแพ็ค อารีน่า เมืองทองธานี", status: "SCHEDULED" },
  { title: "Blackpink Encore", venue: "ราชมังคลากีฬาสถาน", status: "SOLD_OUT" },
];

describe("matchesQuery — ค้นได้ทั้งชื่องานและสถานที่", () => {
  it("ค้นด้วยชื่อบางส่วน (ไม่สนตัวพิมพ์ใหญ่เล็ก)", () => {
    expect(matchesQuery(list[0], "bts")).toBe(true);
    expect(matchesQuery(list[0], "  BTS  ")).toBe(true);
  });

  it("🔑 ค้นด้วยสถานที่ได้ — คนจำ 'อิมแพ็ค' ได้แต่จำชื่อทัวร์เต็มไม่ได้", () => {
    expect(matchesQuery(list[1], "อิมแพ็ค")).toBe(true);
  });

  it("คำค้นว่าง → ผ่านหมด", () => {
    expect(matchesQuery(list[2], "")).toBe(true);
  });

  it("ไม่ตรง → ไม่ผ่าน", () => {
    expect(matchesQuery(list[0], "taylor")).toBe(false);
  });
});

describe("matchesStatus + filterConcerts", () => {
  it("ALL = ไม่กรอง", () => {
    expect(filterConcerts(list, { status: "ALL" })).toHaveLength(3);
  });

  it("กรองเฉพาะกำลังขาย", () => {
    const got = filterConcerts(list, { status: "ON_SALE" });
    expect(got).toHaveLength(1);
    expect(got[0].title).toContain("BTS");
  });

  it("ค้นหา + กรองสถานะพร้อมกัน", () => {
    // ราชมังคลาฯ มี 2 งาน แต่เอาเฉพาะที่บัตรหมด
    const got = filterConcerts(list, { query: "ราชมังคลา", status: "SOLD_OUT" });
    expect(got.map((c) => c.title)).toEqual(["Blackpink Encore"]);
  });

  it("ไม่เจอ → คืนอาเรย์ว่าง (หน้าจอไปแสดงข้อความ 'ไม่พบงาน')", () => {
    expect(filterConcerts(list, { query: "ไม่มีงานนี้" })).toEqual([]);
  });

  it("matchesStatus ตรงไปตรงมา", () => {
    expect(matchesStatus(list[1], "SCHEDULED")).toBe(true);
    expect(matchesStatus(list[1], "ON_SALE")).toBe(false);
  });
});

describe("countByStatus — ตัวเลขบนแท็บ", () => {
  it("นับครบทุกหมวด", () => {
    expect(countByStatus(list)).toEqual({ ALL: 3, ON_SALE: 1, SCHEDULED: 1, SOLD_OUT: 1 });
  });
});
