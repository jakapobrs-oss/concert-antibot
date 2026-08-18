// Unit tests — ระบบเจนที่นั่งจากกรอบโซนที่แอดมินวาดทับรูปผัง (Phase 2)
// พิสูจน์ว่า fillPolygonWithSeats():
//   - ให้จำนวนที่นั่ง "เป๊ะตามที่สั่ง" ทั้งกรอบสี่เหลี่ยมและกรอบเว้า (ตัว L)
//   - ไม่โปรยที่นั่งหลุดออกนอกกรอบ
//   - ผลลัพธ์คงที่ (deterministic) — input เดิม ได้ output เดิมทุกครั้ง
// และ canRegenerateZoneSeats() ปฏิเสธการเจนทับโซนที่มีภาระผูกพันแล้ว (จุดที่แตะเงินจริง)
import { describe, it, expect } from "vitest";
import { fillPolygonWithSeats, type Polygon } from "@/lib/seatmap/generate";
import { canRegenerateZoneSeats } from "@/lib/seatmap/guard";

// กรอบสี่เหลี่ยมเต็มรูป (พิกัดเป็นสัดส่วน 0-1)
const SQUARE: Polygon = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

// กรอบรูปตัว L — เว้ามุมขวาบนออก (บริเวณ x > 0.6 และ y < 0.5 ต้องไม่มีที่นั่ง)
const L_SHAPE: Polygon = [
  [0, 0],
  [0.6, 0],
  [0.6, 0.5],
  [1, 0.5],
  [1, 1],
  [0, 1],
];

describe("fillPolygonWithSeats — จำนวนที่นั่งต้องเป๊ะตามที่สั่ง", () => {
  it("กรอบสี่เหลี่ยม สั่ง 100 ที่ ได้ 100 พอดี", () => {
    expect(fillPolygonWithSeats(SQUARE, { targetCount: 100 })).toHaveLength(100);
  });

  it("กรอบตัว L (เว้ามุม) สั่ง 57 ที่ ได้ 57 พอดี", () => {
    expect(fillPolygonWithSeats(L_SHAPE, { targetCount: 57 })).toHaveLength(57);
  });

  it("จำนวนที่ไม่ลงตัวกับกริด (13, 41, 199) ก็ต้องได้เป๊ะ", () => {
    for (const n of [13, 41, 199]) {
      expect(fillPolygonWithSeats(SQUARE, { targetCount: n })).toHaveLength(n);
    }
  });

  it("สั่ง 0 ที่ ได้ array ว่าง (ไม่พัง)", () => {
    expect(fillPolygonWithSeats(SQUARE, { targetCount: 0 })).toEqual([]);
  });
});

describe("fillPolygonWithSeats — ที่นั่งต้องอยู่ในกรอบเท่านั้น", () => {
  it("กรอบตัว L: ไม่มีที่นั่งหลุดเข้าไปในส่วนที่ถูกเว้า", () => {
    const seats = fillPolygonWithSeats(L_SHAPE, { targetCount: 57 });
    // ⚠️ ตรวจด้วยเลขคณิตพิกัดตรง ๆ ไม่เรียก point-in-polygon ของตัวระบบเอง
    //    (ถ้าใช้ฟังก์ชันเดียวกับที่ implement จะกลายเป็นเทสที่อ้างอิงตัวเอง = พิสูจน์อะไรไม่ได้)
    const escapedIntoNotch = seats.filter((s) => s.x > 0.6 && s.y < 0.5);
    expect(escapedIntoNotch).toEqual([]);
  });

  it("ทุกพิกัดอยู่ในช่วง 0-1 (สัดส่วนของรูป ไม่ใช่พิกเซล)", () => {
    for (const s of fillPolygonWithSeats(L_SHAPE, { targetCount: 120 })) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(1);
    }
  });

  it("ไม่มีที่นั่งทับกัน — ไม่มีพิกัดซ้ำ และทุกคู่ห่างกันจริง", () => {
    const seats = fillPolygonWithSeats(SQUARE, { targetCount: 100 });
    const uniqueCoords = new Set(seats.map((s) => s.x + "," + s.y));
    expect(uniqueCoords.size).toBe(seats.length);

    let closestPair = Infinity;
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        const distance = Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y);
        if (distance < closestPair) closestPair = distance;
      }
    }
    expect(closestPair).toBeGreaterThan(0.01);
  });
});

describe("fillPolygonWithSeats — แถวสุดท้ายที่ไม่เต็ม", () => {
  it("ต้องอยู่กึ่งกลางแถว ไม่กองชิดซ้าย (แถวหลังโรงมหรสพจริงเว้นสองข้างเท่ากัน)", () => {
    const seats = fillPolygonWithSeats(L_SHAPE, { targetCount: 57 });
    const labels = [...new Set(seats.map((s) => s.rowLabel))];
    const lastRow = seats.filter((s) => s.rowLabel === labels[labels.length - 1]);
    const fullRow = seats.filter((s) => s.rowLabel === labels[labels.length - 2]);
    // แถวสุดท้ายต้องไม่เต็ม ไม่งั้นเทสนี้ไม่ได้พิสูจน์อะไร
    expect(lastRow.length).toBeLessThan(fullRow.length);

    const xs = (list: typeof seats) => list.map((s) => s.x);
    const gapLeft = Math.min(...xs(lastRow)) - Math.min(...xs(fullRow));
    const gapRight = Math.max(...xs(fullRow)) - Math.max(...xs(lastRow));
    const seatSpacing =
      (Math.max(...xs(fullRow)) - Math.min(...xs(fullRow))) / (fullRow.length - 1);

    // ช่องว่างซ้าย/ขวาต่างกันได้ไม่เกิน 1 ช่วงที่นั่ง (เผื่อจำนวนคี่หารกลางไม่ลงตัว)
    expect(Math.abs(gapLeft - gapRight)).toBeLessThanOrEqual(seatSpacing);
  });
});

describe("fillPolygonWithSeats — ผลลัพธ์คงที่ (deterministic)", () => {
  it("เรียกซ้ำด้วย input เดิม ได้ผลเหมือนเดิมทุกช่อง", () => {
    const first = fillPolygonWithSeats(L_SHAPE, { targetCount: 57 });
    const second = fillPolygonWithSeats(L_SHAPE, { targetCount: 57 });
    expect(first).toEqual(second);
  });
});

describe("fillPolygonWithSeats — เลขแถว/เลขที่นั่ง", () => {
  const seats = fillPolygonWithSeats(SQUARE, { targetCount: 100 });

  it("แถวบนสุดคือ A แล้วไล่ลงเป็น B, C ตามแกน Y", () => {
    const topmost = seats.reduce((min, s) => (s.y < min.y ? s : min), seats[0]);
    expect(topmost.rowLabel).toBe("A");

    const rowsInOrder = [...new Set(seats.map((s) => s.rowLabel))];
    expect(rowsInOrder[0]).toBe("A");
    expect(rowsInOrder[1]).toBe("B");
  });

  it("ในแต่ละแถว เลขที่นั่งเริ่มที่ 1 เรียงซ้ายไปขวา ไม่ข้ามเลข", () => {
    const rowA = seats.filter((s) => s.rowLabel === "A").sort((p, q) => p.x - q.x);
    expect(rowA.map((s) => s.seatNumber)).toEqual(rowA.map((_, i) => i + 1));
  });

  it("ไม่มีเลขที่นั่งซ้ำภายในแถวเดียวกัน", () => {
    const seenPerRow = new Map<string, Set<number>>();
    for (const seat of seats) {
      if (!seenPerRow.has(seat.rowLabel)) seenPerRow.set(seat.rowLabel, new Set());
      const seen = seenPerRow.get(seat.rowLabel)!;
      expect(seen.has(seat.seatNumber)).toBe(false);
      seen.add(seat.seatNumber);
    }
  });

  it("แถวเกิน 26 แถว ใช้ชื่อ AA, AB ต่อ (ไม่ชนกับ A)", () => {
    const many = fillPolygonWithSeats(SQUARE, { targetCount: 900 });
    const allRows = [...new Set(many.map((s) => s.rowLabel))];
    expect(allRows.length).toBe(new Set(allRows).size);
    if (allRows.length > 26) expect(allRows[26]).toBe("AA");
  });
});

describe("fillPolygonWithSeats — สัดส่วนภาพ (aspectRatio)", () => {
  it("รูปกว้างเป็น 2 เท่าของสูง: ระยะห่างแกน X (หน่วยสัดส่วน) ต้องเป็นครึ่งของแกน Y", () => {
    // พิกัดเก็บเป็นสัดส่วน 0-1 ทั้งสองแกน ถ้าเว้นระยะเท่ากันในหน่วยสัดส่วน
    // เวลา render จริงที่นั่งจะห่างไม่เท่ากันบนจอ -> ต้องชดเชยด้วย aspectRatio
    const seats = fillPolygonWithSeats(SQUARE, { targetCount: 200, aspectRatio: 2 });
    const xs = [...new Set(seats.map((s) => s.x))].sort((a, b) => a - b);
    const ys = [...new Set(seats.map((s) => s.y))].sort((a, b) => a - b);
    const stepX = xs[1] - xs[0];
    const stepY = ys[1] - ys[0];
    expect(stepY / stepX).toBeCloseTo(2, 1);
  });
});

describe("canRegenerateZoneSeats — 🔴 กันเจนทับที่นั่งที่มีภาระผูกพัน (แตะเงินจริง)", () => {
  it("โซนยังไม่มีที่นั่งเลย เจนได้", () => {
    expect(canRegenerateZoneSeats([]).allowed).toBe(true);
  });

  it("ที่นั่งว่างล้วน เจนทับได้", () => {
    expect(
      canRegenerateZoneSeats([{ status: "AVAILABLE" }, { status: "AVAILABLE" }]).allowed,
    ).toBe(true);
  });

  it("❌ มีที่นั่ง SOLD แม้แค่ที่เดียว ต้องปฏิเสธ", () => {
    expect(canRegenerateZoneSeats([{ status: "AVAILABLE" }, { status: "SOLD" }]).allowed).toBe(
      false,
    );
  });

  it("❌ มีที่นั่ง HELD (กำลังถูกจองค้างอยู่) ต้องปฏิเสธ", () => {
    expect(canRegenerateZoneSeats([{ status: "HELD" }]).allowed).toBe(false);
  });

  it("❌ status ว่างแล้ว แต่ยังมีตั๋วผูกอยู่ (ตั๋วที่ถูกคืน) ต้องปฏิเสธ เพราะลบที่นั่งจะชน FK", () => {
    expect(canRegenerateZoneSeats([{ status: "AVAILABLE", hasTicket: true }]).allowed).toBe(false);
  });

  it("❌ ยังมี order item ผูกอยู่ ต้องปฏิเสธ", () => {
    expect(canRegenerateZoneSeats([{ status: "AVAILABLE", hasOrderItem: true }]).allowed).toBe(
      false,
    );
  });

  it("BLOCKED (แอดมินปิดที่นั่งเอง) ไม่ใช่ภาระผูกพัน เจนทับได้", () => {
    expect(canRegenerateZoneSeats([{ status: "BLOCKED" }]).allowed).toBe(true);
  });

  it("ตอนปฏิเสธต้องบอกจำนวนที่ติด เพื่อให้แอดมินรู้ว่าติดกี่ที่", () => {
    const verdict = canRegenerateZoneSeats([
      { status: "SOLD" },
      { status: "SOLD" },
      { status: "HELD" },
      { status: "AVAILABLE" },
    ]);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.blocked.sold).toBe(2);
      expect(verdict.blocked.held).toBe(1);
      expect(verdict.reason).toContain("2");
    }
  });
});
