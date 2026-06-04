// ============================================================
// Order Sweeper (F3) — คืนที่นั่งของ order ที่หมดเวลาแต่ไม่จ่าย
// ============================================================
// ปัญหาเดิม: Redis lock หมดอายุเองใน 5 นาที แต่ DB seat ยังเป็น HELD ตลอด
//   → ที่นั่งถูกล็อกตายโดยไม่มีใครจ่ายเงิน (griefing / ที่นั่งหายจากระบบ)
// แก้: หา order ที่ยัง PENDING แต่ expiresAt เลยเวลาแล้ว → ยกเลิก + คืนที่นั่งเป็น AVAILABLE
//
// หมายเหตุสำคัญ (root cause ที่เจอตอนทำ F3):
//   OrderItem.seatId เป็น @unique ระดับ global — ถ้าไม่ลบ OrderItem ตอนยกเลิก
//   ที่นั่งนั้นจะ "จองใหม่ไม่ได้" (สร้าง OrderItem seatId ซ้ำ = unique violation)
//   จึงต้องลบ OrderItem ของ order ที่ยกเลิกด้วย (order ที่ยกเลิกยังไม่มีตั๋ว ลบได้ปลอดภัย)
import { prisma } from "@/lib/prisma";

// pure helper — order นี้ค้างเกินเวลาแล้วควรกวาดทิ้งไหม (แยกไว้ unit-test ได้)
export function isOrderStale(params: {
  status: string;
  expiresAt: Date;
  now?: Date;
}): boolean {
  const now = params.now ?? new Date();
  return params.status === "PENDING" && params.expiresAt.getTime() < now.getTime();
}

// กวาด order ค้าง → คืนที่นั่ง คืนค่าจำนวน order ที่ถูกยกเลิก
// opts.concertId: จำกัดเฉพาะคอนเสิร์ตเดียว (เรียกตอนมีคนกำลังจะจองพอดี — เร็ว + ตรงจุด)
//   ถ้าไม่ใส่ = กวาดทั้งระบบ (เหมาะกับ cron job)
export async function expireStaleOrders(opts?: {
  concertId?: bigint;
  now?: Date;
}): Promise<number> {
  const now = opts?.now ?? new Date();

  // หา order ที่ยัง PENDING แต่หมดเวลาแล้ว พร้อมรายการที่นั่ง
  const stale = await prisma.order.findMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: now },
      ...(opts?.concertId ? { concertId: opts.concertId } : {}),
    },
    select: { id: true, items: { select: { seatId: true } } },
  });
  if (stale.length === 0) return 0;

  const orderIds = stale.map((o) => o.id);
  const seatIds = stale.flatMap((o) => o.items.map((i) => i.seatId));

  // ทำใน transaction เดียว (atomic) — ลำดับสำคัญเพื่อกัน race กับการจ่ายเงินที่อาจเพิ่งสำเร็จ
  await prisma.$transaction([
    // 1) ยกเลิกเฉพาะที่ "ยัง PENDING + หมดเวลาจริง" (กัน order ที่เพิ่งจ่ายสำเร็จระหว่างนั้นโดนยกเลิก)
    prisma.order.updateMany({
      where: { id: { in: orderIds }, status: "PENDING", expiresAt: { lt: now } },
      data: { status: "CANCELLED" },
    }),
    // 2) ลบ OrderItem เฉพาะ order ที่ "เพิ่งถูกยกเลิกในขั้น 1 จริง ๆ" (เห็น write ของขั้นบนใน tx เดียวกัน)
    //    → กันเผลอลบ item ของ order ที่ race ไปเป็น PAID ก่อนหน้า
    prisma.orderItem.deleteMany({
      where: { orderId: { in: orderIds }, order: { status: "CANCELLED" } },
    }),
    // 3) คืนเฉพาะที่นั่งที่ยัง HELD (ไม่แตะ SOLD เผื่อที่นั่งนั้นเพิ่งขายได้)
    prisma.seat.updateMany({
      where: { id: { in: seatIds }, status: "HELD" },
      data: { status: "AVAILABLE" },
    }),
  ]);

  return stale.length;
}
