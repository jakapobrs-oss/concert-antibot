// Unit tests — validation และด่านกันเจนทับของ action จัดแถวโซน
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertVerifiedAdmin: vi.fn(),
  zoneFindUnique: vi.fn(),
  seatFindMany: vi.fn(),
  transaction: vi.fn(),
  seatDeleteMany: vi.fn(),
  seatCreateMany: vi.fn(),
  zoneUpdate: vi.fn(),
  getHeldSeats: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin-guard", () => ({
  assertVerifiedAdmin: mocks.assertVerifiedAdmin,
}));
vi.mock("@/lib/seat-hold", () => ({ getHeldSeats: mocks.getHeldSeats }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    zone: { findUnique: mocks.zoneFindUnique },
    seat: { findMany: mocks.seatFindMany },
    $transaction: mocks.transaction,
  },
}));

import { saveZoneRowSpec } from "@/app/actions/seatmap";

const seatedZone = {
  id: 10n,
  concertId: 1n,
  name: "VIP",
  totalSeats: 42,
  isStanding: false,
};

describe("saveZoneRowSpec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertVerifiedAdmin.mockResolvedValue({ user: { id: "admin" } });
    mocks.zoneFindUnique.mockResolvedValue(seatedZone);
    mocks.seatFindMany.mockResolvedValue([]);
    mocks.getHeldSeats.mockResolvedValue(new Set<string>());
    mocks.zoneUpdate.mockResolvedValue({ id: seatedZone.id });
    mocks.seatDeleteMany.mockResolvedValue({ count: 42 });
    mocks.seatCreateMany.mockResolvedValue({ count: 42 });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        seat: {
          deleteMany: mocks.seatDeleteMany,
          createMany: mocks.seatCreateMany,
        },
        zone: { update: mocks.zoneUpdate },
      }),
    );
  });

  it("ปฏิเสธ rowSpec ที่ไม่ใช่ JSON array โดยไม่แตะที่นั่ง", async () => {
    const result = await saveZoneRowSpec({ concertId: "1", zoneId: "10", rowSpec: "12,14,16" });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("ที่นั่งต่อแถวไม่ถูกต้อง");
    expect(mocks.seatFindMany).not.toHaveBeenCalled();
  });

  it("ปฏิเสธเมื่อผลรวมไม่เท่ากับจำนวนบัตรเดิมของโซน", async () => {
    const result = await saveZoneRowSpec({
      concertId: "1",
      zoneId: "10",
      rowSpec: "[12,12,16]",
    });

    expect(result).toEqual({
      ok: false,
      error: "ที่นั่งต่อแถวรวม 40 ไม่เท่ากับจำนวนที่นั่ง 42",
    });
    expect(mocks.seatFindMany).not.toHaveBeenCalled();
  });

  it("ปฏิเสธโซนยืนก่อนเจนที่นั่ง", async () => {
    mocks.zoneFindUnique.mockResolvedValue({ ...seatedZone, isStanding: true });

    const result = await saveZoneRowSpec({
      concertId: "1",
      zoneId: "10",
      rowSpec: "[12,14,16]",
    });

    expect(result).toEqual({ ok: false, error: "โซนยืนจัดแถวไม่ได้" });
    expect(mocks.seatFindMany).not.toHaveBeenCalled();
  });

  it("ผ่านด่านแล้วลบและเจนใหม่ตาม spec ใน transaction เดียว", async () => {
    const result = await saveZoneRowSpec({
      concertId: "1",
      zoneId: "10",
      rowSpec: "[12,14,16]",
    });

    expect(result).toMatchObject({ ok: true });
    expect(mocks.seatDeleteMany).toHaveBeenCalledWith({ where: { zoneId: 10n } });
    const created = mocks.seatCreateMany.mock.calls[0]?.[0].data;
    expect(created).toHaveLength(42);
    expect(created[0]).toEqual({ zoneId: 10n, rowLabel: "A", seatNumber: 1 });
    expect(created.at(-1)).toEqual({ zoneId: 10n, rowLabel: "C", seatNumber: 16 });
    expect(mocks.zoneUpdate).toHaveBeenCalledWith({
      where: { id: 10n },
      data: { rowSpec: "[12,14,16]" },
    });
  });

  it("นับ Redis hold ผ่าน canRegenerateZoneSeats และไม่เปิด transaction เมื่อถูกกั้น", async () => {
    mocks.seatFindMany.mockResolvedValue([
      { id: 99n, status: "AVAILABLE", orderItem: null, tickets: [] },
    ]);
    mocks.getHeldSeats.mockResolvedValue(new Set(["99"]));

    const result = await saveZoneRowSpec({
      concertId: "1",
      zoneId: "10",
      rowSpec: "[12,14,16]",
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("กำลังถูกจองค้าง 1 ที่");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
