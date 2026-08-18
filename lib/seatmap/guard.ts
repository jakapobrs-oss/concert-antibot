// ============================================================
// Seat Map Regenerate Guard — กันเจนที่นั่งทับของที่มีภาระผูกพันแล้ว
// ============================================================
// 🔴 นี่คือจุดอันตรายที่สุดของฟีเจอร์ผังที่นั่ง เพราะ "เจนใหม่" = ลบที่นั่งเดิมทิ้งแล้วสร้างใหม่
//    ถ้าปล่อยให้ทำทับโซนที่ขายไปแล้ว = ตั๋วที่ลูกค้าจ่ายเงินจริงชี้ไปยังที่นั่งที่ไม่มีอยู่
//
// เขียนเป็น pure function (รับแค่ "สภาพที่นั่ง" ไม่แตะ DB เอง)
//   -> ฝั่ง server action ค่อย query สภาพจริงมาป้อน แล้วเทสตัว logic ตรง ๆ ได้

export type SeatStatusLike = "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED";

export interface ExistingSeatState {
  status: SeatStatusLike;
  /** ยังถูกอ้างจาก order ที่ยังไม่ปิด — ลบที่นั่งจะชน foreign key */
  hasOrderItem?: boolean;
  /** ยังถูกอ้างจากตั๋ว (รวมตั๋วที่ถูกคืนแล้ว เพราะ FK ยังผูกอยู่) */
  hasTicket?: boolean;
}

export type RegenerateVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      blocked: { sold: number; held: number; linked: number };
    };

/**
 * ตัดสินว่าเจนที่นั่งใหม่ทับโซนนี้ได้ไหม
 *
 * ปฏิเสธเมื่อมีที่นั่งที่: ขายแล้ว (SOLD) / กำลังถูกจองค้าง (HELD) / ยังมีตั๋วหรือ order ผูกอยู่
 * อนุญาตเมื่อ: โซนยังว่าง หรือมีแต่ที่นั่ง AVAILABLE / BLOCKED
 *   หมายเหตุ: BLOCKED (แอดมินปิดที่นั่งเอง) ไม่ใช่ภาระผูกพัน — เจนทับได้ แต่สถานะปิดจะหายไปด้วย
 */
export function canRegenerateZoneSeats(seats: ExistingSeatState[]): RegenerateVerdict {
  let sold = 0;
  let held = 0;
  let linked = 0;

  for (const seat of seats) {
    if (seat.status === "SOLD") sold++;
    else if (seat.status === "HELD") held++;
    else if (seat.hasTicket || seat.hasOrderItem) linked++;
  }

  if (sold === 0 && held === 0 && linked === 0) return { allowed: true };

  const parts: string[] = [];
  if (sold > 0) parts.push(`ขายไปแล้ว ${sold} ที่`);
  if (held > 0) parts.push(`กำลังถูกจองค้าง ${held} ที่`);
  if (linked > 0) parts.push(`ยังมีตั๋ว/คำสั่งซื้อผูกอยู่ ${linked} ที่`);

  return {
    allowed: false,
    reason: `เจนที่นั่งใหม่ทับโซนนี้ไม่ได้ — ${parts.join(", ")} (ต้องคืน/ยกเลิกให้หมดก่อน)`,
    blocked: { sold, held, linked },
  };
}
