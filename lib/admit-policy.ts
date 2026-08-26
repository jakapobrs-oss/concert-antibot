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

// ============================================================
// Sliding admit window — "ต่ออายุสิทธิ์เลือกที่นั่งได้ถึงเมื่อไหร่"
// ============================================================
// ที่มา: ผังสนามจริงมีหลายสิบโซน ผู้ใช้เลือกเกิน 5 นาทีแล้วโดนตัดสิทธิ์กลางมือ
// นโยบาย: ทุกครั้งที่ผู้ใช้ "ยังใช้งานอยู่จริง" (โหลดหน้าเลือกที่นั่ง/เปิดดูโซน)
//   ต่ออายุออกไปอีก 1 ช่วง TTL แต่รวมแล้วไม่เกินเพดานแข็งนับจากตอนถูกปล่อยเข้า
//   → คนใช้งานจริงไม่โดนเด้งกลางทาง / คนแช่ token ทิ้งไว้ยังหลุดตามเดิม
//   → ไม่มีใครครองห้องเลือกที่นั่งเกินเพดานได้ ไม่ว่าจะกดถี่แค่ไหน (คิวยังไหล)
export function computeAdmitExtension(params: {
  now: number; // เวลาปัจจุบัน (epoch ms)
  currentExpireAt: number; // เวลาหมดอายุปัจจุบันใน admitted set
  admittedAt: number | null; // เวลาที่ถูกปล่อยเข้า — null = token รุ่นเก่าที่ไม่มีค่านี้
  ttlMs: number; // ความยาวการต่อ 1 ครั้ง (= ADMIT_TTL)
  hardCapMs: number; // เพดานแข็งรวม นับจาก admittedAt
}): number {
  const { now, currentExpireAt, admittedAt, ttlMs, hardCapMs } = params;
  // token รุ่นเก่าไม่รู้เวลาเริ่ม → คำนวณเพดานไม่ได้ ไม่ต่อ (ปลอดภัยไว้ก่อน)
  if (admittedAt === null) return currentExpireAt;
  const ideal = now + ttlMs;
  const cap = admittedAt + hardCapMs;
  // ห้าม "หด" เวลาที่ถืออยู่แล้ว และห้ามทะลุเพดานแข็ง
  return Math.max(currentExpireAt, Math.min(ideal, cap));
}

// ============================================================
// ที่นั่งของคอนเสิร์ตจากมุมคนในคิว — "คิวนี้ยังมีทางไปต่อไหม"
// ============================================================
// นิยามเดียวกับ docs/23 (เดิมอยู่ใน lib/sold-out.ts ซึ่ง import prisma) — ย้ายมาไฟล์ pure
//   เพราะ lib/queue.ts ต้องตัดสิน SOLD_OUT / เต็มชั่วคราว จาก snapshot ใน Redis โดยไม่ลาก DB เข้าโมดูลคิว
//   available = ที่นั่ง AVAILABLE (เลือกได้ตอนนี้)
//   held      = ที่นั่ง HELD (คนอื่นอยู่หน้าจ่ายเงิน อีกไม่กี่นาทีอาจหลุดกลับมา)
export type SeatSnapshot = { available: number; held: number };

// บัตรหมดจริงไหม — ต้องไม่เหลือทั้งที่นั่งว่างและที่นั่งที่ค้างจ่าย
//   (ประกาศหมดตอนว่าง 0 เฉย ๆ แล้ว hold หลุดกลับมา = โกหกผู้ใช้)
export function isSoldOut(params: SeatSnapshot): boolean {
  return params.available <= 0 && params.held <= 0;
}

// "ตอนนี้ยังเลือกที่นั่งไม่ได้" แต่ยังไม่ถือว่าหมด (มี hold ค้างที่อาจหลุดกลับมา)
//   ใช้บอกผู้ใช้ให้รอ แทนที่จะไล่กลับด้วยคำว่าบัตรหมด
export function isTemporarilyFull(params: SeatSnapshot): boolean {
  return params.available <= 0 && params.held > 0;
}
