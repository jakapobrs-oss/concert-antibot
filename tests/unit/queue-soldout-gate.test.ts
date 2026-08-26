// Unit tests — ประตูเข้าคิวต้องปิดเมื่อบัตรหมด "ทุกคอนเสิร์ต" รวมที่ไม่มีรอบขาย
// ที่มา: บั๊กคิวค้างตำแหน่ง 1 — resolveEntryForUser เดิม return ok ทันทีเมื่อไม่มีรอบ (ก่อนเช็คบัตรหมด)
//   → คอนเสิร์ตที่มี 0 ที่นั่ง / ขายหมดแต่ป้าย SOLD_OUT ยังไม่ถูกติด ปล่อยคนเข้าคิวแล้วไม่มีใครถูกปล่อยออก
//   ฝั่ง Redis (snapshot + สถานะ SOLD_OUT ระหว่างรอ) พิสูจน์ใน scripts/test-queue-soldout.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    seat: { count: vi.fn() },
    saleRound: { findMany: vi.fn() },
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
