// ============================================================
// อ่าน/สร้างไฟล์ Excel ของ "ชีตโซน" — ส่วนที่คุยกับ exceljs โดยตรง
// ============================================================
// 🔒 ไฟล์นี้ทำงานฝั่งเซิร์ฟเวอร์เท่านั้น (Node runtime) ห้าม import จาก client component
//    .xlsx คือไฟล์ zip ที่มี xml ข้างใน — การแกะไฟล์ที่ผู้ใช้ส่งมาคือพื้นที่เสี่ยง
//    ด่านที่กันไว้: (1) เข้าถึงได้เฉพาะแอดมินที่ยืนยันตัวแล้ว (2) จำกัดขนาดไฟล์ที่ action
//    (3) จำกัดจำนวนแถวที่อ่าน (4) ข้อมูลที่ได้ต้องผ่าน zod ที่ action อีกชั้นก่อนลงฐาน
//
// หน้าที่ของไฟล์นี้มีแค่ "ดึงค่าดิบออกจากเซลล์" — กฎความถูกต้องทั้งหมดอยู่ใน zone-sheet.ts
// (แยกกันเพื่อให้ตรรกะการตรวจเทสได้โดยไม่ต้องพึ่งไฟล์ .xlsx จริง)
import ExcelJS from "exceljs";

import {
  MAX_ZONE_ROWS,
  REQUIRED_COLUMNS,
  COLUMN_ALIASES,
  matchColumn,
  parseZoneRows,
  type RawZoneRow,
  type ZoneColumnKey,
  type ZoneSheetResult,
} from "./zone-sheet";

// อ่านเกินเพดานโซนไปหน่อยเพื่อให้ยังฟ้องได้ว่า "เกินเพดาน" แทนที่จะเงียบ ๆ ตัดทิ้ง
const MAX_SCAN_ROWS = MAX_ZONE_ROWS + 50;
// หัวตารางต้องอยู่ใน 10 แถวแรก — เผื่อคนใส่ชื่อคอนเสิร์ต/โลโก้ไว้ข้างบนก่อนตาราง
const MAX_HEADER_SCAN_ROWS = 10;

/** ดึงข้อความจากเซลล์ — ค่าใน Excel มีได้หลายทรง (สูตร/ข้อความมีรูปแบบ/ลิงก์) */
function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // เซลล์สูตร -> ใช้ผลลัพธ์ที่ Excel คำนวณไว้ (ระบบไม่คำนวณสูตรเอง)
    if ("result" in value && value.result !== undefined && value.result !== null) {
      return String(value.result).trim();
    }
    // ข้อความที่จัดรูปแบบหลายช่วง (rich text) -> ต่อกลับเป็นข้อความเดียว
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim();
    }
    if ("text" in value && typeof value.text === "string") return value.text.trim();
  }
  return "";
}

/**
 * สีพื้นของเซลล์ในรูป ARGB — คืน null ถ้าอ่านไม่ได้
 *
 * ⚠️ สีที่เลือกจากแถว "Theme Colors" ใน Excel จะไม่มีค่า argb (เก็บเป็นหมายเลขธีม + ค่าความอ่อนแก่)
 *    ต้องแปลงผ่านตารางธีมของไฟล์ถึงจะได้สีจริง -> ไม่รองรับ และให้ผู้ใช้ไปพิมพ์รหัสสีแทน
 *    (เขียนเหตุผลนี้ไว้ในข้อความ error ของ zone-sheet.ts แล้ว)
 */
function cellFillArgb(cell: ExcelJS.Cell): string | null {
  const fill = cell.fill;
  if (!fill || fill.type !== "pattern") return null;
  const pattern = fill as ExcelJS.FillPattern;
  const argb = pattern.fgColor?.argb;
  return typeof argb === "string" ? argb : null;
}

/** แถวหัวตาราง = แถวแรกที่จับคู่คอลัมน์ที่ต้องมีได้ครบ */
function findHeaderRow(
  sheet: ExcelJS.Worksheet,
): { rowNumber: number; columns: Map<ZoneColumnKey, number> } | null {
  const limit = Math.min(sheet.rowCount, MAX_HEADER_SCAN_ROWS);
  for (let rowNumber = 1; rowNumber <= limit; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const columns = new Map<ZoneColumnKey, number>();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const column = matchColumn(cellText(cell));
      // คอลัมน์ชื่อซ้ำ -> ยึดอันซ้ายสุด
      if (column && !columns.has(column)) columns.set(column, colNumber);
    });
    if (REQUIRED_COLUMNS.every((column) => columns.has(column))) {
      return { rowNumber, columns };
    }
  }
  return null;
}

/**
 * อ่านชีตแรกของไฟล์ .xlsx แล้วส่งต่อให้ตัวตรวจ
 * คืน error เป็นข้อความไทยพร้อมเลขแถว ไม่ throw (ให้หน้าแอดมินโชว์ได้ตรง ๆ)
 */
export async function readZoneSheet(data: ArrayBuffer | Buffer): Promise<ZoneSheetResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs รับ Buffer — ArrayBuffer ที่มาจากฝั่งเว็บต้องห่อก่อน
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data));
    await workbook.xlsx.load(buffer);
  } catch {
    return { ok: false, errors: ["เปิดไฟล์ไม่ได้ — ต้องเป็นไฟล์ Excel (.xlsx) ที่ไม่เสียหาย"] };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) {
    return { ok: false, errors: ["ไฟล์นี้ไม่มีข้อมูลในชีตแรก"] };
  }

  const header = findHeaderRow(sheet);
  if (!header) {
    const expected = REQUIRED_COLUMNS.map((column) => COLUMN_ALIASES[column][0]).join(" / ");
    return {
      ok: false,
      errors: [`ไม่พบหัวตาราง — แถวบนสุดของตารางต้องมีคอลัมน์: ${expected}`],
    };
  }

  const { rowNumber: headerRowNumber, columns } = header;
  const lastRow = Math.min(sheet.rowCount, headerRowNumber + MAX_SCAN_ROWS);
  const rows: RawZoneRow[] = [];

  for (let rowNumber = headerRowNumber + 1; rowNumber <= lastRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const cellAt = (column: ZoneColumnKey): ExcelJS.Cell | null => {
      const colNumber = columns.get(column);
      return colNumber ? row.getCell(colNumber) : null;
    };

    const nameCell = cellAt("name");
    const colorCell = cellAt("color");
    // ไม่มีคอลัมน์ "สี" ก็ยังใช้ได้ — อ่านสีพื้นจากเซลล์ชื่อโซนแทน (ระบายสีทั้งแถวตามเรท)
    const fillSource = colorCell ?? nameCell;

    rows.push({
      rowNumber,
      name: nameCell ? cellText(nameCell) : "",
      tier: cellAt("tier") ? cellText(cellAt("tier")!) : "",
      price: cellAt("price") ? cellText(cellAt("price")!) : "",
      color: colorCell ? cellText(colorCell) : "",
      fillColor: fillSource ? cellFillArgb(fillSource) : null,
      seatCount: cellAt("seatCount") ? cellText(cellAt("seatCount")!) : "",
      kind: cellAt("kind") ? cellText(cellAt("kind")!) : "",
      rowSpec: cellAt("rowSpec") ? cellText(cellAt("rowSpec")!) : "",
    });
  }

  return parseZoneRows(rows);
}

/** หนึ่งแถวตัวอย่างในไฟล์เทมเพลต */
const TEMPLATE_ROWS: {
  name: string;
  tier: string;
  price: number;
  color: string;
  kind?: "ยืน";
  seatCount?: number;
  rowSpec?: string;
}[] = [
  {
    name: "V1",
    tier: "เรท 1",
    price: 7300,
    color: "FFE11D48",
    seatCount: 42,
    rowSpec: "12,14,16",
  },
  { name: "V2", tier: "เรท 1", price: 7300, color: "FFE11D48" },
  { name: "A1", tier: "เรท 2", price: 6500, color: "FFF59E0B" },
  { name: "A2", tier: "เรท 2", price: 6500, color: "FFF59E0B" },
  { name: "B1", tier: "เรท 3", price: 4500, color: "FF22C55E" },
  { name: "B2", tier: "เรท 3", price: 4500, color: "FF22C55E", kind: "ยืน" },
];

/**
 * สร้างไฟล์ตัวอย่างให้แอดมินโหลดไปกรอก
 * ตั้งใจใส่สีพื้นเซลล์ในคอลัมน์ "สี" ไว้ให้ดูเป็นตัวอย่างว่าระบายสีแทนพิมพ์รหัสก็ได้
 */
export async function buildZoneTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "concert-antibot";

  const sheet = workbook.addWorksheet("โซน");
  sheet.columns = [
    { header: "ชื่อโซน", key: "name", width: 16 },
    { header: "เรทราคา", key: "tier", width: 14 },
    { header: "ราคา", key: "price", width: 12 },
    { header: "สี", key: "color", width: 14 },
    { header: "จำนวนที่นั่ง", key: "seatCount", width: 14 },
    { header: "ประเภทโซน", key: "kind", width: 14 },
    { header: "ที่นั่งต่อแถว", key: "rowSpec", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const template of TEMPLATE_ROWS) {
    const row = sheet.addRow({
      name: template.name,
      tier: template.tier,
      price: template.price,
      color: `#${template.color.slice(2).toLowerCase()}`,
      seatCount: template.seatCount ?? 200,
      kind: template.kind ?? "",
      rowSpec: template.rowSpec ?? "",
    });
    row.getCell("color").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: template.color },
    };
    row.getCell("price").numFmt = "#,##0";
  }

  const guide = workbook.addWorksheet("วิธีใช้");
  guide.columns = [{ width: 100 }];
  for (const line of [
    "กรอกข้อมูลโซนในชีตแรก (ชีตชื่อ “โซน”) — หนึ่งแถวต่อหนึ่งโซน",
    "",
    "ชื่อโซน       ต้องไม่ซ้ำกัน เพราะใช้จับคู่กับกรอบที่วาดบนรูปผัง (เช่น V1, A2, F)",
    "เรทราคา      โซนที่ราคาเท่ากันให้ใช้ชื่อเรทเดียวกัน — ระบบยุบเป็นคำอธิบายสีให้เอง",
    "ราคา          บาทต่อใบ · เรทเดียวกันต้องราคาเท่ากันทุกแถว",
    "สี             พิมพ์รหัสสี เช่น #f59e0b หรือระบายสีพื้นเซลล์ก็ได้",
    "               ⚠️ ระบายสีให้เลือกจากแถว Standard Colors — สีจากแถว Theme Colors ระบบอ่านไม่ได้",
    "               ⚠️ เรทต่างกันต้องคนละสี ไม่งั้นคนซื้อแยกราคาจากผังไม่ได้",
    "จำนวนที่นั่ง   จำนวนเต็ม 1–5000 ต่อโซน",
    "ประเภทโซน     เว้นว่าง/พิมพ์ “นั่ง” สำหรับโซนนั่ง · พิมพ์ “ยืน” สำหรับโซนยืน",
    "ที่นั่งต่อแถว   คอลัมน์เสริม · กรอกจำนวนคั่นด้วยจุลภาค เช่น 12,14,16 และผลรวมต้องเท่าจำนวนที่นั่ง",
    "",
    "อัปโหลดแล้วระบบจะสร้างโซนให้ครบทุกแถว จากนั้นไปวาดกรอบโซนทับรูปผังในหน้าแอดมิน",
  ]) {
    guide.addRow([line]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
