// Unit tests — บัตรหมด (SOLD OUT) ตามพฤติกรรมผังคอนไทย (Phase 2.3, docs/23)
// โจทย์จริง: บัตรหมดตั้งแต่รอบสมาชิก → ผู้จัดประกาศ sold out → รอบทั่วไปไม่เปิดขาย
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    seat: { count: vi.fn() },
    concert: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { isSoldOut, isTemporarilyFull, getConcertAvailability, syncSoldOutStatus } from "@/lib/sold-out";
import { resolveRoundEntry, describeRounds, type RoundLike, type UserRoundContext } from "@/lib/sale-round";

const now = new Date("2026-08-20T19:15:00+07:00");
const T = (hhmm: string) => new Date(`2026-08-20T${hhmm}:00+07:00`);

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// 1. นิยาม "บัตรหมด"
// ============================================================
describe("isSoldOut — ต้องไม่เหลือทั้งที่นั่งว่างและที่นั่งที่ค้างจ่าย", () => {
  it("ไม่เหลืออะไรเลย → บัตรหมด", () => {
    expect(isSoldOut({ available: 0, held: 0 })).toBe(true);
  });

  it("🔑 ว่าง 0 แต่ยังมีคนค้างจ่ายอยู่ → ยังไม่ประกาศหมด (hold อาจหลุดกลับมาใน 5 นาที)", () => {
    expect(isSoldOut({ available: 0, held: 3 })).toBe(false);
    expect(isTemporarilyFull({ available: 0, held: 3 })).toBe(true);
  });

  it("ยังมีที่นั่งว่าง → ไม่หมด", () => {
    expect(isSoldOut({ available: 5, held: 2 })).toBe(false);
    expect(isTemporarilyFull({ available: 5, held: 2 })).toBe(false);
  });
});

describe("getConcertAvailability — นับจาก DB", () => {
  it("รวมทั้งที่นั่งว่างและที่ค้างจ่าย", async () => {
    db.seat.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    expect(await getConcertAvailability("1")).toEqual({ available: 4, held: 2, soldOut: false });
  });

  it("ไม่เหลือเลย → soldOut = true", async () => {
    db.seat.count.mockResolvedValue(0);
    expect(await getConcertAvailability(1n)).toEqual({ available: 0, held: 0, soldOut: true });
  });
});

describe("syncSoldOutStatus — ประกาศอัตโนมัติตอนออกตั๋วใบสุดท้าย", () => {
  it("ยังมีที่นั่ง → ไม่แตะสถานะคอนเสิร์ต", async () => {
    db.seat.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    expect(await syncSoldOutStatus("1")).toBe("UNCHANGED");
    expect(db.concert.updateMany).not.toHaveBeenCalled();
  });

  it("หมดแล้ว → พลิกเป็น SOLD_OUT เฉพาะคอนเสิร์ตที่ยัง ON_SALE", async () => {
    db.seat.count.mockResolvedValue(0);
    db.concert.updateMany.mockResolvedValue({ count: 1 });

    expect(await syncSoldOutStatus("1")).toBe("MARKED_SOLD_OUT");
    expect(db.concert.updateMany).toHaveBeenCalledWith({
      where: { id: 1n, status: "ON_SALE" },
      data: { status: "SOLD_OUT" },
    });
  });

  it("🔑 คอนเสิร์ตไม่ได้อยู่สถานะ ON_SALE (แอดมินตั้งเอง) → ไม่ทับสถานะ", async () => {
    db.seat.count.mockResolvedValue(0);
    db.concert.updateMany.mockResolvedValue({ count: 0 });

    expect(await syncSoldOutStatus("1")).toBe("UNCHANGED");
  });
});

// ============================================================
// 2. ผลกับรอบขาย — "หมดตั้งแต่รอบสมาชิก รอบทั่วไปไม่เปิด"
// ============================================================
function round(over: Partial<RoundLike> & { id: string; audience: RoundLike["audience"] }): RoundLike {
  return {
    name: `รอบ ${over.id}`,
    startAt: T("19:00"),
    endAt: T("19:30"),
    requiresPreRegistration: false,
    preRegisterStartAt: null,
    preRegisterEndAt: null,
    maxTicketsPerUser: null,
    seatQuota: null,
    ...over,
  };
}

const guest: UserRoundContext = { membership: null, preRegisteredRoundIds: [], unlockedRoundIds: [] };
const member: UserRoundContext = { ...guest, membership: { tier: "STANDARD" } };

// สถานการณ์จริง: รอบสมาชิกเปิดอยู่ตอนนี้ · รอบทั่วไปเริ่มอีก 3 วัน
const rounds = [
  round({ id: "member", audience: "MEMBER_ONLY", startAt: T("19:00"), endAt: T("23:00") }),
  round({
    id: "public",
    audience: "PUBLIC",
    startAt: new Date(T("19:00").getTime() + 3 * 24 * 3600_000),
    endAt: new Date(T("19:00").getTime() + 10 * 24 * 3600_000),
  }),
];

describe("resolveRoundEntry — บัตรหมดชนะทุกเงื่อนไข", () => {
  it("ยังไม่หมด → สมาชิกเข้ารอบสมาชิกได้ตามปกติ", () => {
    const res = resolveRoundEntry(rounds, member, now, { soldOut: false });
    expect(res.ok).toBe(true);
  });

  it("❌ บัตรหมดแล้ว → แม้เป็นสมาชิกและรอบเปิดอยู่ ก็เข้าไม่ได้", () => {
    const res = resolveRoundEntry(rounds, member, now, { soldOut: true });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("SOLD_OUT");
      expect(res.message).toBe("บัตรหมดแล้ว");
      // ไม่ควรบอกว่า "รอรอบหน้า" เพราะรอบหน้าจะไม่เปิดขายแล้ว
      expect(res.nextRound).toBeNull();
    }
  });

  it("❌ คนทั่วไปที่รอรอบทั่วไปอยู่ → ได้ข้อความบัตรหมด ไม่ใช่ 'อีก 3 วันค่อยมา'", () => {
    const res = resolveRoundEntry(rounds, guest, now, { soldOut: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("SOLD_OUT");
  });
});

describe("describeRounds — รอบที่ยังไม่ถึงเวลาต้องไม่โชว์ว่า 'ยังไม่เริ่ม' ตอนบัตรหมด", () => {
  it("บัตรหมด → รอบทั่วไปกลายเป็น SOLD_OUT (ไม่ใช่ UPCOMING)", () => {
    const got = describeRounds(rounds, member, now, { soldOut: true });
    expect(got.map((g) => g.state)).toEqual(["SOLD_OUT", "SOLD_OUT"]);
  });

  it("ยังไม่หมด → สถานะปกติ (เปิดอยู่ / ยังไม่เริ่ม)", () => {
    const got = describeRounds(rounds, member, now, { soldOut: false });
    expect(got.map((g) => g.state)).toEqual(["OPEN_ELIGIBLE", "UPCOMING"]);
  });

  it("บัตรหมด → ปุ่มลงทะเบียนล่วงหน้าต้องหายไปด้วย", () => {
    const withPreReg = [
      round({
        id: "fan",
        audience: "FANCLUB",
        startAt: new Date(now.getTime() + 3600_000),
        endAt: new Date(now.getTime() + 7200_000),
        requiresPreRegistration: true,
      }),
    ];
    const premium: UserRoundContext = { ...guest, membership: { tier: "PREMIUM" } };
    expect(describeRounds(withPreReg, premium, now, { soldOut: false })[0].canPreRegisterNow).toBe(true);
    expect(describeRounds(withPreReg, premium, now, { soldOut: true })[0].canPreRegisterNow).toBe(false);
  });
});
