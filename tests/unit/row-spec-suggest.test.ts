// Unit tests — เสนอ "ที่นั่งต่อแถว" จากกรอบโซน (lib/seatmap/row-spec-suggest.ts)
// พิสูจน์สองเรื่องที่ถ้าพลาดแล้วแอดมินจะบันทึกไม่ผ่านหรือได้ผังผิดข้าง:
//   1. ผลรวมทุกแถวต้องเท่ากับจำนวนที่นั่งรวม "เป๊ะ" และไม่มีแถวว่าง (ด่าน saveZoneRowSpec บังคับ)
//   2. รูปทรงต้องสะท้อนกรอบจริง: หัวกว้าง/กลางคอด/ท้ายกว้าง ตามทิศเวทีที่ถูกต้อง
import { describe, it, expect } from "vitest";
import { suggestRowSpec } from "@/lib/seatmap/row-spec-suggest";
import { MAX_ROWS } from "@/lib/seatmap/seat-rows";

// กรอบโซน V3 จริงจาก DB (BABYMONSTER, รูป 1010×665): รูปตัว L — หัวกว้าง กลางคอดชิดขวา ท้ายกว้างขึ้น
const V3: [number, number][] = [
  [0.5239018087855297, 0.2825693699218151],
  [0.5704134366925064, 0.2825693699218151],
  [0.5691214470284238, 0.5827993254637437],
  [0.5316537467700259, 0.5827993254637437],
  [0.5316537467700259, 0.4434769277939598],
  [0.5497416020671835, 0.4434769277939598],
  [0.5497416020671835, 0.3473248505288977],
  [0.5239018087855297, 0.3473248505288977],
];
const IMAGE = { imageWidth: 1010, imageHeight: 665 };

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
function average(values: number[]): number {
  return sum(values) / values.length;
}

describe("suggestRowSpec — แจกที่นั่งรวมลงแถวตามรูปทรงกรอบโซน", () => {
  it("V3 จริง 620 ที่ 59 แถว (แอดมินบอกจำนวนแถว): รวมเป๊ะ · หัวกว้าง · กลางคอด · ท้ายกว้าง", () => {
    const spec = suggestRowSpec({ polygon: V3, stageSide: null, seatCount: 620, rowCount: 59, ...IMAGE });
    expect(spec).not.toBeNull();
    expect(spec).toHaveLength(59);
    expect(sum(spec!)).toBe(620);
    expect(Math.min(...spec!)).toBeGreaterThanOrEqual(1);
    const head = average(spec!.slice(0, 12)); // ท่อนหัว (ของจริง 14 ที่)
    const waist = average(spec!.slice(14, 31)); // ท่อนคอด (ของจริง 6 ที่)
    const tail = average(spec!.slice(33, 59)); // ท่อนท้าย (ของจริง 12 ที่)
    expect(head).toBeGreaterThan(waist * 1.8);
    expect(tail).toBeGreaterThan(waist * 1.5);
    expect(head).toBeGreaterThan(tail);
  });

  it("ไม่บอกจำนวนแถว → ระบบเลือกให้ในช่วงสมเหตุสมผล และผลรวมยังเป๊ะ", () => {
    const spec = suggestRowSpec({ polygon: V3, stageSide: null, seatCount: 620, ...IMAGE });
    expect(spec).not.toBeNull();
    expect(spec!.length).toBeGreaterThanOrEqual(25);
    expect(spec!.length).toBeLessThanOrEqual(90);
    expect(sum(spec!)).toBe(620);
  });

  it("สี่เหลี่ยมเต็ม 100 ที่ 10 แถว → ทุกแถว 10 ที่เท่ากัน", () => {
    const rect: [number, number][] = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]];
    const spec = suggestRowSpec({ polygon: rect, stageSide: "top", seatCount: 100, rowCount: 10, imageWidth: 1000, imageHeight: 1000 });
    expect(spec).toEqual(new Array(10).fill(10));
  });

  it("สอบเข้า (หน้ากว้าง หลังแคบ) → แถวไล่จากมากไปน้อย ไม่มีแถวไหนกลับมากขึ้น", () => {
    const trapezoid: [number, number][] = [[0, 0], [1, 0], [0.7, 1], [0.3, 1]];
    const spec = suggestRowSpec({ polygon: trapezoid, stageSide: "top", seatCount: 60, rowCount: 6, imageWidth: 400, imageHeight: 400 });
    expect(spec).not.toBeNull();
    for (let index = 1; index < spec!.length; index++) {
      expect(spec![index]).toBeLessThanOrEqual(spec![index - 1]);
    }
    expect(spec![0]).toBeGreaterThan(spec![5]);
    expect(sum(spec!)).toBe(60);
  });

  it("เวทีอยู่ล่าง: แถว A ต้องเป็นขอบล่างของกรอบ (ด้านกว้างของรูปที่แคบบน-กว้างล่าง)", () => {
    const flared: [number, number][] = [[0.3, 0], [0.7, 0], [1, 1], [0, 1]]; // แคบบน กว้างล่าง
    const spec = suggestRowSpec({ polygon: flared, stageSide: "bottom", seatCount: 60, rowCount: 6, imageWidth: 400, imageHeight: 400 });
    expect(spec![0]).toBeGreaterThan(spec![5]); // แถว A (ล่าง = กว้าง) มากกว่าแถวหลัง (บน = แคบ)
  });

  it("เวทีอยู่ซ้าย: แถววิ่งตามแกนนอน — แถว A = ขอบซ้าย", () => {
    const wedge: [number, number][] = [[0, 0.3], [1, 0], [1, 1], [0, 0.7]]; // แคบซ้าย กว้างขวา
    const spec = suggestRowSpec({ polygon: wedge, stageSide: "left", seatCount: 60, rowCount: 6, imageWidth: 400, imageHeight: 400 });
    expect(spec![0]).toBeLessThan(spec![5]); // ซ้ายแคบ → แถว A น้อยกว่าแถวหลัง
    expect(sum(spec!)).toBe(60);
  });

  it("จำนวนแถวมากกว่าจำนวนที่นั่ง → ลดแถวลงให้ทุกแถวมีอย่างน้อย 1 ที่", () => {
    const rect: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const spec = suggestRowSpec({ polygon: rect, stageSide: "top", seatCount: 5, rowCount: 10, imageWidth: 100, imageHeight: 100 });
    expect(spec).toEqual([1, 1, 1, 1, 1]);
  });

  it("จำนวนแถวเกินเพดานระบบ → ตัดที่ MAX_ROWS", () => {
    const rect: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const spec = suggestRowSpec({ polygon: rect, stageSide: "top", seatCount: 5000, rowCount: 999, imageWidth: 100, imageHeight: 100 });
    expect(spec).toHaveLength(MAX_ROWS);
    expect(sum(spec!)).toBe(5000);
  });

  it("ข้อมูลไม่พอ → null (ไม่มีกรอบ / จุดไม่พอ / จำนวนที่นั่งไม่ถูก)", () => {
    const rect: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(suggestRowSpec({ polygon: null, stageSide: "top", seatCount: 10, imageWidth: 100, imageHeight: 100 })).toBeNull();
    expect(suggestRowSpec({ polygon: [[0, 0], [1, 1]], stageSide: "top", seatCount: 10, imageWidth: 100, imageHeight: 100 })).toBeNull();
    expect(suggestRowSpec({ polygon: rect, stageSide: "top", seatCount: 0, imageWidth: 100, imageHeight: 100 })).toBeNull();
    expect(suggestRowSpec({ polygon: rect, stageSide: "top", seatCount: 12.5, imageWidth: 100, imageHeight: 100 })).toBeNull();
  });

  it("ผลรวมเท่ากับจำนวนที่นั่งเสมอ ไม่ว่ารูปทรง/จำนวนแถวไหน (สุ่มตรวจหลายชุด)", () => {
    const shapes: [number, number][][] = [
      V3,
      [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], // ข้าวหลามตัด (โซนเอียง)
      [[0, 0], [0.3, 0], [1, 1], [0.7, 1]], // แท่งเอียง
      [[0, 0], [1, 0], [1, 0.3], [0.6, 0.3], [0.6, 1], [0.4, 1], [0.4, 0.3], [0, 0.3]], // ตัว T
    ];
    for (const polygon of shapes) {
      for (const seatCount of [7, 40, 133, 620]) {
        for (const rowCount of [undefined, 3, 17]) {
          const spec = suggestRowSpec({ polygon, stageSide: null, seatCount, rowCount, ...IMAGE });
          expect(spec).not.toBeNull();
          expect(sum(spec!)).toBe(seatCount);
          expect(Math.min(...spec!)).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});
