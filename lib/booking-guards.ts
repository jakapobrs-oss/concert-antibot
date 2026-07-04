// Guard queries ของขั้นตอนจอง — แยกจาก server action เพื่อเขียน integration test ได้ตรงๆ
// (booking.ts ต้อง mock auth/queue ถึงจะเรียกได้ — ที่นี่รับ db client ตรงๆ แบบเดียวกับ order-finalize)
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

// ดึงที่นั่งตาม id โดย "บังคับว่าเป็นของคอนเสิร์ตที่กำลังจองเท่านั้น"
// จุดที่แก้ (Codex #2): ของเดิมดึงตาม seatIds ที่ client ส่งมาโดยไม่เช็ค zone.concertId
//   → เข้าคิวคอนเสิร์ต A แล้วส่ง seatIds ของคอนเสิร์ต B มาจองได้ (ข้ามคิว/ลิมิตของ B)
// ที่นั่งข้ามคอนเสิร์ตจะถูกกรองทิ้ง → caller เช็ค length !== seatIds.length แล้วปฏิเสธ
export async function findSeatsInConcert(db: Db, seatIds: bigint[], concertId: bigint) {
  return db.seat.findMany({
    where: { id: { in: seatIds }, zone: { concertId } },
    include: { zone: { select: { price: true } } },
  });
}
