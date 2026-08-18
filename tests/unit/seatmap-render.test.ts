// Unit tests — ชั้นที่คั่นระหว่าง "ข้อมูลผังใน DB" กับ "สิ่งที่คนซื้อเห็น" (Phase 2 D4-D5)
//
// สองฟังก์ชันนี้เล็กแต่พลาดแล้วเสียหายคนละแบบ:
//   parsePolygon()     = ด่านตัดสินว่าจะวาดผังบนรูปจริง หรือถอยไปผังตารางแบบเดิม
//                        ถ้าปล่อยข้อมูลผิดรูปผ่าน หน้าเลือกที่นั่งจะพังตอน render
//                        (ทั้งที่ระบบยังขายบัตรได้ปกติถ้าถอยไปผังตาราง)
//   compareSeatOrder() = ลำดับจับคู่ที่นั่งเดิมกับตำแหน่งใหม่ตอนแอดมินตั้งกรอบทับโซนที่ขายไปแล้ว
//                        ถ้าลำดับเพี้ยน ตั๋วที่ลูกค้าถืออยู่จะชี้จุดผิดบนผัง
import { describe, it, expect } from "vitest";
import { parsePolygon } from "@/lib/seatmap/polygon";
import { compareSeatOrder, rowLabelFor } from "@/lib/seatmap/generate";

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

  it("จับคู่ที่นั่งเดิมกับตำแหน่งใหม่แบบ 1:1 ตามลำดับเดียวกัน (แบบที่ assignZoneFrame ใช้)", () => {
    // ที่นั่งเดิมในโซน 27 แถว แถวละ 2 ที่ — มาแบบไม่เรียง (Prisma ไม่การันตีลำดับ)
    const existing = [
      seat("AA", 2), seat("A", 1), seat("Z", 2), seat("A", 2), seat("Z", 1), seat("AA", 1),
    ];
    // ตำแหน่งใหม่ที่เจนจากกรอบ — ตัวเลข y เรียงตามแถวจริง
    const spots = [
      { rowLabel: "A", seatNumber: 1, y: 0.1 },
      { rowLabel: "A", seatNumber: 2, y: 0.1 },
      { rowLabel: "Z", seatNumber: 1, y: 0.8 },
      { rowLabel: "Z", seatNumber: 2, y: 0.8 },
      { rowLabel: "AA", seatNumber: 1, y: 0.9 },
      { rowLabel: "AA", seatNumber: 2, y: 0.9 },
    ];

    const seatsInOrder = [...existing].sort(compareSeatOrder);
    const spotsInOrder = [...spots].sort(compareSeatOrder);

    // ที่นั่งเดิมชื่อไหน ต้องได้ตำแหน่งของชื่อนั้น (โซนนี้รูปทรงไม่เปลี่ยน จำนวนแถวเท่าเดิม)
    seatsInOrder.forEach((s, i) => {
      expect(spotsInOrder[i].rowLabel).toBe(s.rowLabel);
      expect(spotsInOrder[i].seatNumber).toBe(s.seatNumber);
    });
    // และแถว AA ต้องได้ y ของแถวล่างสุดจริง ๆ ไม่ใช่ y ของแถวบน
    expect(spotsInOrder[spotsInOrder.length - 1].y).toBe(0.9);
  });
});
