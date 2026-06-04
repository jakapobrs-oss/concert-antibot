// ============================================================
// Admin Stats Service (Phase 8)
// ============================================================
// รวม query สถิติทั้งหมดจากข้อมูลที่เก็บไว้ทุก phase
// ใช้ทั้ง admin dashboard + เป็นวัตถุดิบ thesis evaluation
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

// ภาพรวมระบบ
export async function getOverviewStats() {
  const [concertCount, onSaleCount, userCount, paidOrders, totalTickets, botStats] =
    await Promise.all([
      prisma.concert.count(),
      prisma.concert.count({ where: { status: "ON_SALE" } }),
      prisma.user.count({ where: { role: "USER" } }),
      prisma.order.count({ where: { status: "PAID" } }),
      prisma.ticket.count(),
      // bot events แยกตาม action
      prisma.botEvent.groupBy({ by: ["action"], _count: true }),
    ]);

  // รายได้รวม (sum ของ order ที่ PAID)
  const revenue = await prisma.order.aggregate({
    where: { status: "PAID" },
    _sum: { totalAmount: true },
  });

  // map bot action counts
  const botCounts = { ALLOW: 0, CHALLENGE: 0, BLOCK: 0 };
  for (const b of botStats) {
    botCounts[b.action as keyof typeof botCounts] = b._count;
  }
  const totalBotChecks = botCounts.ALLOW + botCounts.CHALLENGE + botCounts.BLOCK;

  return {
    concertCount,
    onSaleCount,
    userCount,
    paidOrders,
    totalTickets,
    revenue: Number(revenue._sum.totalAmount?.toString() ?? 0),
    bot: {
      ...botCounts,
      total: totalBotChecks,
      // % ที่ถูก block/challenge — metric สำหรับ thesis
      blockRate: totalBotChecks > 0 ? (botCounts.BLOCK / totalBotChecks) * 100 : 0,
      challengeRate: totalBotChecks > 0 ? (botCounts.CHALLENGE / totalBotChecks) * 100 : 0,
    },
  };
}

// bot events ล่าสุด (สำหรับ log viewer) + filter ตาม action
export async function getBotEvents(params: {
  action?: "ALLOW" | "CHALLENGE" | "BLOCK";
  limit?: number;
}) {
  const events = await prisma.botEvent.findMany({
    where: params.action ? { action: params.action } : {},
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 50,
  });
  // serialize BigInt
  return events.map((e) => ({
    id: e.id.toString(),
    ip: e.ip,
    userAgent: e.userAgent,
    score: e.score,
    action: e.action,
    signals: e.signals,
    checkpoint: e.checkpoint,
    createdAt: e.createdAt.toISOString(),
  }));
}

// behavior sessions ที่น่าจะเป็นบอท (สำหรับ thesis — human vs bot dataset)
export async function getBehaviorStats() {
  const [total, likelyBot, avgHuman, avgBot] = await Promise.all([
    prisma.behaviorSession.count(),
    prisma.behaviorSession.count({ where: { isLikelyBot: true } }),
    // ค่าเฉลี่ย feature ของกลุ่ม human (isLikelyBot=false)
    prisma.behaviorSession.aggregate({
      where: { isLikelyBot: false },
      _avg: { mousePathEntropy: true, mouseTimingVariance: true, dwellTimeMs: true },
    }),
    prisma.behaviorSession.aggregate({
      where: { isLikelyBot: true },
      _avg: { mousePathEntropy: true, mouseTimingVariance: true, dwellTimeMs: true },
    }),
  ]);

  return {
    total,
    likelyBot,
    human: total - likelyBot,
    avgHuman: {
      entropy: avgHuman._avg.mousePathEntropy ?? 0,
      variance: avgHuman._avg.mouseTimingVariance ?? 0,
      dwellMs: avgHuman._avg.dwellTimeMs ?? 0,
    },
    avgBot: {
      entropy: avgBot._avg.mousePathEntropy ?? 0,
      variance: avgBot._avg.mouseTimingVariance ?? 0,
      dwellMs: avgBot._avg.dwellTimeMs ?? 0,
    },
  };
}

// ยอดขายต่อคอนเสิร์ต (sales report)
export async function getSalesReport() {
  const concerts = await prisma.concert.findMany({
    select: {
      id: true,
      title: true,
      status: true,
      _count: { select: { orders: { where: { status: "PAID" } } } },
      zones: {
        select: {
          totalSeats: true,
          _count: { select: { seats: { where: { status: "SOLD" } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // คำนวณ revenue ต่อ concert
  const result = await Promise.all(
    concerts.map(async (c) => {
      const rev = await prisma.order.aggregate({
        where: { concertId: c.id, status: "PAID" },
        _sum: { totalAmount: true },
      });
      const totalSeats = c.zones.reduce((s, z) => s + z.totalSeats, 0);
      const soldSeats = c.zones.reduce((s, z) => s + z._count.seats, 0);
      return {
        id: c.id.toString(),
        title: c.title,
        status: c.status,
        paidOrders: c._count.orders,
        revenue: Number(rev._sum.totalAmount?.toString() ?? 0),
        totalSeats,
        soldSeats,
        soldRate: totalSeats > 0 ? (soldSeats / totalSeats) * 100 : 0,
      };
    })
  );
  return result;
}

// queue stats real-time จาก Redis (ทุกคอนเสิร์ตที่ ON_SALE)
export async function getLiveQueueStats() {
  const concerts = await prisma.concert.findMany({
    where: { status: "ON_SALE" },
    select: { id: true, title: true },
  });

  return Promise.all(
    concerts.map(async (c) => {
      const cid = c.id.toString();
      const [waiting, admitted] = await Promise.all([
        redis.zcard(`queue:${cid}`),
        redis.zcard(`queue:${cid}:admitted`),
      ]);
      return { id: cid, title: c.title, waiting, admitted };
    })
  );
}
