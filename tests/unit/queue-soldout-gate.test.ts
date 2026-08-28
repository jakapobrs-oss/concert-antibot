// Unit tests — ประตูเข้าคิวต้องปิดเมื่อบัตรหมด "ทุกคอนเสิร์ต" รวมที่ไม่มีรอบขาย
// ที่มา: บั๊กคิวค้างตำแหน่ง 1 — resolveEntryForUser เดิม return ok ทันทีเมื่อไม่มีรอบ (ก่อนเช็คบัตรหมด)
//   → คอนเสิร์ตที่มี 0 ที่นั่ง / ขายหมดแต่ป้าย SOLD_OUT ยังไม่ถูกติด ปล่อยคนเข้าคิวแล้วไม่มีใครถูกปล่อยออก
//   ฝั่ง Redis (snapshot + สถานะ SOLD_OUT ระหว่างรอ) พิสูจน์ใน scripts/test-queue-soldout.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    seat: { count: vi.fn() },
    saleRound: { findMany: vi.fn() },
    // เส้นทางที่มีรอบ: บริบทผู้ใช้ (สมาชิก/ลงทะเบียน/โค้ด) + ยอดโควต้าต่อรอบ
    membership: { findFirst: vi.fn() },
    preRegistration: { findMany: vi.fn() },
    accessCodeRedemption: { findMany: vi.fn() },
    orderItem: { count: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { resolveEntryForUser } from "@/lib/sale-round";

// จำลองจำนวนที่นั่งตามสถานะที่ getConcertAvailability ถาม (AVAILABLE ก่อน HELD)
function seats(available: number, held: number) {
  db.seat.count.mockImplementation(async ({ where }: { where: { status: string } }) =>
    where.status === "AVAILABLE" ? available : held
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  db.saleRound.findMany.mockResolvedValue([]); // ไม่มีรอบขาย = คอนเสิร์ตแบบเดิม
});

describe("resolveEntryForUser — คอนเสิร์ตไม่มีรอบขาย", () => {
  it("🔑 บัตรหมดจริง (ว่าง 0 + ค้างจ่าย 0) → ปฏิเสธ SOLD_OUT แม้ไม่มีรอบ (เดิมผ่านแล้วไปค้างในคิว)", async () => {
    seats(0, 0);
    const res = await resolveEntryForUser("70", "1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("SOLD_OUT");
  });

  it("เต็มชั่วคราว (ว่าง 0 แต่ค้างจ่าย 3) → ยังเข้าคิวได้ (hold อาจหลุดกลับมา)", async () => {
    seats(0, 3);
    const res = await resolveEntryForUser("70", "1");
    expect(res.ok).toBe(true);
  });

  it("ยังมีที่นั่ง → ผ่านแบบไม่มีรอบ (พฤติกรรมเดิม round = null)", async () => {
    seats(10, 0);
    const res = await resolveEntryForUser("70", "1");
    expect(res).toEqual({ ok: true, round: null });
  });

  it("ไม่มีรอบ = ไม่โหลด context สมาชิก/ลงทะเบียน (แตะ DB แค่รอบ + นับที่นั่ง 2 ครั้ง)", async () => {
    seats(10, 0);
    await resolveEntryForUser("70", "1");
    expect(db.saleRound.findMany).toHaveBeenCalledTimes(1);
    expect(db.seat.count).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// คอนเสิร์ตที่มีรอบสมาชิกตั้งโควต้า — โควต้าหมดต้องปิดประตูตั้งแต่ตอนขอเข้าคิว
//   (เดิมสมาชิกเข้าคิว → ถูกปล่อย → เลือกที่นั่ง → เพิ่งมาตกที่ "โควต้าเต็ม" ตอนจอง)
// ============================================================
describe("resolveEntryForUser — รอบสมาชิกตั้งโควต้า", () => {
  const H = 3_600_000;
  const memberRound = {
    id: 11n,
    name: "รอบสมาชิก",
    audience: "MEMBER_ONLY",
    startAt: new Date(Date.now() - H),
    endAt: new Date(Date.now() + H),
    requiresPreRegistration: false,
    preRegisterStartAt: null,
    preRegisterEndAt: null,
    maxTicketsPerUser: 2,
    seatQuota: 10,
  };
  const publicRound = {
    ...memberRound,
    id: 12n,
    name: "รอบทั่วไป",
    audience: "PUBLIC",
    startAt: new Date(Date.now() + H),
    endAt: new Date(Date.now() + 5 * H),
    maxTicketsPerUser: null,
    seatQuota: null,
  };

  beforeEach(() => {
    seats(100, 0);
    db.saleRound.findMany.mockResolvedValue([memberRound, publicRound]);
    db.membership.findFirst.mockResolvedValue({
      id: 1n,
      userId: 1n,
      source: "SELF_SIGNUP",
      tier: "STANDARD",
      startedAt: new Date(),
      expiresAt: null,
    });
    db.preRegistration.findMany.mockResolvedValue([]);
    db.accessCodeRedemption.findMany.mockResolvedValue([]);
  });

  it("🔑 ขายครบโควต้า 10/10 → ปฏิเสธ ROUND_QUOTA_FULL + บอกว่ารอบทั่วไปเริ่มเมื่อไร", async () => {
    db.orderItem.count.mockResolvedValue(10);
    const res = await resolveEntryForUser("70", "1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("ROUND_QUOTA_FULL");
      expect(res.nextRound?.name).toBe("รอบทั่วไป");
    }
    // นับยอดเฉพาะรอบที่ตั้งโควต้า (รอบทั่วไปไม่ตั้ง → ไม่นับ)
    expect(db.orderItem.count).toHaveBeenCalledTimes(1);
  });

  it("ยังเหลือโควต้า 9/10 → เข้ารอบสมาชิกได้", async () => {
    db.orderItem.count.mockResolvedValue(9);
    const res = await resolveEntryForUser("70", "1");
    expect(res.ok && res.round?.id).toBe("11");
  });

  it("บัตรหมดทั้งงานชนะโควต้า → SOLD_OUT", async () => {
    seats(0, 0);
    db.orderItem.count.mockResolvedValue(10);
    const res = await resolveEntryForUser("70", "1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("SOLD_OUT");
  });
});
