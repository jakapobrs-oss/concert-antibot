import { describe, expect, it } from "vitest";

import {
  pickBestSeats,
  type BestAvailableSeat,
} from "@/lib/seatmap/best-available";

function seat(
  id: string,
  rowLabel: string,
  seatNumber: number,
): BestAvailableSeat {
  return { id, rowLabel, seatNumber };
}

describe("pickBestSeats", () => {
  it("เลือก run ติดกันกลางแถวเมื่อด้านซ้ายมีช่องว่าง", () => {
    const seats = [seat("A1", "A", 1), seat("A3", "A", 3), seat("A4", "A", 4)];

    expect(pickBestSeats(seats, 2)).toEqual(["A3", "A4"]);
  });

  it("เลือก run ในแถวหลังเมื่อแถวหน้าขายเต็มจนไม่มีผู้สมัคร", () => {
    const seats = [seat("B1", "B", 1), seat("B2", "B", 2), seat("C1", "C", 1)];

    expect(pickBestSeats(seats, 2)).toEqual(["B1", "B2"]);
  });

  it("กระจายจากซ้ายไปขวาข้ามแถวเมื่อไม่มี run ที่ยาวพอเลย", () => {
    const seats = [
      seat("A1", "A", 1),
      seat("A3", "A", 3),
      seat("B2", "B", 2),
      seat("B4", "B", 4),
    ];

    expect(pickBestSeats(seats, 3)).toEqual(["A1", "A3", "B2"]);
  });

  it("คืนรายการว่างเมื่อจำนวนที่นั่งรวมไม่พอ", () => {
    expect(pickBestSeats([seat("A1", "A", 1)], 2)).toEqual([]);
  });

  it("quantity=1 เลือกที่นั่งซ้ายสุดของแถวหน้าสุด", () => {
    expect(pickBestSeats([seat("B1", "B", 1), seat("A2", "A", 2)], 1)).toEqual([
      "A2",
    ]);
  });

  it("ให้ผลคงที่และไม่แก้ลำดับ input แม้ผู้สมัครมาไม่เรียง", () => {
    const seats = [
      seat("AA1", "AA", 1),
      seat("B2", "B", 2),
      seat("B1", "B", 1),
    ];
    const original = [...seats];

    expect(pickBestSeats(seats, 2)).toEqual(["B1", "B2"]);
    expect(pickBestSeats(seats, 2)).toEqual(["B1", "B2"]);
    expect(seats).toEqual(original);
  });
});
