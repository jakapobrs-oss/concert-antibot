// นโยบาย "ผู้ถือบัตร" (named ticket, docs/19) — pure helpers แยกไว้ unit test ได้
// หลักคิด: commit ผู้ถือตั้งแต่ตอนซื้อ (ตอนนั้น scalper ยังไม่มีลูกค้าให้ใส่ชื่อ)

// อายุบัญชีขั้นต่ำของผู้ถือที่ไม่ใช่ผู้ซื้อ — กัน scalper ให้ลูกค้า "สมัครบัญชีใหม่" มารับบัตร
// (บัญชีเก่าแปลว่ามีตัวตนมาก่อนดีลซื้อขาย — costly signal ที่ปั๊มยาก)
export function isHolderAccountOldEnough(params: {
  createdAt: Date;
  minDays: number;
  now?: Date;
}): boolean {
  if (params.minDays <= 0) return true; // 0 = ปิดเช็ค
  const now = params.now ?? new Date();
  const ageMs = now.getTime() - params.createdAt.getTime();
  return ageMs >= params.minDays * 24 * 60 * 60 * 1000;
}

// เพดาน "รับบัตร" ฝั่งผู้ถือต่อคอนเสิร์ต (นับข้ามทุกผู้ซื้อ) —
// กันขบวนการกระจายกันซื้อหลายบัญชีแล้วตั้งผู้ถือเป็นคนเดียว (จุดที่ per-buyer limit มองไม่เห็น)
export function exceedsHolderCap(params: {
  committed: number; // ตั๋วที่ถืออยู่แล้ว + ที่นั่งใน order ค้างจ่ายที่ตั้งชื่อคนนี้ไว้
  requested: number;
  limit: number; // ใช้ maxTicketsPerUser ของคอนเสิร์ตเดียวกัน (0/ติดลบ = ปิด)
}): boolean {
  if (params.limit <= 0) return false;
  return params.committed + params.requested > params.limit;
}
