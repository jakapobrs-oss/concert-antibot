// ============================================================
// Ticket Limit (F2) — ลิมิตจำนวนตั๋วต่อ user ต่อคอนเสิร์ต (นับยอดรวม)
// ============================================================
// ปัญหาเดิม: ระบบเช็คแค่จำนวนที่นั่งใน "order เดียว" ที่กำลังจะจอง
//   → user เข้าคิวใหม่แล้วสั่งซื้อซ้ำได้เรื่อย ๆ = กักตุน/scalp (ขัด fairness)
// แก้: นับ "ที่นั่งที่ผูกพันอยู่แล้ว" (ตั๋วที่จ่ายแล้ว + order ที่ค้างจ่ายและยังไม่หมดอายุ)
//   มารวมกับจำนวนที่กำลังจะจองเพิ่ม ต้องไม่เกินเพดานต่อคน

export interface TicketLimitInput {
  // จำนวนที่นั่งที่ user ถือ/ผูกพันอยู่แล้วในคอนเสิร์ตนี้ (PAID + PENDING ที่ยัง active)
  committed: number;
  // จำนวนที่นั่งที่กำลังจะจองเพิ่มในรอบนี้
  requested: number;
  // เพดานต่อ user ของคอนเสิร์ต (concert.maxTicketsPerUser)
  max: number;
}

// ยอดรวมหลังจองรอบนี้จะเกินเพดานไหม
export function exceedsTicketLimit({ committed, requested, max }: TicketLimitInput): boolean {
  return committed + requested > max;
}

// เหลือสิทธิ์จองได้อีกกี่ที่นั่ง (ไม่ติดลบ — เผื่อ committed เกิน max จากข้อมูลเก่า)
export function remainingTicketAllowance({ committed, max }: { committed: number; max: number }): number {
  return Math.max(0, max - committed);
}
