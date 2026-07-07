// ============================================================
// Seat availability — นับที่นั่งที่ยัง "ขายได้จริง" ของคอนเสิร์ต
// ============================================================
// แยกจาก lib/queue.ts โดยตั้งใจ: queue.ts เป็น Redis ล้วน (เทสง่าย ไม่ผูก DB)
//   ส่วนการนับที่นั่งเป็นเรื่อง DB — route/admin เป็นคนดึงค่านี้แล้วป้อนให้ admitNext เป็น seatsLeft
//   → capacity-aware admission ไม่ปล่อยคิวเกินจำนวนที่นั่งที่เหลือจริง
import { prisma } from "@/lib/prisma";

// นับ Seat ที่ status=AVAILABLE ของทั้งคอนเสิร์ต
//   path: Concert → Zone(concertId) → Seat(zoneId, status) — มี index [zoneId, status] รองรับ
//   concertId เป็น string (มาจาก queue token meta) → แปลงเป็น BigInt ให้ตรงชนิด PK
export async function countAvailableSeats(concertId: string): Promise<number> {
  return prisma.seat.count({
    where: { status: "AVAILABLE", zone: { concertId: BigInt(concertId) } },
  });
}
