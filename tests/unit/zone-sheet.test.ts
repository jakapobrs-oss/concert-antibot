// Unit tests — นำเข้าข้อมูลโซนจากไฟล์ Excel
// พิสูจน์ว่า:
//   - แปลงค่าที่ Excel ส่งมาได้ทุกทรงที่เจอจริง (ตัวเลขมีลูกน้ำ, hex 3 ตัว, ARGB จากสีพื้นเซลล์)
//   - บังคับกฎ "สีเดียว = ราคาเดียว" ที่ทำให้คนซื้ออ่านผังจากสีได้
//   - ฟ้อง error พร้อมเลขแถวให้ครบทุกใบในรอบเดียว (ไฟล์ 69 แถวจะได้ไม่ต้องแก้ทีละรอบ)
//   - อ่านไฟล์ .xlsx จริงได้ (สร้างเทมเพลตแล้ววนอ่านกลับ)
import { describe, it, expect } from "vitest";
import {
  matchColumn,
  normalizeColor,
  parseZoneRows,
  type RawZoneRow,
} from "@/lib/seatmap/zone-sheet";
import { buildZoneTemplate, readZoneSheet } from "@/lib/seatmap/zone-sheet-xlsx";

/** ย่อการสร้างแถวดิบในเทส — ค่าตั้งต้นคือแถวที่ถูกต้องทุกช่อง */
function row(overrides: Partial<RawZoneRow> & { rowNumber: number }): RawZoneRow {
  return {
    name: "V1",
    tier: "เรท 1",
    price: 7300,
    color: "#e11d48",
    fillColor: null,
    seatCount: 200,
    ...overrides,
  };
}

describe("normalizeColor", () => {
  it("รับ hex เต็ม/ย่อ/มีหรือไม่มี # แล้วคืนรูปแบบเดียวกันเสมอ", () => {
    expect(normalizeColor("#F59E0B")).toBe("#f59e0b");
    expect(normalizeColor("f59e0b")).toBe("#f59e0b");
    expect(normalizeColor("#fa0")).toBe("#ffaa00");
  });

  it("ตัดช่องความทึบออกจาก ARGB ที่ได้จากสีพื้นเซลล์", () => {
    // exceljs คืนสีพื้นเซลล์เป็น ARGB 8 หลัก — 2 ตัวแรกคือความทึบ ไม่ใช่สี
    expect(normalizeColor("FFF59E0B")).toBe("#f59e0b");
  });

  it("คืน null เมื่ออ่านไม่ออก", () => {
    expect(normalizeColor("")).toBeNull();
    expect(normalizeColor("แดง")).toBeNull();
    expect(normalizeColor("#12345")).toBeNull();
    expect(normalizeColor(null)).toBeNull();
  });
});

describe("matchColumn", () => {
  it("จับคู่หัวตารางได้ทั้งไทยและอังกฤษ ไม่สนตัวพิมพ์/ช่องว่าง", () => {
    expect(matchColumn("ชื่อโซน")).toBe("name");
    expect(matchColumn("  Zone Name ")).toBe("name");
    expect(matchColumn("SEATS")).toBe("seatCount");
    expect(matchColumn("จำนวนที่นั่ง")).toBe("seatCount");
  });

  it("คืน null สำหรับคอลัมน์ที่ระบบไม่รู้จัก", () => {
    expect(matchColumn("หมายเหตุ")).toBeNull();
    expect(matchColumn("")).toBeNull();
  });
});

describe("parseZoneRows", () => {
  it("ยุบโซนเป็นเรทราคา เรียงจากแพงไปถูก", () => {
    const result = parseZoneRows([
      row({ rowNumber: 2, name: "B1", tier: "เรท 3", price: 4500, color: "#22c55e" }),
      row({ rowNumber: 3, name: "V1", tier: "เรท 1", price: 7300, color: "#e11d48" }),
      row({ rowNumber: 4, name: "V2", tier: "เรท 1", price: 7300, color: "#e11d48" }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.zones).toHaveLength(3);
    expect(result.tiers.map((tier) => tier.tier)).toEqual(["เรท 1", "เรท 3"]);
    // เรท 1 มี 2 โซน ที่นั่งรวม 400 — คำอธิบายสีต้องบอกยอดรวมได้ ไม่ใช่แค่ชื่อ
    expect(result.tiers[0]).toMatchObject({ zoneCount: 2, seatCount: 400, color: "#e11d48" });
  });

  it("อ่านตัวเลขที่มีลูกน้ำ/สัญลักษณ์เงินบาทที่ Excel ใส่มาให้", () => {
    const result = parseZoneRows([row({ rowNumber: 2, price: "฿7,300", seatCount: "1,200" })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.zones[0].price).toBe(7300);
    expect(result.zones[0].seatCount).toBe(1200);
  });

  it("ใช้สีพื้นเซลล์เมื่อไม่ได้พิมพ์รหัสสี", () => {
    const result = parseZoneRows([row({ rowNumber: 2, color: "", fillColor: "FF22C55E" })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.zones[0].color).toBe("#22c55e");
  });

  it("รหัสสีที่พิมพ์เองมาก่อนสีพื้นเซลล์", () => {
    const result = parseZoneRows([
      row({ rowNumber: 2, color: "#e11d48", fillColor: "FF22C55E" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.zones[0].color).toBe("#e11d48");
  });

  it("ปฏิเสธเมื่อเรทเดียวกันราคาไม่ตรงกัน — พร้อมบอกแถวที่ผิด", () => {
    const result = parseZoneRows([
      row({ rowNumber: 2, name: "V1", tier: "เรท 1", price: 7300 }),
      row({ rowNumber: 3, name: "V2", tier: "เรท 1", price: 6500 }),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("แถว 3");
  });

  it("ปฏิเสธเมื่อสีเดียวกันถูกใช้ข้ามเรท (คนซื้อจะแยกราคาจากผังไม่ได้)", () => {
    const result = parseZoneRows([
      row({ rowNumber: 2, name: "V1", tier: "เรท 1", price: 7300, color: "#e11d48" }),
      row({ rowNumber: 3, name: "A1", tier: "เรท 2", price: 6500, color: "#e11d48" }),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("แถว 3");
    expect(result.errors[0]).toContain("เรท 1");
  });

  it("ปฏิเสธชื่อโซนซ้ำ เพราะจับคู่กับกรอบที่วาดไม่ได้", () => {
    const result = parseZoneRows([
      row({ rowNumber: 2, name: "V1" }),
      row({ rowNumber: 5, name: "v1" }), // ต่างแค่ตัวพิมพ์ ก็ยังถือว่าซ้ำ
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("แถว 5");
    expect(result.errors[0]).toContain("แถว 2");
  });

  it("รวบ error ทุกใบในรอบเดียว ไม่หยุดที่ใบแรก", () => {
    const result = parseZoneRows([
      row({ rowNumber: 2, name: "", price: "ฟรี" }),
      row({ rowNumber: 3, name: "A1", seatCount: 0 }),
      row({ rowNumber: 4, name: "A2", color: "", fillColor: null }),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // แถว 2 ผิด 2 ใบ (ไม่มีชื่อ + ราคาไม่ใช่ตัวเลข), แถว 3 และ 4 อย่างละใบ
    expect(result.errors).toHaveLength(4);
    expect(result.errors.filter((error) => error.startsWith("แถว 2"))).toHaveLength(2);
  });

  it("ข้ามแถวว่างท้ายไฟล์ ไม่ถือเป็นข้อผิดพลาด", () => {
    const result = parseZoneRows([
      row({ rowNumber: 2 }),
      { rowNumber: 3, name: "", tier: "", price: "", color: "", fillColor: null, seatCount: "" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.zones).toHaveLength(1);
  });

  it("ปฏิเสธไฟล์ที่ไม่มีข้อมูลเลย", () => {
    expect(parseZoneRows([]).ok).toBe(false);
  });
});

describe("readZoneSheet (ไฟล์ .xlsx จริง)", () => {
  it("อ่านไฟล์เทมเพลตที่ระบบสร้างเองกลับมาได้ครบ", async () => {
    const result = await readZoneSheet(await buildZoneTemplate());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.zones.map((zone) => zone.name)).toEqual(["V1", "V2", "A1", "A2", "B1", "B2"]);
    expect(result.tiers).toHaveLength(3);
    expect(result.tiers[0]).toMatchObject({ tier: "เรท 1", price: 7300, color: "#e11d48" });
  });

  it("ปฏิเสธไฟล์ที่ไม่ใช่ Excel แทนที่จะโยน exception ใส่หน้าแอดมิน", async () => {
    const result = await readZoneSheet(Buffer.from("ไม่ใช่ไฟล์ zip เลยสักนิด"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("เปิดไฟล์ไม่ได้");
  });
});
