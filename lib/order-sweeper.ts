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

// กวาด order ค้าง → คืนที่นั่ง คืนค่าจำนวน order ที่ถูกยกเลิกจริง
// opts.concertId: จำกัดเฉพาะคอนเสิร์ตเดียว (เรียกตอนมีคนกำลังจะจองพอดี — เร็ว + ตรงจุด)
//   ถ้าไม่ใส่ = กวาดทั้งระบบ (เหมาะกับ cron job)
export async function expireStaleOrders(opts?: {
  concertId?: bigint;
  now?: Date;
}): Promise<number> {
  const now = opts?.now ?? new Date();

  // หา "รายชื่อ order ที่อาจต้องกวาด" (candidate) — เอาแค่ id มา loop
  // ⚠️ Codex #4: ตั้งใจ "ไม่" snapshot seatIds ตรงนี้ (นอก transaction) — ที่นั่งจะถูกอ่าน
  //    ภายใน tx "หลัง claim" แทน. เดิมอ่าน seatIds นอก tx แล้วเอามาปล่อยในขั้นคืนที่นั่ง:
  //    ถ้าที่นั่งนั้นถูก order ใหม่จองทับ (re-book) ระหว่าง snapshot กับตอนปล่อย → เผลอปล่อย
  //    ที่นั่งของ order ใหม่ที่กำลังจะจ่ายเงิน = ขายซ้ำ/เสียเงิน (โดยเฉพาะเมื่อมี sweeper 2 ตัว
  //    เช่น cron + on-read ยิงพร้อมกัน)
  const candidates = await prisma.order.findMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: now },
      ...(opts?.concertId ? { concertId: opts.concertId } : {}),
    },
    select: { id: true },
  });
  if (candidates.length === 0) return 0;

  // กวาดทีละ order ใน interactive transaction (pattern เดียวกับ cancelPendingOrder / N3)
  //   claim ก่อน → อ่านที่นั่ง "ใน tx หลัง claim" → ลบ OrderItem → คืนที่นั่งที่ยัง HELD
  //   ที่นั่งที่อ่านได้จึงเป็นของ order ที่ "เพิ่งถูกยกเลิกในรอบนี้จริง" ไม่ใช่ของ order อื่นที่ race มา
  let cancelled = 0;
  for (const { id: orderId } of candidates) {
    const ok = await prisma.$transaction(async (tx) => {
      // 1) claim: ยกเลิกเฉพาะที่ยัง PENDING + หมดเวลาจริง
      //    (กัน order ที่เพิ่งจ่ายสำเร็จ หรือถูก sweeper ตัวอื่นกวาดไปแล้ว → count===0 = ข้าม)
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: "PENDING", expiresAt: { lt: now } },
        data: { status: "CANCELLED" },
      });
      if (claimed.count === 0) return false;

      // 2) อ่านที่นั่งของ order นี้ (หลัง claim สำเร็จ) แล้วลบ OrderItem
      //    OrderItem.seatId เป็น @unique global → ต้องลบเพื่อให้ที่นั่งจองใหม่ได้
      //    (order ที่ยกเลิกยังไม่มีตั๋ว ลบได้ปลอดภัย)
      const items = await tx.orderItem.findMany({
        where: { orderId },
        select: { seatId: true },
      });
      const seatIds = items.map((i) => i.seatId);
      await tx.orderItem.deleteMany({ where: { orderId } });

      // 3) คืนเฉพาะที่นั่งที่ยัง HELD (ไม่แตะ SOLD เผื่อที่นั่งนั้นเพิ่งขายได้)
      //    ปลอดภัยจาก re-book: ตราบใด tx นี้ยังไม่ commit ที่นั่งยังผูกกับ item ที่เพิ่งลบด้านบน
      //    (unique seatId บล็อก order อื่นสร้าง item ที่นั่งนี้จน tx เรา commit) → HELD ที่เห็น = ของ order นี้เท่านั้น
      if (seatIds.length > 0) {
        await tx.seat.updateMany({
          where: { id: { in: seatIds }, status: "HELD" },
          data: { status: "AVAILABLE" },
        });
      }
      return true;
    });
    if (ok) cancelled++;
  }

  return cancelled;
}
