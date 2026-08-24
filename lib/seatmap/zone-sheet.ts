// ============================================================
// ตัวตรวจ "ชีตโซน" จากไฟล์ Excel — ส่วนที่เป็นตรรกะล้วน (ไม่แตะ exceljs / ไม่แตะ DB)
// ============================================================
// ที่มา: ผังสนามจริงมีโซนหลายสิบโซน (อิมแพ็ค อารีน่า = 69 โซน / 7 เรทราคา)
//   ถ้าให้แอดมินพิมพ์ชื่อ+ราคา+สี+จำนวนที่นั่งทีละโซนบนหน้าเว็บ = 69 รอบ ผิดง่ายและช้า
//   -> ให้เตรียมข้อมูลใน Excel ทีเดียว แล้วนำเข้า จากนั้นเหลือแค่ "วาดกรอบ" บนรูปผัง
//
// 🔑 แนวคิดสำคัญ: "สี" เป็นสมบัติของ *เรทราคา* ไม่ใช่ของโซน
//    ผังขายบัตรจริงอ่านออกเพราะสีเดียว = ราคาเดียวเสมอ ถ้าปล่อยให้โซนเลือกสีอิสระ
//    คำอธิบายสี (legend) จะเพี้ยนทันทีที่มีคนตั้งสีซ้ำข้ามเรท -> ไฟล์นี้บังคับกฎนั้น
//
// ตั้งใจแยกจาก zone-sheet-xlsx.ts เพื่อให้เทสได้ตรง ๆ โดยไม่ต้องสร้างไฟล์ .xlsx จริง
// และ error ทุกใบต้อง "บอกเลขแถวในไฟล์" เพราะแอดมินต้องกลับไปแก้ใน Excel ให้ถูกแถว
import { parseRowSpec } from "./seat-rows";

/** แถวดิบที่ดึงมาจากไฟล์ — ยังไม่ผ่านการตรวจ (ค่าจาก Excel เป็น string หรือ number ก็ได้) */
export interface RawZoneRow {
  /** เลขแถวจริงในไฟล์ Excel (แถวหัวตาราง = 1) — ใช้ฟ้องกลับให้แอดมินแก้ถูกจุด */
  rowNumber: number;
  name: unknown;
  tier: unknown;
  price: unknown;
  /** รหัสสีที่พิมพ์มาในคอลัมน์ "สี" (เว้นว่างได้ ถ้าเว้นจะใช้สีพื้นเซลล์แทน) */
  color: unknown;
  /** สีพื้นของเซลล์ที่อ่านได้จากไฟล์ — null = ไม่ได้ระบายสี หรืออ่านไม่ได้ (สีตามธีม) */
  fillColor: string | null;
  seatCount: unknown;
  /** ประเภทโซนเป็นคอลัมน์เสริม — ไม่มี/ว่าง = โซนนั่ง */
  kind?: unknown;
  /** จำนวนที่นั่งรายแถวคั่นด้วยจุลภาค — ไม่มี/ว่าง = จัดแถวอัตโนมัติ */
  rowSpec?: unknown;
}

/** โซนหนึ่งแถวที่ผ่านการตรวจแล้ว */
export interface ParsedZone {
  rowNumber: number;
  name: string;
  tier: string;
  price: number;
  /** hex ตัวพิมพ์เล็กเสมอ เช่น #f59e0b — ตรงกับรูปแบบที่ Zone.color ในฐานข้อมูลใช้ */
  color: string;
  seatCount: number;
  isStanding: boolean;
  rowSpec: number[] | null;
}

/** หนึ่งบรรทัดของคำอธิบายสี (legend) — ได้จากการยุบโซนตามเรทราคา */
export interface PriceTier {
  tier: string;
  price: number;
  color: string;
  /** จำนวนโซนที่อยู่ในเรทนี้ */
  zoneCount: number;
  /** ที่นั่งรวมของเรทนี้ */
  seatCount: number;
}

export type ZoneSheetResult =
  | { ok: true; zones: ParsedZone[]; tiers: PriceTier[] }
  | { ok: false; errors: string[] };

// เพดานจำนวนโซนต่อไฟล์ — สนามใหญ่สุดที่ใช้ทดสอบมี 69 โซน เผื่อไว้มากแล้ว
// และกันไฟล์ที่จงใจยัดแถวเป็นแสนเข้ามาให้เซิร์ฟเวอร์วนตรวจ
export const MAX_ZONE_ROWS = 500;
// เพดานที่นั่งต่อโซน — ตรงกับ MAX_SEATS_PER_ZONE ใน app/actions/seatmap.ts
export const MAX_SEATS_PER_ZONE = 5_000;
// ชื่อโซนยาวเกินนี้เก็บไม่ลง Zone.name (VarChar 50)
const MAX_ZONE_NAME_LEN = 50;
const MAX_TIER_NAME_LEN = 50;
const MAX_PRICE = 1_000_000;

/** หัวตารางที่ยอมรับ — รับทั้งไทยและอังกฤษ เพราะบางเครื่องตั้งค่า Excel เป็นอังกฤษ */
export const COLUMN_ALIASES = {
  name: ["ชื่อโซน", "โซน", "zone", "zone name", "name"],
  tier: ["เรทราคา", "เรท", "tier", "price tier", "grade"],
  price: ["ราคา", "price", "amount"],
  color: ["สี", "color", "colour", "hex"],
  seatCount: ["จำนวนที่นั่ง", "ที่นั่ง", "จำนวน", "seats", "seat count", "capacity"],
  kind: ["ประเภทโซน", "ประเภท", "type", "zone type", "kind"],
  rowSpec: ["ที่นั่งต่อแถว", "แถว", "rows", "row spec", "seats per row"],
} as const;

export type ZoneColumnKey = keyof typeof COLUMN_ALIASES;

/** คอลัมน์ที่ขาดไม่ได้ — "สี" ไม่อยู่ในนี้เพราะระบายสีพื้นเซลล์แทนได้ */
export const REQUIRED_COLUMNS: ZoneColumnKey[] = ["name", "tier", "price", "seatCount"];

/**
 * จับคู่ข้อความหัวตารางกับคอลัมน์ที่ระบบรู้จัก
 * ตัดช่องว่าง/ตัวพิมพ์ใหญ่-เล็กออกก่อนเทียบ เพราะคนพิมพ์หัวตารางไม่เป๊ะกันอยู่แล้ว
 */
export function matchColumn(header: string): ZoneColumnKey | null {
  const key = header.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  for (const [column, aliases] of Object.entries(COLUMN_ALIASES) as [
    ZoneColumnKey,
    readonly string[],
  ][]) {
    if (aliases.some((alias) => alias.toLowerCase() === key)) return column;
  }
  return null;
}

/**
 * แปลงรหัสสีให้เป็น #rrggbb ตัวพิมพ์เล็ก — คืน null ถ้าอ่านไม่ออก
 *
 * รับได้ 3 แบบที่เจอจริง:
 *   #f59e0b / f59e0b        คนพิมพ์เอง
 *   #fa0 / fa0              hex ย่อ 3 ตัว
 *   FFF59E0B                ARGB 8 หลักที่ exceljs คืนมาจากสีพื้นเซลล์ (ตัวหน้า = ความทึบ ตัดทิ้ง)
 */
export function normalizeColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const hex = input.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;

  if (hex.length === 3) {
    // ย่อ -> เต็ม: fa0 กลายเป็น ffaa00
    const expanded = hex
      .split("")
      .map((ch) => ch + ch)
      .join("");
    return `#${expanded.toLowerCase()}`;
  }
  if (hex.length === 6) return `#${hex.toLowerCase()}`;
  // ARGB: ตัดช่องความทึบ 2 ตัวหน้าออก เหลือ RGB
  if (hex.length === 8) return `#${hex.slice(2).toLowerCase()}`;
  return null;
}

/** ตัวเลขจาก Excel อาจมาเป็น number, "1,200" หรือ "฿1,200" — ปอกให้เหลือตัวเลขล้วน */
function toNumber(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  const cleaned = input.trim().replace(/[,\s฿]/g, "");
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function toText(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (typeof input === "number") return String(input);
  return "";
}

const STANDING_KINDS = new Set(["ยืน", "โซนยืน", "standing", "stand"]);
const SEATED_KINDS = new Set(["", "นั่ง", "seated"]);

/** แปลงประเภทโซนแบบไม่สนตัวพิมพ์/ช่องว่าง — valid=false ใช้ฟ้องค่าที่ไม่รู้จักพร้อมเลขแถว */
function parseZoneKind(input: unknown): { valid: boolean; isStanding: boolean; value: string } {
  const value = toText(input);
  const normalized = value.toLowerCase();
  if (STANDING_KINDS.has(normalized)) return { valid: true, isStanding: true, value };
  if (SEATED_KINDS.has(normalized)) return { valid: true, isStanding: false, value };
  return { valid: false, isStanding: false, value };
}

/** อ่านค่าแบบ 12,14,16 จากเซลล์ โดยอนุญาตช่องว่างรอบตัวเลขเท่านั้น */
function parseSheetRowSpec(input: unknown): {
  present: boolean;
  value: number[] | null;
} {
  const text = toText(input);
  if (!text) return { present: false, value: null };

  const parts = text.split(",").map((part) => part.trim());
  if (parts.some((part) => !/^\d+$/.test(part))) return { present: true, value: null };
  return { present: true, value: parseRowSpec(parts.map(Number)) };
}

/** แถวว่างเปล่า (คนมักเว้นบรรทัดท้ายไฟล์) — ข้ามไปเงียบ ๆ ไม่ต้องฟ้อง */
function isBlankRow(row: RawZoneRow): boolean {
  return (
    !toText(row.name) &&
    !toText(row.tier) &&
    !toText(row.price) &&
    !toText(row.seatCount) &&
    !toText(row.kind) &&
    !toText(row.rowSpec)
  );
}

/**
 * ตรวจแถวทั้งไฟล์ แล้วยุบเป็นรายการเรทราคาสำหรับทำคำอธิบายสี
 *
 * เก็บ error ให้ครบทุกใบก่อนคืน (ไม่หยุดที่ใบแรก) — ไฟล์ 69 แถวถ้าฟ้องทีละใบ
 * แอดมินต้องวนแก้-อัปโหลดใหม่หลายสิบรอบ
 *
 * กฎที่บังคับ:
 *   1. ชื่อโซนห้ามซ้ำ (ซ้ำ = ตอนจับคู่กับกรอบที่วาดจะไม่รู้ว่าอันไหนคืออันไหน)
 *   2. เรทเดียวกันต้องราคาเท่ากันและสีเดียวกันทุกแถว
 *   3. สีเดียวกันห้ามข้ามเรท (ไม่งั้นคนซื้ออ่านผังจากสีไม่ได้)
 */
export function parseZoneRows(rows: RawZoneRow[]): ZoneSheetResult {
  const errors: string[] = [];
  const zones: ParsedZone[] = [];

  const usable = rows.filter((row) => !isBlankRow(row));
  if (usable.length === 0) {
    return { ok: false, errors: ["ไม่พบข้อมูลโซนในไฟล์ (ตรวจว่ากรอกข้อมูลไว้ในชีตแรกหรือไม่)"] };
  }
  if (usable.length > MAX_ZONE_ROWS) {
    return {
      ok: false,
      errors: [`ไฟล์มี ${usable.length} โซน เกินเพดาน ${MAX_ZONE_ROWS} โซนต่อคอนเสิร์ต`],
    };
  }

  // ชื่อโซน -> เลขแถวแรกที่เจอ (ไว้บอกว่าไปซ้ำกับแถวไหน)
  const seenNames = new Map<string, number>();

  for (const row of usable) {
    const at = `แถว ${row.rowNumber}`;
    const name = toText(row.name);
    const tier = toText(row.tier);
    const price = toNumber(row.price);
    const seatCount = toNumber(row.seatCount);
    const kind = parseZoneKind(row.kind);
    const rowSpec = parseSheetRowSpec(row.rowSpec);
    // คอลัมน์ "สี" มาก่อนสีพื้นเซลล์เสมอ — คนพิมพ์ hex มาแปลว่าตั้งใจกำหนดเอง
    const color = normalizeColor(row.color) ?? normalizeColor(row.fillColor);

    if (!name) errors.push(`${at}: ไม่มีชื่อโซน`);
    else if (name.length > MAX_ZONE_NAME_LEN)
      errors.push(`${at}: ชื่อโซนยาวเกิน ${MAX_ZONE_NAME_LEN} ตัวอักษร`);
    else {
      const duplicateAt = seenNames.get(name.toLowerCase());
      if (duplicateAt !== undefined) {
        errors.push(`${at}: ชื่อโซน "${name}" ซ้ำกับแถว ${duplicateAt}`);
      } else {
        seenNames.set(name.toLowerCase(), row.rowNumber);
      }
    }

    if (!tier) errors.push(`${at}: ไม่มีเรทราคา`);
    else if (tier.length > MAX_TIER_NAME_LEN)
      errors.push(`${at}: ชื่อเรทราคายาวเกิน ${MAX_TIER_NAME_LEN} ตัวอักษร`);

    if (price === null) errors.push(`${at}: ราคาไม่ใช่ตัวเลข`);
    else if (price < 0) errors.push(`${at}: ราคาติดลบไม่ได้`);
    else if (price > MAX_PRICE) errors.push(`${at}: ราคาเกิน ${MAX_PRICE.toLocaleString()} บาท`);

    if (seatCount === null) errors.push(`${at}: จำนวนที่นั่งไม่ใช่ตัวเลข`);
    else if (!Number.isInteger(seatCount))
      errors.push(`${at}: จำนวนที่นั่งต้องเป็นจำนวนเต็ม`);
    else if (seatCount < 1) errors.push(`${at}: จำนวนที่นั่งต้องมากกว่า 0`);
    else if (seatCount > MAX_SEATS_PER_ZONE)
      errors.push(`${at}: จำนวนที่นั่งเกินเพดาน ${MAX_SEATS_PER_ZONE} ที่ต่อโซน`);

    if (!color) {
      errors.push(
        `${at}: ไม่มีสี — พิมพ์รหัสสีในคอลัมน์ "สี" (เช่น #f59e0b) หรือระบายสีพื้นเซลล์ด้วยสีมาตรฐาน (สีตามธีมของ Excel อ่านไม่ได้)`,
      );
    }

    if (!kind.valid) {
      errors.push(
        `${at}: ประเภทโซน "${kind.value}" ไม่ถูกต้อง — ใช้ "นั่ง" หรือ "ยืน"`,
      );
    }

    if (rowSpec.present && rowSpec.value === null) {
      errors.push(
        `${at}: ที่นั่งต่อแถวไม่ถูกต้อง — ใช้จำนวนเต็มบวกคั่นด้วยจุลภาค เช่น 12,14,16`,
      );
    }

    const rowSpecTotal = rowSpec.value?.reduce((sum, count) => sum + count, 0) ?? null;
    const rowSpecMatchesSeats =
      rowSpecTotal === null ||
      seatCount === null ||
      !Number.isInteger(seatCount) ||
      rowSpecTotal === seatCount;
    if (!rowSpecMatchesSeats) {
      errors.push(
        `${at}: ที่นั่งต่อแถวรวม ${rowSpecTotal} ไม่เท่ากับจำนวนที่นั่ง ${seatCount}`,
      );
    }

    const rowSpecAllowed = !kind.isStanding || !rowSpec.present;
    if (!rowSpecAllowed) {
      errors.push(`${at}: โซนยืนกำหนดที่นั่งต่อแถวไม่ได้`);
    }

    if (
      name &&
      tier &&
      price !== null &&
      seatCount !== null &&
      color &&
      kind.valid &&
      (!rowSpec.present || rowSpec.value !== null) &&
      rowSpecMatchesSeats &&
      rowSpecAllowed
    ) {
      zones.push({
        rowNumber: row.rowNumber,
        name,
        tier,
        price,
        color,
        seatCount,
        isStanding: kind.isStanding,
        rowSpec: rowSpec.value,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // ---- ยุบเป็นเรทราคา + ตรวจความสอดคล้อง ----
  const tiers = new Map<string, PriceTier>();
  // สี -> ชื่อเรทที่ใช้สีนี้เป็นเจ้าแรก (กันสีซ้ำข้ามเรท)
  const colorOwner = new Map<string, string>();

  for (const zone of zones) {
    const existing = tiers.get(zone.tier);
    if (!existing) {
      const owner = colorOwner.get(zone.color);
      if (owner !== undefined && owner !== zone.tier) {
        errors.push(
          `แถว ${zone.rowNumber}: สี ${zone.color} ถูกใช้ไปแล้วโดยเรท "${owner}" — เรทต่างกันต้องคนละสี ไม่งั้นคนซื้อแยกราคาจากผังไม่ได้`,
        );
      } else {
        colorOwner.set(zone.color, zone.tier);
      }
      tiers.set(zone.tier, {
        tier: zone.tier,
        price: zone.price,
        color: zone.color,
        zoneCount: 1,
        seatCount: zone.seatCount,
      });
      continue;
    }

    if (existing.price !== zone.price) {
      errors.push(
        `แถว ${zone.rowNumber}: เรท "${zone.tier}" ราคา ${zone.price.toLocaleString()} ไม่ตรงกับที่ตั้งไว้ก่อนหน้า (${existing.price.toLocaleString()})`,
      );
    }
    if (existing.color !== zone.color) {
      errors.push(
        `แถว ${zone.rowNumber}: เรท "${zone.tier}" ใช้สี ${zone.color} ไม่ตรงกับที่ตั้งไว้ก่อนหน้า (${existing.color})`,
      );
    }
    existing.zoneCount += 1;
    existing.seatCount += zone.seatCount;
  }

  if (errors.length > 0) return { ok: false, errors };

  // เรียงเรทจากแพงไปถูก — ตรงกับลำดับที่ผังขายบัตรจริงวางคำอธิบายสี
  const orderedTiers = [...tiers.values()].sort(
    (a, b) => b.price - a.price || a.tier.localeCompare(b.tier),
  );
  return { ok: true, zones, tiers: orderedTiers };
}
