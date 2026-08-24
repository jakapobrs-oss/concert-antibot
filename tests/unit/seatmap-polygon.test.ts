import { describe, expect, it } from "vitest";

import {
  appendPointWithinCap,
  insertMidpointWithinCap,
  isPointInPolygon,
  movePolygonPoint,
  polygonCentroid,
  polygonPoleOfInaccessibility,
  translatePolygonWithinBounds,
  type Point,
  type Polygon,
} from "@/lib/seatmap/polygon";

const FRAME: Polygon = [
  [0.2, 0.3],
  [0.8, 0.3],
  [0.8, 0.7],
  [0.2, 0.7],
];
const MAX_POINTS = 60;

describe("appendPointWithinCap — กัน burst จาก stale render", () => {
  it("จำกัดผลลัพธ์ไว้ที่ 60 จุดเมื่อเรียกเพิ่ม 70 ครั้งติดกันก่อน render ใหม่", () => {
    const pointsFromRender = FRAME;
    const latestPointsRef = { current: pointsFromRender };
    let cappedAttempts = 0;

    for (let index = 0; index < 70; index += 1) {
      // closure ยังเห็นค่า render เดิม แต่ ref จำลองค่าที่ handler เพิ่ง commit ใน event ก่อนหน้า
      expect(pointsFromRender).toHaveLength(FRAME.length);
      const result = appendPointWithinCap(latestPointsRef.current, [index / 100, 0.5], MAX_POINTS);
      if (result.added) latestPointsRef.current = result.points;
      else cappedAttempts += 1;
    }

    expect(latestPointsRef.current).toHaveLength(MAX_POINTS);
    expect(cappedAttempts).toBe(14);
  });

  it("คืนผลชนเพดานโดยไม่สร้าง array ใหม่", () => {
    const fullPolygon = Array.from({ length: MAX_POINTS }, (_, index): Point => [
      index / MAX_POINTS,
      0.5,
    ]);
    const result = appendPointWithinCap(fullPolygon, [1, 1], MAX_POINTS);

    expect(result).toEqual({ points: fullPolygon, added: false });
    expect(result.points).toBe(fullPolygon);
  });
});

describe("insertMidpointWithinCap — แทรกจุดจากข้อมูลล่าสุด", () => {
  it("แทรกจุดกึ่งกลางไว้หลังด้านที่เลือก", () => {
    expect(insertMidpointWithinCap(FRAME, 0, MAX_POINTS)).toEqual({
      points: [
        [0.2, 0.3],
        [0.5, 0.3],
        [0.8, 0.3],
        [0.8, 0.7],
        [0.2, 0.7],
      ],
      added: true,
    });
  });

  it("ไม่แทรกเมื่อมีจุดเต็มเพดาน", () => {
    const fullPolygon = Array.from({ length: MAX_POINTS }, (_, index): Point => [
      index / MAX_POINTS,
      0.5,
    ]);
    const result = insertMidpointWithinCap(fullPolygon, 0, MAX_POINTS);

    expect(result).toEqual({ points: fullPolygon, added: false });
    expect(result.points).toBe(fullPolygon);
  });
});

describe("movePolygonPoint — ลากจุดมุม", () => {
  it("ย้ายเฉพาะจุดที่เลือก", () => {
    expect(movePolygonPoint(FRAME, 1, [0.6, 0.4])).toEqual([
      [0.2, 0.3],
      [0.6, 0.4],
      [0.8, 0.7],
      [0.2, 0.7],
    ]);
  });

  it("clamp จุดให้อยู่ในช่วง 0-1 เสมอ และไม่แก้ข้อมูลต้นฉบับ", () => {
    const moved = movePolygonPoint(FRAME, 0, [-0.5, 1.5]);

    expect(moved[0]).toEqual([0, 1]);
    expect(FRAME[0]).toEqual([0.2, 0.3]);
  });
});

describe("translatePolygonWithinBounds — ลากทั้งกรอบโดยไม่บิดรูป", () => {
  it("เลื่อนทุกจุดด้วย delta เดียวกันเมื่อยังไม่ชนขอบ", () => {
    const moved = translatePolygonWithinBounds(FRAME, 0.1, -0.1);

    expect(moved[0][0]).toBeCloseTo(0.3);
    expect(moved[0][1]).toBeCloseTo(0.2);
    expect(moved[2][0]).toBeCloseTo(0.9);
    expect(moved[2][1]).toBeCloseTo(0.6);
  });

  it("ชนขวาและล่างแล้วหยุดทั้งกรอบที่ขอบ", () => {
    const moved = translatePolygonWithinBounds(FRAME, 0.5, 0.5);

    expect(moved).toEqual([
      [0.39999999999999997, 0.6000000000000001],
      [1, 0.6000000000000001],
      [1, 1],
      [0.39999999999999997, 1],
    ]);
    expect(moved[1][0] - moved[0][0]).toBeCloseTo(FRAME[1][0] - FRAME[0][0]);
    expect(moved[2][1] - moved[1][1]).toBeCloseTo(FRAME[2][1] - FRAME[1][1]);
  });

  it("ชนซ้ายและบนแล้วหยุดทั้งกรอบที่ขอบ", () => {
    const moved = translatePolygonWithinBounds(FRAME, -0.8, -0.8);

    expect(moved[0]).toEqual([0, 0]);
    expect(moved[2]).toEqual([0.6000000000000001, 0.39999999999999997]);
  });

  it("กรอบว่างยังคืนกรอบว่าง", () => {
    expect(translatePolygonWithinBounds([], 1, 1)).toEqual([]);
  });
});

describe("polygonPoleOfInaccessibility — หาจุดปักป้ายภายในกรอบ", () => {
  it("คืนจุดในรูปตัว C แม้ centroid จะตกอยู่กลางช่องว่าง", () => {
    const cShape: Polygon = [
      [0, 0],
      [1, 0],
      [1, 0.2],
      [0.2, 0.2],
      [0.2, 0.8],
      [1, 0.8],
      [1, 1],
      [0, 1],
    ];

    expect(isPointInPolygon(cShape, polygonCentroid(cShape))).toBe(false);
    expect(isPointInPolygon(cShape, polygonPoleOfInaccessibility(cShape))).toBe(true);
  });

  it("คืนจุดใกล้กึ่งกลางของสี่เหลี่ยมจัตุรัส", () => {
    const point = polygonPoleOfInaccessibility([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);

    expect(point[0]).toBeCloseTo(0.5, 1);
    expect(point[1]).toBeCloseTo(0.5, 1);
  });

  it("คืนผลเดิมแบบตรงกันทุกหลักเมื่อเรียกซ้ำ", () => {
    expect(polygonPoleOfInaccessibility(FRAME)).toEqual(
      polygonPoleOfInaccessibility(FRAME),
    );
  });

  it("กรอบพื้นที่ศูนย์ไม่ throw และคืนพิกัดที่ใช้งานได้", () => {
    const point = polygonPoleOfInaccessibility([
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ]);

    expect(point.every(Number.isFinite)).toBe(true);
  });
});
