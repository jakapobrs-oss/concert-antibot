// ============================================================
// Render hints — ตัวช่วยตัดสินใจว่า "วาดยังไงคนถึงจะมองเห็นจริง" (Phase 2)
// ============================================================
// ที่มา: ทดสอบด้วยผังขายบัตรจริง (ราชมังคลากีฬาสถาน 2,200 ที่นั่ง) แล้วเจอสองเรื่อง
//   1) จุดที่นั่งใช้ "สีโซน" ล้วน ๆ แต่แอดมินย่อมตั้งสีโซนให้ตรงกับสีโซนในรูปผัง
//      (เป็นสิ่งที่คนทำโดยธรรมชาติ) -> จุดทั้งผังกลืนหายไปกับพื้นหลัง กดสุ่มถึงจะโดน
//   2) เกณฑ์โชว์เลขที่นั่งผูกกับ "จำนวนที่นั่งรวมทั้งผัง" ซึ่งสนามจริงเกินเพดานเสมอ
//      -> บนผังจริงจะไม่มีวันเห็นเลขที่นั่ง ต่อให้ซูมสุดและจุดใหญ่พอจะใส่เลขได้
//
// แยกออกมาเป็น pure function เพราะเทสตรงได้ (เทส component ต้องมี DOM + จำลองการวัดขนาด)

import {
  isPointInPolygon,
  type Polygon,
  type StageSide,
} from "@/lib/seatmap/polygon";

export interface SeatGridRenderHints {
  stageSide: StageSide | null;
  reverseRows: boolean;
}

/** ตัดสินตำแหน่งแถบเวทีและลำดับแถว โดยไม่ผูกกับ React หรือ DOM */
export function seatGridRenderHints(stageSide: StageSide | null): SeatGridRenderHints {
  return {
    stageSide,
    reverseRows: stageSide === "bottom",
  };
}

/** ค่าความสว่างของสีขาว/ดำในสูตร WCAG — ใช้ซ้ำหลายที่ เลยตั้งชื่อไว้แทนตัวเลขลอย */
const LUMINANCE_WHITE = 1;
const LUMINANCE_BLACK = 0;

/** สีเส้นขอบมีแค่สองตัวเลือก เพื่อให้ผลลัพธ์เดาได้และไม่ไปแย่งความเด่นกับสีโซน */
export const OUTLINE_LIGHT = "#ffffff";
export const OUTLINE_DARK = "#09090b";

/**
 * ขนาดตัวอักษรต่ำสุด (พิกเซลจริงบนจอ) ที่ยังพออ่านเลขที่นั่งออก
 * เล็กกว่านี้ตัวเลขจะเละจนอ่านไม่ได้ วาดไปก็เปลืองแรงเครื่องเปล่า ๆ
 */
export const MIN_LABEL_FONT_PX = 7;

/** แปลงสี hex (#rgb หรือ #rrggbb) เป็น [r, g, b] ช่วง 0-255 — คืน null ถ้ารูปแบบไม่ถูก */
export function parseHexColor(hex: string): [number, number, number] | null {
  if (typeof hex !== "string") return null;
  const value = hex.trim().replace(/^#/, "");

  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    const [r, g, b] = value.split("");
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) {
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  }
  return null;
}

/**
 * ความสว่างสัมพัทธ์ (relative luminance) ตามสูตร WCAG 2.x — 0 = ดำสนิท, 1 = ขาวสนิท
 * สีที่อ่านไม่ออกจะถือเป็นสีเข้ม เพื่อให้ได้ขอบสีอ่อนซึ่งปลอดภัยกว่าบนธีมมืดของเว็บนี้
 */
export function relativeLuminance(hex: string): number {
  const rgb = parseHexColor(hex);
  if (!rgb) return LUMINANCE_BLACK;

  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** อัตราส่วนความต่างสี (contrast ratio) ระหว่างความสว่างสองค่า — ช่วง 1:1 ถึง 21:1 */
function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * เลือกสีเส้นขอบของจุดที่นั่ง โดยเอาสีที่ "ต่างจากตัวจุดมากที่สุด" ระหว่างขาวกับดำ
 *
 * ทำไมยึดสีจุดไม่ใช่สีพื้นหลัง: พื้นหลังเป็นรูปถ่ายผังจริง อ่านสีตรงนั้นไม่ได้จาก SVG
 * แต่เคสที่พังคือ "สีจุด ≈ สีพื้นหลัง" อยู่แล้ว ขอบที่ต่างจากจุดมากที่สุด
 * จึงต่างจากพื้นหลังมากที่สุดไปด้วย -> รับประกันว่าจุดแยกออกจากพื้นได้เสมอ
 */
export function seatOutline(fill: string): string {
  const luminance = relativeLuminance(fill);
  const vsLight = contrastRatio(luminance, LUMINANCE_WHITE);
  const vsDark = contrastRatio(luminance, LUMINANCE_BLACK);
  return vsLight >= vsDark ? OUTLINE_LIGHT : OUTLINE_DARK;
}

/**
 * เลขที่นั่งจะอ่านออกไหมที่ขนาดตัวอักษรจริงบนจอ
 *
 * เดิมตัดสินจาก "จำนวนที่นั่งรวมทั้งผัง ≤ 400" ซึ่งผิดฝาผิดตัว —
 * ผังที่นั่ง 600 ที่แต่จุดใหญ่ ๆ ควรเห็นเลข ส่วนผัง 2,200 ที่ที่จุดเล็กกว่าหัวเข็มไม่ควรวาด
 * สิ่งที่ตัดสินได้จริงคือขนาดตัวอักษรหลังคูณระดับซูมและขนาดรูปบนจอแล้ว
 */
export function isSeatLabelLegible(fontPx: number): boolean {
  return Number.isFinite(fontPx) && fontPx >= MIN_LABEL_FONT_PX;
}

// ---------------------------------------------------------------
// ขนาดชื่อโซนบนผังรวม — ต้องพอดีกับที่ว่างในโซนจริง ไม่ใช่ขนาดเดียวเท่ากันหมด
// ---------------------------------------------------------------
// ที่มา (บั๊กจริงจากการดูผังอิมแพ็ค 69 โซน): เดิมทุกโซนใช้ฟอนต์ขนาดเดียว = สัดส่วนของความกว้างรูป
// โซนใหญ่กลางสนามพอดี แต่โซนเล็กริมขอบซึ่งมีเป็นสิบ ๆ โซน ชื่อล้นออกนอกกรอบไปทับโซนข้าง ๆ
// และทับตัวหนังสือที่พิมพ์มาในรูปผังอยู่แล้ว -> ผังรวมกลายเป็นพรมตัวอักษร มองไม่ออกว่าผังหน้าตายังไง
//
// วิธีคิด: วัด "วงกลมใหญ่สุดที่ยัดลงในกรอบโซนได้" (รัศมี = ระยะจากจุดในสุดถึงขอบ)
// แล้วหาขนาดฟอนต์ที่ทำให้กล่องข้อความยังอยู่ในวงกลมนั้น จากสูตรกล่องในวงกลม:
//   (กว้าง/2)² + (สูง/2)² ≤ รัศมี²   โดย กว้าง ≈ ฟอนต์ × ความกว้างเฉลี่ยต่อตัวอักษร × จำนวนตัวอักษร
// ชื่อยาวจึงได้ฟอนต์เล็กลงเองโดยไม่ต้องมีตารางกำหนดมือ
// โซนที่คำนวณแล้วเล็กกว่าเกณฑ์อ่านออก = ไม่วาดชื่อเลย (ยังกดได้ ยังมี tooltip/ชื่อสำหรับโปรแกรมอ่านหน้าจอ)

/** ความกว้างเฉลี่ยต่อตัวอักษรของฟอนต์ display ที่ใช้บนผัง คิดเป็นเท่าของขนาดฟอนต์ */
const ZONE_LABEL_GLYPH_ADVANCE = 0.62;

export function zoneLabelFontSize(options: {
  /** รัศมีวงกลมใหญ่สุดที่ยัดลงในกรอบโซนได้ (หน่วยเดียวกับ maxFont) */
  inradius: number;
  /** จำนวนตัวอักษรของชื่อโซน */
  nameLength: number;
  /** เพดานขนาดฟอนต์ ถ้าโซนใหญ่พอ */
  maxFont: number;
  /** ขนาดต่ำสุดที่ยังอ่านออก — เล็กกว่านี้คืน null (ไม่ต้องวาด) */
  minFont: number;
}): number | null {
  const { inradius, nameLength, maxFont, minFont } = options;
  if (!Number.isFinite(inradius) || inradius <= 0) return null;
  if (!Number.isFinite(maxFont) || maxFont <= 0) return null;
  if (nameLength <= 0) return null;

  const halfWidthPerFont = (ZONE_LABEL_GLYPH_ADVANCE * nameLength) / 2;
  const halfHeightPerFont = 0.5;
  const fitted =
    inradius / Math.hypot(halfWidthPerFont, halfHeightPerFont);
  const font = Math.min(maxFont, fitted);
  return font >= minFont ? font : null;
}

// ---------------------------------------------------------------
// ระยะร่นซ้ายรายแถวของกริดที่นั่ง — ให้เงาของกริดตรงกับรูปทรงโซนบนผังจริง
// ---------------------------------------------------------------
// ที่มา (บั๊กจริงจาก user-test): โซน V3 เป็นรูปตัว L — หัวโซนกว้างเต็ม ช่วงกลางคอดชิดขวา
// (โดนแท่นเวทีกินพื้นที่ฝั่งซ้าย = "เว้าซ้าย") แล้วท้ายโซนกว้างขึ้นแต่ร่นจากซ้ายเล็กน้อย
// การจัดชิดข้างเดียวทั้งโซน (ซ้าย/กลาง/ขวา) เลยไม่มีทางตรงรูป — ต้องตัดสิน "ทีละแถว"
//
// วิธีคิด: แถวที่ i ลึกจากฝั่งเวทีเป็นสัดส่วน (i+0.5)/n ของความสูงโซน
// สแกนหน้าตัดแนวนอนของกรอบโซนที่ความลึกนั้น หา "กึ่งกลาง" ของหน้าตัด
// แล้ววางแถว (กว้างตามจำนวนที่นั่งจริงของแถว) ให้กึ่งกลางแถวตรงกับกึ่งกลางหน้าตัด
// → คืนระยะร่นซ้ายเป็นสัดส่วนของ "ความกว้างแถวที่กว้างสุด" (= ความกว้างกริดใน UI)
//
// ทำไมยึดกึ่งกลาง ไม่ใช่ขอบซ้ายของหน้าตัด: โซนที่วางเอียง (โค้งรอบสนาม) หน้าตัดแนวนอน
// จะกว้าง-แคบเป็นรูปข้าวหลามตัดทั้งที่แถวจริงกว้างเท่ากันทุกแถว — ยึดขอบซ้ายจะได้กริดซิกแซก
// ยึดกึ่งกลางจะได้กริดเอียงตามแนวโซน ซึ่งใกล้ของจริงที่สุดเท่าที่กริดสี่เหลี่ยมทำได้
// (กริดหมุนตามโซนถูกถอดออกแล้วโดยตั้งใจ — ดู docs/20_SEATMAP.md §2.1)
// ตอบได้เฉพาะตอนแถวเรียงตามแกนตั้งของรูป (เวทีบน/ล่าง หรือไม่รู้ทิศซึ่ง fallback เป็นบน)
// เวทีซ้าย/ขวา = แกนแถวเป็นแนวนอน → คืนศูนย์ล้วน (ชิดซ้ายแบบเดิม ปลอดภัยไว้ก่อน)

// ความละเอียดการสแกนหน้าตัดต่อแถว — คลาดเคลื่อนสูงสุด ~1/48 (~2%) ของความกว้างโซน
const ROW_INSET_SAMPLE_COLS = 48;
// เพดานระยะร่น (เท่าของความกว้างกริด) — โซนบางเฉียบที่เอียงมากอาจคำนวณได้หลายเท่า กันกริดกว้างเกินเหตุ
const MAX_ROW_INSET = 3;

export function rowInsetFractions(
  polygon: Polygon | null,
  stageSide: StageSide | null,
  rowSeatCounts: number[],
): number[] {
  const rowCount = rowSeatCounts.length;
  const zeros = new Array<number>(rowCount).fill(0);
  if (rowCount === 0) return zeros;
  if (!polygon || polygon.length < 3) return zeros;
  // แถวในกริดเรียงแนวตั้งเสมอ — เวทีอยู่ข้าง (แกนแถวจริงเป็นแนวนอน) เทียบหน้าตัดแนวนอนไม่ได้
  if (stageSide === "left" || stageSide === "right") return zeros;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return zeros;
  const maxSeats = Math.max(...rowSeatCounts);
  if (maxSeats <= 0) return zeros;

  // ปกติ "แถว A (หน้าสุด)" คือขอบบนของรูป — เวทีอยู่ล่างก็ไล่จากขอบล่างขึ้นไปแทน
  const frontIsTop = stageSide !== "bottom";

  // หน้าตัดของแต่ละแถว: (ซ้าย, ขวา) เป็นสัดส่วนของกรอบโซน — null ถ้าตาข่ายไม่โดนโซนเลย
  const slices = rowSeatCounts.map((_, rowIndex) => {
    // ใช้กึ่งกลางแถว ไม่ใช่ขอบแถว — กันไปสุ่มโดนรอยต่อระหว่างท่อนของรูปพอดี
    const depth = (rowIndex + 0.5) / rowCount;
    const y = frontIsTop ? minY + depth * height : maxY - depth * height;
    let left: number | null = null;
    let right: number | null = null;
    for (let col = 0; col < ROW_INSET_SAMPLE_COLS; col++) {
      const fraction = (col + 0.5) / ROW_INSET_SAMPLE_COLS;
      if (isPointInPolygon(polygon, [minX + fraction * width, y])) {
        if (left === null) left = fraction;
        right = fraction;
      }
    }
    return left === null || right === null ? null : { left, right };
  });

  // แถวที่กว้างสุด (ที่นั่งมากสุด) = หน้าตัดที่กว้างสุดของโซน — ใช้เป็นสเกลแปลง "ที่นั่ง → สัดส่วนโซน"
  const widestSlice = Math.max(
    0,
    ...slices.map((slice) => (slice ? slice.right - slice.left : 0)),
  );
  if (widestSlice <= 0) return zeros;

  return rowSeatCounts.map((seatCount, rowIndex) => {
    const slice = slices[rowIndex];
    // หน้าตัดว่าง (รูปบางเกินตาข่าย) → ไม่ร่น ดีกว่าเดาผิดข้าง
    if (!slice) return 0;
    const rowWidth = (seatCount / maxSeats) * widestSlice;
    const center = (slice.left + slice.right) / 2;
    const insetInZone = Math.max(center - rowWidth / 2, 0);
    // แปลงจากสัดส่วนกรอบโซน → สัดส่วนความกว้างกริด (ฝั่ง UI คูณ px ของแถวกว้างสุดได้ตรง ๆ)
    return Math.min(insetInZone / widestSlice, MAX_ROW_INSET);
  });
}
