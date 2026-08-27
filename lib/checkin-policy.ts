// ============================================================
// กติกาขอบเขตการเช็คอิน (pure) — จุดสแกนต้อง "ผูกกับคอนเสิร์ต" และอยู่ในกรอบเวลาของงาน (rev 42)
// ============================================================
// ที่มา (audit rev 42, High): checkInTicket เดิมตรวจแค่ "ตั๋วใบนี้จริงและสด" ไม่ได้ตรวจว่า "ตั๋วของงานนี้"
//   → ตั๋ว ฿1 ของคอนทดสอบ (หรือตั๋วคอนที่จบไปแล้ว) สแกนที่ประตูคอนราคาเต็มแล้วขึ้นเขียว "ให้เข้างานได้"
//   เหลือแค่สายตา จนท. อ่านชื่อคอนบรรทัดเล็ก — ยิ่ง rev 42 ให้กล้อง auto-submit ยิ่งพลาดง่าย
// กติกา:
//   1. ตั๋วต้องเป็นของคอนเสิร์ตที่จุดสแกนเลือกไว้ (concertId ตรงกัน)
//   2. เวลาสแกนต้องอยู่ใน [eventAt − openBefore, eventAt + closeAfter] — กันตั๋วงานที่ยังไม่ถึง/จบไปแล้ว
//      แม้ concertId จะตรง (เช่น จนท. เลือกงานผิดวัน)
//   ต้องตัดสิน "ก่อน" claim (updateMany) เสมอ — สแกนผิดประตูต้องไม่เผาตั๋ว
export type CheckInScopeDecision =
  | { ok: true }
  | { ok: false; kind: "wrong_concert" | "too_early" | "too_late"; error: string };

const HOUR_MS = 60 * 60 * 1000;

function hoursLabel(ms: number): string {
  const h = ms / HOUR_MS;
  return Number.isInteger(h) ? `${h}` : h.toFixed(1);
}

export function decideCheckInScope(p: {
  ticketConcertId: string;
  ticketConcertTitle: string;
  gateConcertId: string;
  gateConcertTitle: string;
  eventAt: Date;
  now: Date;
  openBeforeMs: number;
  closeAfterMs: number;
}): CheckInScopeDecision {
  if (p.ticketConcertId !== p.gateConcertId) {
    return {
      ok: false,
      kind: "wrong_concert",
      error: `ตั๋วใบนี้เป็นของ "${p.ticketConcertTitle}" ไม่ใช่ "${p.gateConcertTitle}" — ห้ามให้เข้า`,
    };
  }
  const t = p.now.getTime();
  const start = p.eventAt.getTime();
  if (t < start - p.openBeforeMs) {
    return {
      ok: false,
      kind: "too_early",
      error: `ยังไม่ถึงเวลาเปิดสแกนของ "${p.gateConcertTitle}" — เปิดได้ตั้งแต่ ${hoursLabel(p.openBeforeMs)} ชม. ก่อนเวลาแสดง`,
    };
  }
  if (t > start + p.closeAfterMs) {
    return {
      ok: false,
      kind: "too_late",
      error: `เลยเวลาเช็คอินของ "${p.gateConcertTitle}" แล้ว — ปิดสแกน ${hoursLabel(p.closeAfterMs)} ชม. หลังเวลาแสดง`,
    };
  }
  return { ok: true };
}

// คอนเสิร์ตที่ควรโผล่ให้เลือกที่จุดสแกน: ยังไม่เลยกรอบปิดสแกน (งานที่จบไปนานแล้วไม่ต้องโชว์ให้เลือกผิด)
export function isConcertSelectableAtGate(p: { eventAt: Date; now: Date; closeAfterMs: number }): boolean {
  return p.now.getTime() <= p.eventAt.getTime() + p.closeAfterMs;
}
