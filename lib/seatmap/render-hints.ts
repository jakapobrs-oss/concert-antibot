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

import type { StageSide } from "@/lib/seatmap/polygon";

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
