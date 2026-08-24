// Unit tests — ชั้นที่คั่นระหว่าง "ข้อมูลผังใน DB" กับ "สิ่งที่คนซื้อเห็น" (Phase 2 D4-D5)
//
// สองฟังก์ชันนี้เล็กแต่พลาดแล้วเสียหายคนละแบบ:
//   parsePolygon()     = ด่านตัดสินว่าจะวาดผังบนรูปจริง หรือถอยไปผังตารางแบบเดิม
//                        ถ้าปล่อยข้อมูลผิดรูปผ่าน หน้าเลือกที่นั่งจะพังตอน render
//                        (ทั้งที่ระบบยังขายบัตรได้ปกติถ้าถอยไปผังตาราง)
//   compareSeatOrder() = ลำดับเรียงที่นั่งในแผงเลือกที่นั่งของแต่ละโซน
//                        ถ้าลำดับเพี้ยน แถวจะสลับกัน (A, AA, B) คนซื้อหาที่นั่งของตัวเองไม่เจอ
import { describe, it, expect } from "vitest";
import { parsePolygon, polygonArea } from "@/lib/seatmap/polygon";
import { compareSeatOrder, rowLabelFor } from "@/lib/seatmap/seat-rows";
import {
  isSeatLabelLegible,
  MIN_LABEL_FONT_PX,
  OUTLINE_DARK,
  OUTLINE_LIGHT,
  parseHexColor,
  relativeLuminance,
  seatGridRenderHints,
  seatOutline,
} from "@/lib/seatmap/render-hints";

describe("seatGridRenderHints — ตำแหน่งเวทีและลำดับแถว", () => {
  it.each([
    ["top", false],
    ["bottom", true],
    ["left", false],
    ["right", false],
    [null, false],
  ] as const)("ทิศ %s วางแถบถูกด้านและ reverseRows = %s", (stageSide, reverseRows) => {
    expect(seatGridRenderHints(stageSide)).toEqual({ stageSide, reverseRows });
  });
});

describe("parsePolygon — ยอมรับเฉพาะกรอบที่ใช้วาดได้จริง", () => {
  it("กรอบสามเหลี่ยม (จุดน้อยสุดที่เป็นรูปปิดได้) ผ่าน", () => {
    expect(parsePolygon([
      [0, 0],
      [1, 0],
      [0.5, 1],
    ])).toEqual([
      [0, 0],
      [1, 0],
      [0.5, 1],
    ]);
  });

  it("กรอบ 6 จุด (โซนรูปตัว L) ผ่านครบทุกจุด ไม่ตัดทิ้ง", () => {
    const hexagon = [
      [0, 0],
      [0.6, 0],
      [0.6, 0.5],
      [1, 0.5],
      [1, 1],
      [0, 1],
    ];
    expect(parsePolygon(hexagon)).toHaveLength(6);
  });

  it("โซนที่ยังไม่เคยวาดกรอบ (null) → ไม่ใช่กรอบ", () => {
    expect(parsePolygon(null)).toBeNull();
  });

  it("2 จุด ปิดเป็นรูปไม่ได้ → ไม่ใช่กรอบ", () => {
    expect(parsePolygon([
      [0, 0],
      [1, 1],
    ])).toBeNull();
  });

  it("อาเรย์ว่าง → ไม่ใช่กรอบ", () => {
    expect(parsePolygon([])).toBeNull();
  });

  // ตั้งแต่นี้ลงไปคือข้อมูลผิดรูปที่ "เข้ามาได้จริง" — แก้มือใน DB, ของเก่าคนละเวอร์ชัน,
  // หรือ JSON ที่ serialize มาแปลก ๆ ทุกเคสต้องคืน null ให้หน้าเว็บถอยไปผังตาราง ไม่ใช่ throw
  it("จุดที่มีแค่ค่าเดียว (ตกไปหนึ่งแกน) → ไม่ใช่กรอบ", () => {
    expect(parsePolygon([[0, 0], [1, 0], [0.5]])).toBeNull();
  });

  it("จุดที่มี 3 ค่า → ไม่ใช่กรอบ", () => {
    expect(parsePolygon([[0, 0, 0], [1, 0, 0], [0.5, 1, 0]])).toBeNull();
  });

  it("พิกัดเป็นสตริง (JSON ที่ quote ตัวเลขมา) → ไม่ใช่กรอบ", () => {
    expect(parsePolygon([["0", "0"], ["1", "0"], ["0.5", "1"]])).toBeNull();
  });

  it("พิกัดเป็น NaN / Infinity → ไม่ใช่กรอบ (ถ้าปล่อยผ่าน SVG จะวาดเป็นรูปว่าง)", () => {
    expect(parsePolygon([[0, 0], [1, 0], [Number.NaN, 1]])).toBeNull();
    expect(parsePolygon([[0, 0], [1, 0], [Number.POSITIVE_INFINITY, 1]])).toBeNull();
  });

  it("จุดเป็น object แทนอาเรย์ ({x,y}) → ไม่ใช่กรอบ", () => {
    expect(parsePolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }])).toBeNull();
  });

  it("ไม่ใช่อาเรย์เลย (string / number / object) → ไม่ใช่กรอบ", () => {
    expect(parsePolygon("[[0,0],[1,0],[0,1]]")).toBeNull();
    expect(parsePolygon(42)).toBeNull();
    expect(parsePolygon({ points: [] })).toBeNull();
    expect(parsePolygon(undefined)).toBeNull();
  });
});

describe("compareSeatOrder — ลำดับอ่านผัง (แถวบนลงล่าง ซ้ายไปขวา)", () => {
  const seat = (rowLabel: string, seatNumber: number) => ({ rowLabel, seatNumber });

  it("แถวเดียวกัน เรียงตามเลขที่นั่ง และเลข 2 หลักไม่แซงหน้าเลขหลักเดียว", () => {
    const sorted = [seat("A", 10), seat("A", 2), seat("A", 1)].sort(compareSeatOrder);
    expect(sorted.map((s) => s.seatNumber)).toEqual([1, 2, 10]);
  });

  it("คนละแถว เรียงตามชื่อแถวก่อนเลขที่นั่ง", () => {
    const sorted = [seat("B", 1), seat("A", 99)].sort(compareSeatOrder);
    expect(sorted.map((s) => s.rowLabel)).toEqual(["A", "B"]);
  });

  // 🔴 เคสสำคัญสุดของไฟล์นี้ — โซนใหญ่เกิน 26 แถวเจอจริง (โซนยืน/สนามหญ้า)
  it("แถว AA ต้องอยู่หลัง Z ไม่ใช่แทรกระหว่าง A กับ B", () => {
    const sorted = [seat("AA", 1), seat("B", 1), seat("Z", 1), seat("A", 1)].sort(compareSeatOrder);
    expect(sorted.map((s) => s.rowLabel)).toEqual(["A", "B", "Z", "AA"]);
  });

  it("เรียงแบบ string ล้วน (วิธีที่ผิด) ให้ผลต่างจริง — พิสูจน์ว่าเทสข้อบนไม่ใช่ของแถม", () => {
    const rows = ["AA", "B", "Z", "A"];
    const naive = [...rows].sort((a, b) => a.localeCompare(b));
    expect(naive).toEqual(["A", "AA", "B", "Z"]); // AA แทรกหน้า B = ผังเพี้ยนยกโซน
  });

  it("ลำดับตรงกับที่ rowLabelFor เจนออกมา — ผังใหญ่ 30 แถวไม่มีสลับ", () => {
    const labels = Array.from({ length: 30 }, (_, i) => rowLabelFor(i));
    const shuffled = [...labels].reverse().map((rowLabel) => seat(rowLabel, 1));
    const sorted = shuffled.sort(compareSeatOrder).map((s) => s.rowLabel);
    expect(sorted).toEqual(labels);
  });

  it("เรียงที่นั่งที่มาแบบสุ่มให้ตรงกับลำดับที่เจนออกมา 1:1", () => {
    // ที่นั่งเดิมในโซน 27 แถว แถวละ 2 ที่ — มาแบบไม่เรียง (Prisma ไม่การันตีลำดับ)
    const existing = [
      seat("AA", 2), seat("A", 1), seat("Z", 2), seat("A", 2), seat("Z", 1), seat("AA", 1),
    ];
    // ลำดับที่ buildSeatRows เจนออกมา (A -> Z -> AA)
    const spots = [
      { rowLabel: "A", seatNumber: 1 },
      { rowLabel: "A", seatNumber: 2 },
      { rowLabel: "Z", seatNumber: 1 },
      { rowLabel: "Z", seatNumber: 2 },
      { rowLabel: "AA", seatNumber: 1 },
      { rowLabel: "AA", seatNumber: 2 },
    ];

    const seatsInOrder = [...existing].sort(compareSeatOrder);
    const spotsInOrder = [...spots].sort(compareSeatOrder);

    seatsInOrder.forEach((s, i) => {
      expect(spotsInOrder[i].rowLabel).toBe(s.rowLabel);
      expect(spotsInOrder[i].seatNumber).toBe(s.seatNumber);
    });
    // แถว AA ต้องอยู่ท้ายสุด ไม่ใช่ตามหลัง A เพราะเรียงแบบพจนานุกรม
    expect(spotsInOrder[spotsInOrder.length - 1].rowLabel).toBe("AA");
  });
});

// ------------------------------------------------------------
// เทสถอยหลัง (regression) จากการทดสอบด้วยผังขายบัตรจริง
// ------------------------------------------------------------
// อาการที่เจอบนจอ: ผังสนามจริง 2,200 ที่นั่ง มองไม่เห็นจุดที่นั่งเลยสักจุด
//   ต้นเหตุที่ 1 — จุดใช้ "สีโซน" ล้วน ๆ ไม่มีเส้นขอบ พอแอดมินตั้งสีโซนให้ตรงกับสีโซนในรูป
//                  (ซึ่งเป็นสิ่งที่คนทำโดยธรรมชาติ) จุดจึงกลืนหายไปกับพื้นหลัง
//   ต้นเหตุที่ 2 — เกณฑ์โชว์เลขที่นั่งผูกกับ "จำนวนที่นั่งรวม ≤ 400" ซึ่งสนามจริงเกินเสมอ

describe("seatOutline — จุดที่นั่งต้องแยกออกจากพื้นหลังได้เสมอ", () => {
  it("สีแดงเริ่มต้นของฟอร์มโซน (#ef4444 — สีที่ทำให้เกิดบั๊ก) ได้ขอบเข้มที่ตัดกับตัวจุด", () => {
    expect(seatOutline("#ef4444")).toBe(OUTLINE_DARK);
  });

  it("สีชมพูของโซนยืน (#ec4899) ก็ได้ขอบเข้มเหมือนกัน", () => {
    expect(seatOutline("#ec4899")).toBe(OUTLINE_DARK);
  });

  it("ที่นั่งที่ถูกเลือก (จุดขาว) ได้ขอบเข้ม จึงเด่นที่สุดบนผัง", () => {
    expect(seatOutline("#ffffff")).toBe(OUTLINE_DARK);
  });

  it("ที่นั่งที่ขายแล้ว (เทาเข้ม #3f3f46) ได้ขอบสว่าง ไม่จมหายไปกับธีมมืด", () => {
    expect(seatOutline("#3f3f46")).toBe(OUTLINE_LIGHT);
  });

  it("ไม่ว่าสีโซนเป็นอะไร ขอบต้องไม่ใช่สีเดียวกับตัวจุด — นี่คือหัวใจของการแก้บั๊ก", () => {
    const zoneColors = [
      "#ef4444", "#ec4899", "#f59e0b", "#22c55e",
      "#3b82f6", "#a855f7", "#ffffff", "#09090b", "#64748b",
    ];
    for (const color of zoneColors) {
      expect(seatOutline(color).toLowerCase()).not.toBe(color.toLowerCase());
    }
  });

  it("สีที่อ่านไม่ออกไม่ทำให้พัง — ถือเป็นสีเข้ม แล้วได้ขอบสว่าง", () => {
    expect(seatOutline("ไม่ใช่สี")).toBe(OUTLINE_LIGHT);
  });
});

describe("relativeLuminance / parseHexColor — ฐานของการเลือกสีขอบ", () => {
  it("ดำสนิท = 0, ขาวสนิท = 1", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
  });

  it("hex 3 หลักย่อ กับ 6 หลัก ให้ค่าเดียวกัน", () => {
    expect(parseHexColor("#f00")).toEqual([255, 0, 0]);
    expect(parseHexColor("ff0000")).toEqual([255, 0, 0]);
  });

  it("ค่าที่ไม่ใช่สี hex คืน null (ไม่โยน error ให้หน้าเว็บพัง)", () => {
    expect(parseHexColor("rgb(1,2,3)")).toBeNull();
    expect(parseHexColor("#ff00")).toBeNull();
    expect(parseHexColor("")).toBeNull();
  });
});

describe("isSeatLabelLegible — ตัดสินจากขนาดตัวอักษรจริงบนจอ ไม่ใช่จำนวนที่นั่ง", () => {
  it("ตัวอักษรเล็กกว่าเกณฑ์ = ไม่วาด (วาดไปก็อ่านไม่ออกและหน่วงเปล่า)", () => {
    expect(isSeatLabelLegible(MIN_LABEL_FONT_PX - 0.1)).toBe(false);
  });

  it("ตัวอักษรถึงเกณฑ์ = วาด", () => {
    expect(isSeatLabelLegible(MIN_LABEL_FONT_PX)).toBe(true);
  });

  it("ผังใหญ่ 2,200 ที่ ถ้าจุดใหญ่พอก็ยังได้เลข — เกณฑ์เดิมที่ผูกกับจำนวนที่นั่งจะตัดทิ้งทันที", () => {
    expect(isSeatLabelLegible(12)).toBe(true);
  });

  it("ค่าที่คำนวณไม่ได้ (ยังวัดขนาดผังไม่เสร็จ) ถือว่าไม่วาด", () => {
    expect(isSeatLabelLegible(Number.NaN)).toBe(false);
  });
});

// polygonArea เป็นฐานของ polygonCentroid ซึ่งเป็นตัวกำหนดว่าป้ายชื่อโซน/ป้ายเวทีไปปักตรงไหน
describe("polygonArea — ฐานของจุดปักป้ายชื่อโซนและป้ายเวที", () => {
  it("กรอบสี่เหลี่ยมเต็มรูป = พื้นที่ 1", () => {
    expect(polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]])).toBeCloseTo(1, 9);
  });

  it("สามเหลี่ยมครึ่งรูป = 0.5", () => {
    expect(polygonArea([[0, 0], [1, 0], [0, 1]])).toBeCloseTo(0.5, 9);
  });

  it("วาดทวนเข็มหรือตามเข็มก็ได้พื้นที่เท่ากัน (แอดมินคลิกทิศไหนก็ได้)", () => {
    const clockwise = polygonArea([[0, 0], [0, 1], [1, 1], [1, 0]]);
    const counter = polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(clockwise).toBeCloseTo(counter, 9);
  });

  it("โซนยืนรูปครึ่งวงกลม 6 มุมแบบที่วาดจริง ได้พื้นที่มากกว่าศูนย์", () => {
    const standing: [number, number][] = [
      [0.08, 0.52], [0.53, 0.52], [0.51, 0.62],
      [0.42, 0.68], [0.19, 0.68], [0.10, 0.62],
    ];
    expect(polygonArea(standing)).toBeGreaterThan(0);
  });
});
