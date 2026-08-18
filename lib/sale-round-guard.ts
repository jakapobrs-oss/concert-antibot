// ============================================================
// ด่านรอบกดบัตร — ตัวเชื่อมระหว่างฐานข้อมูลกับตรรกะใน lib/sale-round.ts
// ============================================================
// แยกจาก lib/sale-round.ts เพราะไฟล์นั้นตั้งใจให้เป็น pure function ล้วน (เทสง่าย ไม่ต้องมี DB)
// ไฟล์นี้ทำหน้าที่เดียว: ดึงรอบ + สถานะสมาชิก แล้วส่งต่อให้ตัวตัดสิน
//
// 🔴 ต้องเรียกจาก **ทุกจุดที่เป็นประตูเข้าสู่การซื้อ** ไม่ใช่แค่หน้าเว็บ
//    เพราะถ้าเช็คแค่หน้าจอ คนที่ยิง API ตรงจะข้ามด่านได้ทั้งหมด
//    จุดที่ใช้: เข้าคิว (api/queue/join) · หน้าเลือกที่นั่ง · ตอนกดจองจริง (actions/booking)

import { prisma } from "@/lib/prisma";
import { isMembershipActive } from "@/lib/membership";
import { resolveSaleAccess, type SaleAccessVerdict, type SaleRoundLike } from "@/lib/sale-round";

/**
 * ตรวจสิทธิ์เข้ารอบของ user คนนี้กับคอนเสิร์ตนี้ ณ ตอนนี้
 *
 * หมายเหตุ: ไม่เช็ค `Concert.status` ให้ — ผู้เรียกเช็ค ON_SALE เองก่อนเสมอ
 * (รอบเป็นด่านซ้อนทับ ไม่ได้มาแทนสวิตช์เดิม)
 */
export async function checkSaleAccess(
  concertId: bigint,
  userId: bigint | null,
  now: Date = new Date()
): Promise<SaleAccessVerdict> {
  const [rounds, membership] = await Promise.all([
    prisma.saleRound.findMany({
      where: { concertId },
      select: { id: true, name: true, audience: true, startAt: true, endAt: true },
      orderBy: { startAt: "asc" },
    }),
    userId ? prisma.membership.findUnique({ where: { userId } }) : Promise.resolve(null),
  ]);

  const roundsForLogic: SaleRoundLike[] = rounds.map((r) => ({
    id: r.id.toString(),
    name: r.name,
    audience: r.audience,
    startAt: r.startAt,
    endAt: r.endAt,
  }));

  return resolveSaleAccess({
    rounds: roundsForLogic,
    now,
    isMember: isMembershipActive(membership, now),
  });
}

/** ดึงรอบทั้งหมดของคอนเสิร์ต (เรียงตามเวลา) — ใช้แสดงตารางรอบให้ผู้ซื้อดู */
export async function listSaleRounds(concertId: bigint): Promise<SaleRoundLike[]> {
  const rounds = await prisma.saleRound.findMany({
    where: { concertId },
    select: { id: true, name: true, audience: true, startAt: true, endAt: true },
    orderBy: { startAt: "asc" },
  });
  return rounds.map((r) => ({
    id: r.id.toString(),
    name: r.name,
    audience: r.audience,
    startAt: r.startAt,
    endAt: r.endAt,
  }));
}
