// Unit tests — เจนรายชื่อที่นั่งในโซน (รุ่นที่ไม่ต้องคำนวณพื้นที่กรอบแล้ว)
// พิสูจน์ว่า:
//   - ได้จำนวนเป๊ะตามที่สั่ง และไม่มีชื่อที่นั่งซ้ำกันในโซนเดียว (ชนกับ unique key ในฐานข้อมูล)
//   - แถวยาวพอดีตา ไม่ใช่แถวละ 2 ที่ หรือแถวเดียวยาว 1,000 ที่
//   - ชื่อแถวไล่ต่อจาก Z ไป AA ได้ และลำดับอ่านผังยังเรียงถูกหลังจากนั้น
import { describe, it, expect } from "vitest";
import {
  buildSeatRows,
  buildSeatRowsFromSpec,
  buildStandingSeats,
  compareSeatOrder,
  defaultSeatsPerRow,
  formatSeatLabel,
  MAX_ROWS,
  MAX_SEATS_PER_ZONE,
  parseRowSpec,
  rowLabelFor,
} from "@/lib/seatmap/seat-rows";

describe("rowLabelFor", () => {
  it("ไล่ A..Z แล้วขึ้น AA ต่อ", () => {
    expect(rowLabelFor(0)).toBe("A");
    expect(rowLabelFor(25)).toBe("Z");
    expect(rowLabelFor(26)).toBe("AA");
    expect(rowLabelFor(27)).toBe("AB");
  });

  it("ไม่มีชื่อแถวซ้ำกันเลยใน 200 แถวแรก", () => {
    const labels = Array.from({ length: 200 }, (_, i) => rowLabelFor(i));
    expect(new Set(labels).size).toBe(200);
  });
});

describe("defaultSeatsPerRow", () => {
  it("โซนขนาดกลางได้แถวกว้างกว่าลึก เหมือนบล็อกในโรงมหรสพจริง", () => {
    // 200 ที่ -> 20 ที่/แถว = 10 แถว (กว้าง 2 เท่าของความลึก)
    expect(defaultSeatsPerRow(200)).toBe(20);
  });

  it("โซนเล็กมากยังได้แถวที่ใช้งานได้ ไม่ใช่แถวละ 2 ที่", () => {
    expect(defaultSeatsPerRow(6)).toBeGreaterThanOrEqual(8);
  });

  it("โซนใหญ่มากไม่ปล่อยให้แถวยาวจนล้นจอ", () => {
    expect(defaultSeatsPerRow(5000)).toBeLessThanOrEqual(40);
  });
});

describe("buildSeatRows", () => {
  it("ได้จำนวนเป๊ะตามที่สั่ง", () => {
    for (const count of [1, 7, 100, 137, 1000]) {
      expect(buildSeatRows(count)).toHaveLength(count);
    }
  });

  it("จำนวนที่ไม่ถูกต้องได้ผลลัพธ์ว่าง ไม่ throw", () => {
    expect(buildSeatRows(0)).toEqual([]);
    expect(buildSeatRows(-5)).toEqual([]);
    expect(buildSeatRows(Number.NaN)).toEqual([]);
  });

  it("ไม่มีชื่อที่นั่งซ้ำกันในโซนเดียว (ฐานข้อมูลบังคับ unique zoneId+rowLabel+seatNumber)", () => {
    const seats = buildSeatRows(437);
    const keys = seats.map((seat) => `${seat.rowLabel}-${seat.seatNumber}`);
    expect(new Set(keys).size).toBe(seats.length);
  });

  it("เริ่มนับที่นั่งใหม่ที่ 1 ทุกแถว", () => {
    const seats = buildSeatRows(45, 20);
    expect(seats[0]).toEqual({ rowLabel: "A", seatNumber: 1 });
    expect(seats[20]).toEqual({ rowLabel: "B", seatNumber: 1 });
    expect(seats[40]).toEqual({ rowLabel: "C", seatNumber: 1 });
  });

  it("แถวสุดท้ายไม่เต็มได้ — โซนจริงก็มีแถวท้ายที่สั้นกว่าเพื่อน", () => {
    const seats = buildSeatRows(45, 20);
    const lastRow = seats.filter((seat) => seat.rowLabel === "C");
    expect(lastRow).toHaveLength(5);
  });

  it("โซนที่ลึกเกิน 26 แถวไล่ชื่อข้าม Z ไป AA ได้ และลำดับอ่านผังยังถูก", () => {
    // 27 แถว x 10 ที่ = 270 ที่ -> แถวสุดท้ายชื่อ AA
    const seats = buildSeatRows(270, 10);
    const labels = [...new Set(seats.map((seat) => seat.rowLabel))];
    expect(labels).toHaveLength(27);
    expect(labels[26]).toBe("AA");

    // สลับลำดับแล้วเรียงใหม่ ต้องได้ลำดับเดิม — กัน AA ไปแทรกระหว่าง A กับ B
    const shuffled = [...seats].reverse().sort(compareSeatOrder);
    expect(shuffled).toEqual(seats);
  });

  it("ผลลัพธ์คงที่ — สั่งจำนวนเดิมได้ผังเดิมทุกครั้ง", () => {
    expect(buildSeatRows(137)).toEqual(buildSeatRows(137));
  });
});

describe("parseRowSpec", () => {
  it("อ่าน JSON ปกติและค่าดิบแบบแถวเดียวได้", () => {
    expect(parseRowSpec("[12,14,16]")).toEqual([12, 14, 16]);
    expect(parseRowSpec([42])).toEqual([42]);
  });

  it("ปฏิเสธศูนย์ ค่าติดลบ ทศนิยม และ JSON เสียโดยไม่ throw", () => {
    expect(parseRowSpec("[12,0,16]")).toBeNull();
    expect(parseRowSpec([12, -1])).toBeNull();
    expect(parseRowSpec([12, 1.5])).toBeNull();
    expect(parseRowSpec("[12,14")).toBeNull();
  });

  it("ปฏิเสธจำนวนแถวและผลรวมที่เกินเพดาน", () => {
    expect(parseRowSpec(Array.from({ length: MAX_ROWS + 1 }, () => 1))).toBeNull();
    expect(parseRowSpec([MAX_SEATS_PER_ZONE, 1])).toBeNull();
  });
});

describe("buildSeatRowsFromSpec", () => {
  it("นับครบตามแต่ละแถวและเจน label ข้าม Z ไป AA ได้ถูกต้อง", () => {
    const spec = [...Array.from({ length: 26 }, () => 1), 3];
    const seats = buildSeatRowsFromSpec(spec);

    expect(seats).toHaveLength(29);
    expect(seats[0]).toEqual({ rowLabel: "A", seatNumber: 1 });
    expect(seats.slice(-3)).toEqual([
      { rowLabel: "AA", seatNumber: 1 },
      { rowLabel: "AA", seatNumber: 2 },
      { rowLabel: "AA", seatNumber: 3 },
    ]);
    expect(buildSeatRowsFromSpec(spec)).toEqual(seats);
  });
});

describe("buildStandingSeats", () => {
  it("เจนที่นั่งผีครบทุกใบในแถว S และเลขต่อเนื่อง 1..N", () => {
    const seats = buildStandingSeats(137);

    expect(seats).toHaveLength(137);
    expect(seats.every((seat) => seat.rowLabel === "S")).toBe(true);
    expect(seats.map((seat) => seat.seatNumber)).toEqual(
      Array.from({ length: 137 }, (_, index) => index + 1),
    );
  });

  it("ผลลัพธ์คงที่ และจำนวนไม่ถูกต้องได้รายการว่าง", () => {
    expect(buildStandingSeats(200)).toEqual(buildStandingSeats(200));
    expect(buildStandingSeats(0)).toEqual([]);
    expect(buildStandingSeats(Number.NaN)).toEqual([]);
  });
});

describe("formatSeatLabel", () => {
  it("โซนนั่งใช้ชื่อโซนตามด้วยแถวและเลขที่นั่งแบบเดิม", () => {
    expect(
      formatSeatLabel({ zoneName: "VIP", isStanding: false, rowLabel: "A", seatNumber: 12 }),
    ).toBe("VIP A12");
  });

  it("โซนยืนใช้เลขใบและไม่เปิดเผยชื่อแถวผี", () => {
    expect(
      formatSeatLabel({ zoneName: "GA", isStanding: true, rowLabel: "S", seatNumber: 12 }),
    ).toBe("GA · ใบที่ 12");
  });
});
