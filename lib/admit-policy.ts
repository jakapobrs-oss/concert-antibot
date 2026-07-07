// ============================================================
// Admission policy — "ปล่อยคิวได้กี่คนรอบนี้" (capacity-aware)
// ============================================================
// แยกเป็นไฟล์ pure ไม่ import อะไรที่มี side-effect (ไม่แตะ Redis/DB)
//   → เทส logic ความจุได้โดยตรงโดยไม่ต้องเปิด Redis/Docker (ดู tests/unit/admit-capacity.test.ts)
//   lib/queue.ts (admitNext) เป็นคนดึงค่า inside จาก Redis จริงแล้วเรียกฟังก์ชันนี้

// คำนวณจำนวนที่ปล่อยได้รอบนี้ = min( batchSize, cap − inside, seatsLeft ) แล้ว clamp ที่ 0
//   - batchSize: เพดานต่อรอบ (ปล่อยรวดเดียวไม่เกินนี้)
//   - cap: ความจุห้องเลือกที่นั่ง — undefined = ไม่จำกัดด้วยความจุ (เช่นเทสคิวล้วน)
//   - inside: คนที่ยังเลือกที่นั่งอยู่ตอนนี้ (นับจาก admitted set หลัง prune ghost)
//   - seatsLeft: ที่นั่ง AVAILABLE ที่เหลือ — undefined = ไม่จำกัดด้วยที่นั่ง
// clamp 0: ถ้า inside ล้น cap (เคย over-admit มาก่อน) จะได้ 0 ไม่ใช่ค่าติดลบ (ไม่ปล่อยเพิ่ม)
export function computeAdmitLimit(
  batchSize: number,
  opts: { cap?: number; inside?: number; seatsLeft?: number }
): number {
  let limit = batchSize;
  if (opts.cap !== undefined) limit = Math.min(limit, opts.cap - (opts.inside ?? 0));
  if (opts.seatsLeft !== undefined) limit = Math.min(limit, opts.seatsLeft);
  return Math.max(0, limit);
}
