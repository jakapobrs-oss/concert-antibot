"use server";

// ============================================================
// Booking Server Actions (Phase 7)
// ============================================================
// flow: holdAndCreateOrder → (แสดง QR) → submitSlip → (verify) → issue tickets
import { z } from "zod";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyOrderPaid } from "@/lib/order-notify";
import {
  finalizePaidOrder,
  cancelPendingOrder,
  recordRefundRequired,
  findPaidOrderBySlip,
  reserveSeatsForOrder,
} from "@/lib/order-finalize";
import { computePayerKey } from "@/lib/payer-key";
import { sameAmount } from "@/lib/money";
import { auth } from "@/lib/auth";
import { holdSeats, releaseSeats } from "@/lib/seat-hold";
import { findSeatsInConcert } from "@/lib/booking-guards";
import { isAdmitted, releaseAdmittedByUser } from "@/lib/queue";
import { generatePromptPayQR } from "@/lib/promptpay";
import { verifySlip } from "@/lib/slip-verify";
import { isSlipFresh } from "@/lib/slip-freshness";
import { MAX_SLIP_BASE64_LEN, isLikelyBase64Image } from "@/lib/slip-image";
import { checkRateLimit } from "@/lib/rate-limit";
import { exceedsTicketLimit, remainingTicketAllowance } from "@/lib/ticket-limit";
import { resolveEntryForUser, effectiveTicketLimit, entryDenyMessage } from "@/lib/sale-round";
import { isHolderAccountOldEnough, exceedsHolderCap } from "@/lib/holder-policy";
import { expireStaleOrders } from "@/lib/order-sweeper";
import { env } from "@/lib/env";
import { pickBestSeats } from "@/lib/seatmap/best-available";
import { assessPurchase, RECENT_BLOCK_WINDOW_MS } from "@/lib/antibot-purchase";
import { headers } from "next/headers";
import { clientIpFromXff } from "@/lib/get-ip";

// F1: rate limit ของ submitSlip — กันยิงสลิปรัวเผาโควต้า EasySlip (500/เดือน) + brute-force สลิป
// key ผูก userId ทั้งคู่ เพื่อกัน attacker เอา orderId ของเหยื่อมา spam ล็อกไม่ให้เหยื่อจ่าย
const SLIP_RL_ORDER = { limit: 5, windowMs: 10 * 60_000 }; // 5 ครั้ง/order/user ใน 10 นาที
const SLIP_RL_USER = { limit: 20, windowMs: 60 * 60_000 }; // 20 ครั้ง/user ใน 1 ชั่วโมง

// Codex #3: ยืดอายุ order ให้พ้นช่วงรอ EasySlip (หลายวินาที) — กันหมดอายุกลางทางระหว่าง verify
const VERIFY_LEASE_MS = 90_000;

// ---- 1. Hold ที่นั่ง + สร้าง Order (pending) ----
const holdSchema = z.object({
  concertId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1).max(10),
  queueToken: z.string().min(1), // ต้องผ่านคิว
  // token จาก Turnstile — มีเฉพาะรอบที่ผู้ใช้เพิ่งทำ challenge หลังโดนด่าน anti-bot เด้ง
  // cap ความยาวไว้กันยัด payload ยักษ์เข้ามาให้ verifyTurnstile ไปยิงต่อ
  turnstileToken: z.string().max(2048).optional(),
});

export type HoldResult =
  | { ok: true; orderId: string; amount: number; qrDataUrl: string; promptPayId: string; expiresAt: string }
  // challenge: true = ยังไม่ปฏิเสธถาวร แค่ขอให้ทำ Turnstile แล้วกดใหม่ (ฝั่ง UI โชว์ widget)
  // pendingOrder: user มี order ค้างชำระที่ยังไม่หมดอายุ — UI ใช้โชว์ปุ่ม "ไปชำระเงินต่อ"
  | {
      ok: false;
      error: string;
      failedSeats?: string[];
      challenge?: true;
      pendingOrder?: { orderId: string };
    };

// ============================================================
// 🛡️ ด่าน anti-bot ตอนกดซื้อ (SECURITY_TODO #1)
// ============================================================
// วางไว้ใน holdAndCreateOrder จุดเดียว เพราะ holdStandingZone / holdBestAvailable
// ต่อท่อเข้ามาที่ฟังก์ชันนี้ทั้งคู่ = choke point เดียวของเส้นทางเงิน
// (ยอมให้ retry loop ของสองตัวนั้นเรียกซ้ำได้ไม่เกิน 3 ครั้ง — แลกกับการไม่ต้องรื้อโค้ดเงิน
//  เป็นฟังก์ชันภายใน ซึ่งเสี่ยงกว่าค่าอ่าน DB ที่ประหยัดได้)
//
// ⚠️ ห้ามทำเป็นพารามิเตอร์ "ข้ามด่าน" ส่งต่อกันเอง — server action ถูกเรียกจาก client
//    ด้วยอาร์กิวเมนต์อะไรก็ได้ ธงข้ามด่านใด ๆ จะกลายเป็นช่องให้บอทปิดด่านนี้เอง
async function assessPurchaseForUser(params: {
  userId: string;
  turnstileToken?: string;
}): Promise<{ blocked: boolean; challenge: boolean; message: string }> {
  const hdrs = await headers();
  const ip = clientIpFromXff(hdrs.get("x-forwarded-for"));
  const since = new Date(Date.now() - RECENT_BLOCK_WINDOW_MS);

  // อ่านสัญญาณจาก DB (index [userId, createdAt] ทั้งสองตาราง — ดู migration 20260824190000)
  const [recentBlock, behavior] = await Promise.all([
    prisma.botEvent.findFirst({
      where: { userId: BigInt(params.userId), action: "BLOCK", createdAt: { gte: since } },
      select: { id: true },
    }),
    prisma.behaviorSession.findFirst({
      where: { userId: BigInt(params.userId), isLikelyBot: true, createdAt: { gte: since } },
      select: { id: true },
    }),
  ]);

  const assessment = await assessPurchase({
    userAgent: hdrs.get("user-agent"),
    headers: hdrs,
    turnstileToken: params.turnstileToken,
    ip,
    behaviorLikelyBot: !!behavior,
    hasRecentBlock: !!recentBlock,
  });

  // บันทึก audit ทุกครั้ง (dashboard + สถิติในเล่ม) — ห้ามให้ audit ล้มแล้วบล็อกการซื้อ
  try {
    await prisma.botEvent.create({
      data: {
        userId: BigInt(params.userId),
        ip: ip ?? null,
        userAgent: hdrs.get("user-agent"),
        fingerprintHash: null,
        score: assessment.score,
        action: assessment.action,
        signals: { ...assessment.signals },
        checkpoint: "purchase",
      },
    });
  } catch {
    // เงียบไว้ — audit ไม่ใช่เส้นทางวิกฤต
  }

  return {
    blocked: assessment.action === "BLOCK",
    challenge: assessment.action === "CHALLENGE",
    message:
      assessment.action === "BLOCK"
        ? "ระบบตรวจพบกิจกรรมที่ผิดปกติ ไม่สามารถทำรายการได้"
        : "กรุณายืนยันว่าคุณไม่ใช่บอทก่อนทำรายการ",
  };
}

// หา order ค้างชำระ (PENDING ยังไม่หมดอายุ) ของ user ในคอนเสิร์ตนี้
// ใช้ชี้ทาง "ไปชำระเงินต่อ" ตอนคิวหมดอายุ/โควตาเต็ม — ผู้ใช้มักคิดว่าที่นั่งหลุดไปแล้ว
// ทั้งที่ order เดิมยังล็อกที่นั่งอยู่ (เคสจริง: กด back จากหน้าชำระเงินแล้วคิวหมดพอดี)
async function findActivePendingOrder(
  userId: string,
  concertId: string,
): Promise<{ orderId: string } | undefined> {
  const order = await prisma.order.findFirst({
    where: {
      userId: BigInt(userId),
      concertId: BigInt(concertId),
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return order ? { orderId: order.id.toString() } : undefined;
}

export async function holdAndCreateOrder(input: {
  concertId: string;
  seatIds: string[];
  queueToken: string;
  turnstileToken?: string;
}): Promise<HoldResult> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบก่อนจองตั๋ว" };

  const parsed = holdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };

  const { concertId, seatIds, queueToken, turnstileToken } = parsed.data;

  // 🔒 gate: ต้องมี queue token ที่ถูก admit (กันข้ามคิว)
  // F4: ส่ง userId ไปด้วย → token ต้องเป็นของ user คนนี้จริง (กันแชร์/ใช้ token คนอื่น)
  const admitted = await isAdmitted(queueToken, concertId, userId);
  if (!admitted) {
    // คิวหมด แต่ order เดิมอาจยังล็อกที่นั่งอยู่ — บอกทางกลับไปจ่ายแทนทางตัน "เข้าคิวใหม่"
    const pendingOrder = await findActivePendingOrder(userId, concertId);
    if (pendingOrder) {
      return {
        ok: false,
        error:
          "คิวหมดอายุ แต่คำสั่งซื้อเดิมของคุณยังอยู่ — ไปชำระเงินต่อได้เลย ไม่ต้องเข้าคิวใหม่",
        pendingOrder,
      };
    }
    return { ok: false, error: "คิวหมดอายุ กรุณาเข้าคิวใหม่" };
  }

  // 🛡️ ด่าน anti-bot ตอนกดซื้อ (SECURITY_TODO #1) — วางหลังด่านคิวเพราะด่านคิวเป็น Redis
  //    ราคาถูกกว่า และคัดคำขอที่ไม่มี token ที่ถูก admit ออกไปก่อนแล้ว
  //    วางก่อนแตะที่นั่ง/สร้าง order เพราะไม่ควรให้บอทได้ยึดที่นั่งไว้ระหว่างถูกตรวจ
  const botGate = await assessPurchaseForUser({ userId, turnstileToken });
  if (botGate.blocked) return { ok: false, error: botGate.message };
  if (botGate.challenge) return { ok: false, error: botGate.message, challenge: true };

  // ตรวจ max ตั๋วต่อ user + ที่นั่งยัง AVAILABLE จริงใน DB
  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(concertId) },
    select: { maxTicketsPerUser: true, status: true },
  });
  if (!concert || concert.status !== "ON_SALE") {
    return { ok: false, error: "คอนเสิร์ตไม่เปิดขาย" };
  }

  // 🎟️ Phase 2.1 (docs/21): ด่านรอบพรีเซล — ORDER_CREATE
  //   คอนเสิร์ตที่ไม่มีรอบเลยจะผ่านทันที (พฤติกรรมเดิม) · มีรอบ = ต้องอยู่ในรอบที่ตัวเองมีสิทธิ์
  //   เช็คซ้ำที่นี่แม้ queue join เช็คไปแล้ว เพราะ token คิวอาจได้มาตอนรอบก่อนหน้าแล้วเพิ่งมากด
  const entry = await resolveEntryForUser(concertId, userId);
  if (!entry.ok) return { ok: false, error: entryDenyMessage(entry) };
  const round = entry.round;

  // เพดานตั๋วที่ใช้จริง — รอบพรีเซลตึงกว่าได้ (เช่น 2 ใบ) แต่ผ่อนให้หลวมกว่าคอนเสิร์ตไม่ได้
  const ticketMax = effectiveTicketLimit(concert.maxTicketsPerUser, round?.maxTicketsPerUser ?? null);

  // 🧹 F3: กวาด order ที่หมดเวลาแต่ไม่จ่ายของคอนเสิร์ตนี้ก่อน (คืนที่นั่งที่ค้าง HELD)
  // ทำตรงนี้เพราะเป็นจังหวะที่มีคนต้องการที่นั่งพอดี — ปล่อยที่นั่งตายให้กลับมาขายได้
  // และยังเคลียร์ order ค้างของ user เองออกจากยอดนับ F2 ด้านล่างด้วย
  await expireStaleOrders({ concertId: BigInt(concertId) });

  // 🎫 F2: ลิมิตตั๋วต่อ user ต่อคอนเสิร์ต — นับ "ยอดรวม" ที่ผูกพันอยู่แล้ว
  // (ตั๋วที่จ่ายแล้ว = PAID + order ที่ค้างจ่ายและยังไม่หมดอายุ = PENDING active)
  // รวมกับจำนวนที่กำลังจะจอง กันเข้าคิวซ้ำเพื่อกักตุน (ของเดิมเช็คแค่ order เดียว)
  // ⚡ Codex #5: อันนี้เป็นแค่ "fast-reject" (นอก tx อาจอ่านยอดคลาดตอนยิงพร้อมกัน) —
  //    ชั้นที่กัน race จริงอยู่ใน reserveSeatsForOrder (advisory lock + re-count ภายใน tx)
  const committed = await prisma.orderItem.count({
    where: {
      order: {
        userId: BigInt(userId),
        concertId: BigInt(concertId),
        OR: [{ status: "PAID" }, { status: "PENDING", expiresAt: { gt: new Date() } }],
      },
    },
  });
  if (exceedsTicketLimit({ committed, requested: seatIds.length, max: ticketMax })) {
    const remaining = remainingTicketAllowance({ committed, max: ticketMax });
    const scope = round && ticketMax < concert.maxTicketsPerUser ? `ใน${round.name}` : "ต่อคอนเสิร์ต";
    return {
      ok: false,
      error:
        remaining > 0
          ? `จองได้อีกสูงสุด ${remaining} ที่นั่ง (จำกัด ${ticketMax} ที่นั่ง/คน ${scope})`
          : `คุณจองครบ ${ticketMax} ที่นั่ง/คน ${scope} แล้ว`,
      pendingOrder: await findActivePendingOrder(userId, concertId),
    };
  }

  // 🔒 Codex #2: ดึงเฉพาะที่นั่งของ "คอนเสิร์ตนี้" เท่านั้น — กันส่ง seatIds ของคอนเสิร์ตอื่น
  //    มาจองข้ามคิว/ข้ามลิมิต (ที่นั่งต่างคอนเสิร์ตถูกกรองทิ้ง → length ไม่ครบ → ปฏิเสธ)
  const seats = await findSeatsInConcert(
    prisma,
    seatIds.map((s) => BigInt(s)),
    BigInt(concertId)
  );
  if (seats.length !== seatIds.length) return { ok: false, error: "ไม่พบที่นั่งบางที่" };
  if (seats.some((s) => s.status !== "AVAILABLE")) {
    return { ok: false, error: "ที่นั่งบางที่ถูกจองไปแล้ว" };
  }

  // 🔒 HOLD ที่นั่งผ่าน Redis lock (กัน race) — all-or-nothing
  const hold = await holdSeats({ seatIds, userId });
  if (!hold.success) {
    return { ok: false, error: "ที่นั่งบางที่เพิ่งถูกจองไป กรุณาเลือกใหม่", failedSeats: hold.failedSeats };
  }

  // คำนวณยอดรวม + อายุ order (5 นาที ตรงกับ hold TTL)
  const totalAmount = seats.reduce((sum, s) => sum + Number(s.zone.price.toString()), 0);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  // 🔒 Codex #5: สร้าง Order + mark seats HELD แบบ race-safe ต่อ "ลิมิตตั๋วต่อ user"
  //    advisory lock + re-count ภายใน transaction (ดู reserveSeatsForOrder ใน lib/order-finalize.ts)
  //    conditional updateMany (status=AVAILABLE→HELD) เป็น compare-and-set — กัน crash กลางคัน / ที่นั่งถูก race
  const reserved = await reserveSeatsForOrder({
    userId: BigInt(userId),
    concertId: BigInt(concertId),
    items: seats.map((s) => ({ seatId: s.id, price: s.zone.price })),
    maxTicketsPerUser: ticketMax,
    saleRound: round ? { id: BigInt(round.id), seatQuota: round.seatQuota } : null,
    expiresAt,
  });

  if (!reserved.ok) {
    // สร้าง order ไม่สำเร็จ → ปล่อย Redis hold เสมอ (กัน seat DB != Redis stuck ถาวร)
    await releaseSeats(seatIds, userId);
    if (reserved.reason === "LIMIT") {
      return {
        ok: false,
        error:
          reserved.remaining > 0
            ? `จองได้อีกสูงสุด ${reserved.remaining} ที่นั่ง (จำกัด ${ticketMax} ที่นั่ง/คน)`
            : `คุณจองครบ ${ticketMax} ที่นั่ง/คน สำหรับคอนเสิร์ตนี้แล้ว`,
        pendingOrder: await findActivePendingOrder(userId, concertId),
      };
    }
    if (reserved.reason === "ROUND_QUOTA") {
      // โควต้าที่นั่งของรอบพรีเซลเต็ม — ที่นั่งยังว่างแต่รอบนี้ขายได้เท่านี้ (รอรอบถัดไป)
      return { ok: false, error: `โควต้าที่นั่งของ${round?.name ?? "รอบนี้"}เต็มแล้ว กรุณารอรอบถัดไป` };
    }
    if (reserved.reason === "SEAT_TAKEN") {
      return { ok: false, error: "ที่นั่งบางที่เพิ่งถูกจองไป กรุณาเลือกใหม่" };
    }
    return { ok: false, error: "สร้างคำสั่งซื้อไม่สำเร็จ" };
  }

  try {
    // generate PromptPay QR
    const { dataUrl, promptPayId } = await generatePromptPayQR(totalAmount);
    return {
      ok: true,
      orderId: reserved.orderId.toString(),
      amount: totalAmount,
      qrDataUrl: dataUrl,
      promptPayId,
      expiresAt: expiresAt.toISOString(),
    };
  } catch {
    // QR ผิดพลาดหลังสร้าง order แล้ว — ปล่อย Redis hold (order PENDING จะถูก sweeper กวาดเองใน 5 นาที)
    await releaseSeats(seatIds, userId);
    return { ok: false, error: "สร้างคำสั่งซื้อไม่สำเร็จ" };
  }
}

// ---- 1.1 โซนยืน: เลือกที่นั่งผีให้ตามจำนวน แล้วต่อเข้าท่อจองเดิมทั้งก้อน ----
const standingHoldSchema = z.object({
  concertId: z.string().regex(/^\d+$/),
  zoneId: z.string().regex(/^\d+$/),
  quantity: z.number().int().positive().max(20),
  queueToken: z.string().min(1),
  turnstileToken: z.string().max(2048).optional(),
});

export async function holdStandingZone(input: {
  concertId: string;
  zoneId: string;
  quantity: number;
  queueToken: string;
  turnstileToken?: string;
}): Promise<HoldResult> {
  // 1) auth + zod มาก่อนเสมอ — กันผู้ไม่ล็อกอินและค่าขนาดผิดปกติก่อนแตะฐานข้อมูล
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบก่อนจองตั๋ว" };

  const parsed = standingHoldSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const { concertId, zoneId, quantity, queueToken, turnstileToken } = parsed.data;

  // 2) ยืนยันทั้งสถานะขายและ ownership ของโซน ก่อนเชื่อ zoneId จาก client
  const [concert, zone] = await Promise.all([
    prisma.concert.findUnique({
      where: { id: BigInt(concertId) },
      select: { maxTicketsPerUser: true, status: true },
    }),
    prisma.zone.findUnique({
      where: { id: BigInt(zoneId) },
      select: { concertId: true, isStanding: true },
    }),
  ]);
  if (!concert || concert.status !== "ON_SALE") {
    return { ok: false, error: "คอนเสิร์ตไม่เปิดขาย" };
  }
  if (!zone || !zone.isStanding || zone.concertId !== BigInt(concertId)) {
    return { ok: false, error: "โซนนี้ไม่ใช่โซนยืนของคอนเสิร์ตนี้" };
  }

  // 3) 🔴 clamp ก่อน query ที่นั่งหรือยิง Redis เสมอ: กันงานสุ่มก้อนใหญ่แบบ DoS
  // และกัน request เกินเพดานจำนวนมากไหลไปชน lock พร้อมกันจนเกิด thundering herd
  if (quantity > concert.maxTicketsPerUser) {
    return {
      ok: false,
      error: `เลือกได้สูงสุด ${concert.maxTicketsPerUser} ใบต่อบัญชีสำหรับคอนเสิร์ตนี้`,
    };
  }

  const loadCandidates = async (): Promise<string[]> => {
    const rows = await prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM seats
      WHERE "zoneId" = ${BigInt(zoneId)} AND status = 'AVAILABLE'
      ORDER BY random()
      LIMIT ${quantity * 3}
    `;
    return rows.map((row) => row.id.toString());
  };

  // 4) ดึงเผื่อราวสามเท่าไว้เติมตัวที่ชน Redis โดยไม่ต้องยิง query ใหม่ทุกครั้ง
  let candidates = await loadCandidates();
  if (candidates.length < quantity) {
    return { ok: false, error: `ที่ว่างไม่พอ (เหลือ ${candidates.length} ใบ)` };
  }

  const rejected = new Set<string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (candidates.length < quantity) {
      const known = new Set(candidates);
      const fresh = await loadCandidates();
      for (const seatId of fresh) {
        if (!rejected.has(seatId) && !known.has(seatId)) {
          candidates.push(seatId);
          known.add(seatId);
        }
      }
    }
    if (candidates.length < quantity) continue;

    // 5) ใช้ท่อเดิมทั้งก้อน เพื่อให้คิว/รอบขาย/ลิมิต/Redis hold/transaction วิ่งเหมือนโซนนั่ง
    const result = await holdAndCreateOrder({
      concertId,
      seatIds: candidates.slice(0, quantity),
      queueToken,
      turnstileToken,
    });
    if (result.ok) return result;

    // 6) retry เฉพาะการชน Redis ที่ระบุ failedSeats; error จากคิว/ลิมิต/รอบขายต้องคืนทันที
    if (!result.failedSeats?.length) return result;
    for (const seatId of result.failedSeats) rejected.add(seatId);
    candidates = candidates.filter((seatId) => !rejected.has(seatId));
  }

  return { ok: false, error: "คนกดเยอะมาก ลองอีกครั้ง" };
}

// ---- 1.2 โซนนั่งแบบ best-available: ส่งแค่จำนวนจาก client แล้วเลือกที่ดีที่สุดฝั่ง server ----
const bestAvailableHoldSchema = z.object({
  concertId: z.string().regex(/^\d+$/),
  zoneId: z.string().regex(/^\d+$/),
  quantity: z.number().int().positive().max(20),
  queueToken: z.string().min(1),
  turnstileToken: z.string().max(2048).optional(),
});

const BEST_AVAILABLE_CANDIDATE_LIMIT = 500;

export async function holdBestAvailable(input: {
  concertId: string;
  zoneId: string;
  quantity: number;
  queueToken: string;
  turnstileToken?: string;
}): Promise<HoldResult> {
  // 1) auth + zod มาก่อนเสมอ — กันผู้ไม่ล็อกอินและ payload ผิดรูปก่อนแตะฐานข้อมูล
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบก่อนจองตั๋ว" };

  const parsed = bestAvailableHoldSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const { concertId, zoneId, quantity, queueToken, turnstileToken } = parsed.data;

  // 2) ยืนยันสถานะขายและ ownership ของโซนก่อนเชื่อ zoneId จาก client
  const [concert, zone] = await Promise.all([
    prisma.concert.findUnique({
      where: { id: BigInt(concertId) },
      select: { maxTicketsPerUser: true, status: true },
    }),
    prisma.zone.findUnique({
      where: { id: BigInt(zoneId) },
      select: { concertId: true, isStanding: true },
    }),
  ]);
  if (!concert || concert.status !== "ON_SALE") {
    return { ok: false, error: "คอนเสิร์ตไม่เปิดขาย" };
  }
  if (!zone || zone.isStanding || zone.concertId !== BigInt(concertId)) {
    return { ok: false, error: "โซนนี้ไม่ใช่โซนนั่งของคอนเสิร์ตนี้" };
  }

  // 3) 🔴 clamp ก่อน query ผู้สมัครหรือยิง Redis: กันบอทขอชุดใหญ่เพื่อกิน DB/lock พร้อมกัน
  if (quantity > concert.maxTicketsPerUser) {
    return {
      ok: false,
      error: `เลือกได้สูงสุด ${concert.maxTicketsPerUser} ที่นั่งต่อบัญชีสำหรับคอนเสิร์ตนี้`,
    };
  }

  const rejected = new Set<string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    // จำกัดผู้สมัครไว้ 500 ที่แรกตามลำดับผัง ป้องกันการดึงสต็อกทั้งโซนขนาดใหญ่เข้าหน่วยความจำ
    // ⚠️ ต้องเรียง "ความยาวชื่อแถวก่อนตัวอักษร" ให้ตรง compareSeatOrder — ถ้าเรียง string ล้วน
    // แถว AA จะแทรกระหว่าง A กับ B แล้วเบียดแถวหน้าหลุดจากโควตา 500 → ระบบแจกแถวหลังทั้งที่แถวหน้าว่าง
    const candidates = await prisma.$queryRaw<
      Array<{ id: bigint; rowLabel: string; seatNumber: number }>
    >`
      SELECT id, "rowLabel", "seatNumber" FROM seats
      WHERE "zoneId" = ${BigInt(zoneId)} AND status = 'AVAILABLE'
      ${
        rejected.size > 0
          ? Prisma.sql`AND id NOT IN (${Prisma.join([...rejected].map((seatId) => BigInt(seatId)))})`
          : Prisma.empty
      }
      ORDER BY LENGTH("rowLabel"), "rowLabel", "seatNumber"
      LIMIT ${BEST_AVAILABLE_CANDIDATE_LIMIT}
    `;
    const seatIds = pickBestSeats(
      candidates.map((seat) => ({ ...seat, id: seat.id.toString() })),
      quantity,
    );
    if (seatIds.length < quantity) {
      return attempt === 0
        ? { ok: false, error: `ที่ว่างไม่พอ (เหลือ ${candidates.length} ที่)` }
        : { ok: false, error: "คนกดเยอะมาก ลองอีกครั้ง" };
    }

    // 4) ต่อเข้าท่อเดิมทั้งก้อน เพื่อคงด่านคิว/รอบขาย/ลิมิต/Redis hold/transaction เดิมทุกชั้น
    const result = await holdAndCreateOrder({ concertId, seatIds, queueToken, turnstileToken });
    if (result.ok) return result;

    // 5) retry เฉพาะตัวที่ชน Redis แล้วเลือกชุดดีที่สุดใหม่จากผู้สมัครที่เหลือ ไม่เกิน 3 รอบ
    if (!result.failedSeats?.length) return result;
    for (const seatId of result.failedSeats) rejected.add(seatId);
  }

  return { ok: false, error: "คนกดเยอะมาก ลองอีกครั้ง" };
}

// ---- 2. Submit สลิป → verify → issue tickets ----
// slipImageBase64 บังคับต้องมี — กันจ่ายโดยไม่แนบสลิป (defense-in-depth ร่วมกับ
// ปุ่มฝั่ง client ที่ปิดไว้ + ชั้นตรวจใน verifySlip)
// F7: จำกัดขนาด + ตรวจชนิดของรูปสลิป (กันอัปข้อมูลยักษ์กิน RAM / ส่ง payload แปลก)
const slipSchema = z.object({
  orderId: z.string().min(1),
  slipImageBase64: z
    .string()
    .min(1, "กรุณาแนบสลิปการโอนเงิน")
    .max(MAX_SLIP_BASE64_LEN, "ไฟล์สลิปใหญ่เกินไป (จำกัดประมาณ 2MB)")
    .refine(isLikelyBase64Image, "ไฟล์สลิปไม่ถูกต้อง — ต้องเป็นรูปภาพ"),
});

export type SlipResult =
  | { ok: true; ticketCount: number }
  | { ok: false; error: string };

export async function submitSlip(input: {
  orderId: string;
  slipImageBase64?: string;
}): Promise<SlipResult> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบ" };

  const parsed = slipSchema.safeParse(input);
  if (!parsed.success) {
    // ดึง error แรก (มักเป็น "กรุณาแนบสลิป") มาแสดงให้ตรงปัญหา
    const msg = parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";
    return { ok: false, error: msg };
  }

  // 🚦 F1: rate limit ก่อนเรียก EasySlip (กันยิงรัวเผาโควต้า + brute-force สลิปกับ order เดียว)
  // เช็คทั้งระดับ order+user (กัน brute สลิปกับ order ตัวเอง) และระดับ user (กันกระจายหลาย order)
  const rlOrder = await checkRateLimit({
    key: `submit_slip:order:${parsed.data.orderId}:user:${userId}`,
    ...SLIP_RL_ORDER,
  });
  const rlUser = await checkRateLimit({ key: `submit_slip:user:${userId}`, ...SLIP_RL_USER });
  if (!rlOrder.allowed || !rlUser.allowed) {
    const secs = Math.ceil(Math.max(rlOrder.retryAfterMs, rlUser.retryAfterMs) / 1000);
    return { ok: false, error: `ส่งสลิปบ่อยเกินไป กรุณารออีก ${secs} วินาทีแล้วลองใหม่` };
  }

  // ดึง order + items + payment
  const order = await prisma.order.findUnique({
    where: { id: BigInt(parsed.data.orderId) },
    include: { items: true, payment: true },
  });
  if (!order || order.userId !== BigInt(userId)) {
    return { ok: false, error: "ไม่พบคำสั่งซื้อ" };
  }
  if (order.status === "PAID") return { ok: false, error: "คำสั่งซื้อนี้จ่ายแล้ว" };
  if (order.status === "CANCELLED" || order.expiresAt < new Date()) {
    return { ok: false, error: "คำสั่งซื้อหมดอายุแล้ว" };
  }

  // 🔒 Codex #3 (ชั้นกันไว้ก่อน): ระหว่างรอ EasySlip order อาจหมดอายุพอดี → เงินเข้าแต่ claim
  //    ไม่ได้ = ต้องคืนเงิน — ยืด expiresAt แบบ conditional (เฉพาะที่ยัง PENDING+ไม่หมดอายุ
  //    เท่านั้น order ที่ตายแล้วไม่ถูกชุบ) ให้ sweeper/นาฬิกาไม่ตัดหน้าช่วง verify
  if (order.expiresAt.getTime() - Date.now() < VERIFY_LEASE_MS) {
    const leased = await prisma.order.updateMany({
      where: { id: order.id, status: "PENDING", expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date(Date.now() + VERIFY_LEASE_MS) },
    });
    if (leased.count === 0) return { ok: false, error: "คำสั่งซื้อหมดอายุแล้ว" };
  }

  const expectedAmount = Number(order.totalAmount.toString());

  // verify สลิปกับผู้ให้บริการตาม SLIP_PROVIDER (EasySlip/SlipOK — dev ที่ไม่ตั้งคีย์ = mock pass)
  const verify = await verifySlip({
    slipImageBase64: parsed.data.slipImageBase64,
    expectedAmount,
  });

  if (!verify.success) {
    return { ok: false, error: verify.error ?? "ตรวจสอบสลิปไม่สำเร็จ" };
  }

  // ตรวจยอดตรงไหม (tolerance 0 — ต้องตรงเป๊ะ) — เทียบเป็น "สตางค์จำนวนเต็ม" ทั้งสองฝั่ง (SECURITY_TODO #4)
  //   ยอดสลิปเป็น float จาก EasySlip / ยอด order เป็น Decimal(10,2) → เทียบ float ตรง ๆ เสี่ยง drift
  //   (1500.0000000001 ≠ 1500 ทั้งที่ยอดเดียวกัน) · ยอดที่อ่านไม่ได้ (undefined/NaN) = ไม่ตรง (fail-closed)
  if (!sameAmount(verify.amount, order.totalAmount.toString())) {
    return {
      ok: false,
      error: `ยอดไม่ตรง: โอนมา ${verify.amount ?? "?"} บาท แต่ต้องชำระ ${expectedAmount} บาท`,
    };
  }

  // 🔒 Level 2: เวลาโอนในสลิปต้องอยู่ในช่วงของ order นี้ (กันเอาสลิปเก่ามาใช้ซ้ำ)
  if (env.PAYMENTS_FRESHNESS_CHECK) {
    if (!verify.transAt || !isSlipFresh({ slipTime: verify.transAt, orderCreatedAt: order.createdAt })) {
      return {
        ok: false,
        error: "เวลาโอนในสลิปไม่ตรงกับคำสั่งซื้อนี้ — กรุณาใช้สลิปที่โอนสำหรับรายการนี้",
      };
    }
  }

  // กันสลิปซ้ำ — slipRef ต้อง unique (DB constraint จะ throw ถ้าซ้ำ)
  // F8: หมายเหตุ — ตั้งใจ "ไม่" re-check Redis hold (isHeldBy) ตรงนี้ เพราะ submitSlip
  //     รันหลังยืนยันเงินเข้าแล้ว ถ้า block จะกลายเป็น "ลูกค้าจ่ายแต่ไม่ได้ตั๋ว"
  //     การกันที่นั่งซ้ำพึ่ง unique constraint บน Ticket.seatId + OrderItem.seatId ใน transaction นี้แทน
  // 🛡️ per-payer cap (anti-scalping): สร้างคีย์ "ผู้จ่าย" จากสลิป
  //    ข้ามใน dev-mock (verify.devMode) เพราะไม่มีผู้จ่ายจริง — กัน cap บล็อกตอนทดสอบ/demo
  //    senderBank ใช้เสริมเฉพาะกรณีสลิปไม่มีเลขบัญชี (SECURITY_TODO #3 — คีย์ "ธนาคาร:ชื่อ" แทน "ชื่อ" ล้วน)
  const payerKey = verify.devMode
    ? null
    : computePayerKey({
        senderAccount: verify.senderAccount,
        senderName: verify.senderName,
        senderBank: verify.senderBank,
      });

  // ออกตั๋ว + mark paid แบบ atomic & race-safe (N1) + เช็ค per-payer cap — ดู lib/order-finalize.ts
  const seatIds = order.items.map((i) => i.seatId);
  const result = await finalizePaidOrder({
    orderId: order.id,
    userId: BigInt(userId),
    concertId: order.concertId,
    items: order.items.map((i) => ({ seatId: i.seatId, price: i.price, holderUserId: i.holderUserId })),
    slipRef: verify.ref,
    senderName: verify.senderName,
    senderAccount: verify.senderAccount,
    payerKey,
    perPayerLimit: env.PER_PAYER_TICKET_LIMIT,
    paidAt: verify.transAt ?? undefined,
  });

  if (result.ok) {
    // ปล่อย Redis hold (ที่นั่งเป็น SOLD แล้ว ไม่ต้อง lock)
    await releaseSeats(seatIds.map((s) => s.toString()), userId);
    // คืนความจุคิวทันที (capacity-aware self-refill): ผู้ใช้ได้ตั๋วแล้ว ออกจากห้องเลือกที่นั่งถาวร
    //   → เปิดช่องให้คิวถัดไปเข้าไม่ต้องรอ admit TTL หมด. best-effort — พลาดก็ไม่กระทบผลการจ่าย
    await releaseAdmittedByUser(order.concertId.toString(), userId).catch(() => {});
    // 📧 ใบเสร็จ/ตั๋วทางอีเมล (rev 35) — รันหลังตอบ client แล้ว (after) ไม่เพิ่ม latency และล้มก็ไม่กระทบผลการจ่าย
    after(() => notifyOrderPaid(order.id));
    return { ok: true, ticketCount: result.ticketCount };
  }

  if (result.reason === "ORDER_NOT_CLAIMABLE" || result.reason === "SEAT_CONFLICT") {
    // 🔁 Codex #6: อาจเป็น "สลิปใบเดิม + order เดิม" ที่จ่ายสำเร็จไปแล้ว (กดซ้ำ/สอง tab พร้อมกัน)
    //    → ตอบสำเร็จแบบ idempotent (ลูกค้าได้ตั๋วแล้ว) ไม่ใช่ log REFUND ผิดๆ
    if (verify.ref) {
      const dup = await findPaidOrderBySlip({
        orderId: order.id,
        userId: BigInt(userId),
        slipRef: verify.ref,
      });
      if (dup.paid) {
        await releaseSeats(seatIds.map((s) => s.toString()), userId);
        return { ok: true, ticketCount: dup.ticketCount };
      }
    }

    // เงินเข้าแล้ว (slip ผ่าน verify) แต่ order ถูกยกเลิก/หมดอายุ หรือที่นั่งถูกปล่อย ระหว่างรอ verify
    // ตั้งใจ "ไม่" ออกตั๋ว/ไม่ resurrect order (กัน double-book)
    // 💾 Codex #3: บันทึก REFUND_REQUIRED ลง DB ให้ทีมงานตามคืนเงินได้ (ไม่พึ่ง log อย่างเดียว)
    const refund = await recordRefundRequired({
      orderId: order.id,
      slipRef: verify.ref,
      senderName: verify.senderName,
      senderAccount: verify.senderAccount,
      payerKey,
    });
    if (!refund.recorded && refund.reason === "SLIP_ALREADY_USED") {
      // สลิปใบนี้จ่าย order อื่นสำเร็จไปแล้ว — เป็นสลิปเวียน ไม่ใช่เคสคืนเงิน
      return { ok: false, error: "สลิปนี้ถูกใช้ไปแล้ว หรือเกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
    }
    console.error(
      `🚨 REFUND NEEDED: ชำระเงินถูกต้อง (slipRef=${verify.ref}, ยอด=${expectedAmount}) ` +
        `แต่ออกตั๋วไม่ได้ (${result.reason}) order=${order.id} user=${userId} — ` +
        (refund.recorded
          ? "บันทึก REFUND_REQUIRED ใน payment แล้ว รอทีมงานโอนคืน"
          : `บันทึกลง DB ไม่สำเร็จ (${refund.reason}) ต้องตามคืนจาก log นี้`)
    );
    return {
      ok: false,
      error:
        "คำสั่งซื้อหมดอายุหรือถูกยกเลิกก่อนยืนยันการชำระเงิน — หากถูกตัดเงินแล้ว ทีมงานจะคืนเงินให้ กรุณาติดต่อฝ่ายบริการ",
    };
  }

  if (result.reason === "PAYER_LIMIT") {
    // เงินเข้าแล้ว แต่ "บัญชีผู้จ่าย" รายนี้ซื้อบัตรคอนเสิร์ตนี้ครบเพดานแล้ว (กัน account farming ของขบวนการบอท)
    // ตั้งใจไม่ออกตั๋ว — มาตรการคือทำให้ "ปั๊มบัญชีแอปแล้วจ่ายจากบัญชีธนาคารเดียว" เสี่ยงจ่ายฟรี
    // 💾 Codex #3: เคสนี้เงินก็เข้าจริงเหมือนกัน → บันทึก REFUND_REQUIRED ด้วย
    const refundPL = await recordRefundRequired({
      orderId: order.id,
      slipRef: verify.ref,
      senderName: verify.senderName,
      senderAccount: verify.senderAccount,
      payerKey,
    });
    console.error(
      `🚨 REFUND NEEDED (per-payer cap): payerKey=${payerKey} ซื้อครบ ${env.PER_PAYER_TICKET_LIMIT} ใบ/คอนเสิร์ตแล้ว ` +
        `(slipRef=${verify.ref}, ยอด=${expectedAmount}) order=${order.id} user=${userId} — ` +
        (refundPL.recorded ? "บันทึก REFUND_REQUIRED แล้ว" : `บันทึกไม่สำเร็จ (${refundPL.reason})`)
    );
    return {
      ok: false,
      error: `บัญชีที่ใช้ชำระเงินซื้อบัตรคอนเสิร์ตนี้ครบจำนวนสูงสุดต่อผู้ชำระเงินแล้ว (${env.PER_PAYER_TICKET_LIMIT} ใบ) — หากถูกตัดเงินแล้ว ทีมงานจะคืนเงินให้ กรุณาติดต่อฝ่ายบริการ`,
    };
  }

  // DUPLICATE_SLIP / ERROR — slipRef ซ้ำ (ใช้สลิปเดียวหลายรอบ) หรือพลาดอื่น
  return { ok: false, error: "สลิปนี้ถูกใช้ไปแล้ว หรือเกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
}

// ---- 3. Named ticket (docs/19): ระบุ "ผู้ถือบัตร" ต่อที่นั่ง ตอน checkout ----
// commit ผู้ถือก่อนจ่าย — หลังจ่ายแล้วแก้ไม่ได้ (กฎเหล็ก: ให้เล็งผู้รับหลังกดได้ = ช่อง scalper)
const ASSIGN_RL = { limit: 20, windowMs: 10 * 60_000 }; // กันยิงสุ่มเบอร์/อีเมลหาบัญชี (enumeration)

// ข้อความกลางเหตุเดียว — ไม่เฉลยว่าพลาดเงื่อนไขไหน กัน probe ว่า "เบอร์นี้มีบัญชีไหม"
const HOLDER_GENERIC_ERROR =
  "บัญชีนี้รับบัตรไม่ได้ — ผู้ถือต้องมีบัญชีที่ยืนยันอีเมลแล้ว ตั้งชื่อ-นามสกุลจริง " +
  "มีบัญชีมานานพอ และยังรับบัตรคอนเสิร์ตนี้ไม่ถึงเพดาน";

const assignSchema = z.object({
  orderId: z.string().min(1),
  itemId: z.string().min(1),
  contact: z.string().trim().min(3).max(255), // อีเมล หรือ เบอร์โทร ของบัญชีผู้ถือ
});

export type AssignHolderResult = { ok: true; holderName: string } | { ok: false; error: string };

export async function assignHolder(input: {
  orderId: string;
  itemId: string;
  contact: string;
}): Promise<AssignHolderResult> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, error: "กรุณาเข้าสู่ระบบ" };

  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };

  // 🚦 rate limit ต่อ user — ช่องนี้คือ oracle ค้นบัญชีจากเบอร์/อีเมล ต้องแพงสำหรับคน probe
  const rl = await checkRateLimit({ key: `assign_holder:user:${userId}`, ...ASSIGN_RL });
  if (!rl.allowed) {
    return {
      ok: false,
      error: `ลองระบุผู้ถือบ่อยเกินไป กรุณารออีก ${Math.ceil(rl.retryAfterMs / 1000)} วินาที`,
    };
  }

  const order = await prisma.order.findUnique({
    where: { id: BigInt(parsed.data.orderId) },
    select: {
      id: true,
      userId: true,
      concertId: true,
      status: true,
      expiresAt: true,
      items: { select: { id: true } },
      concert: { select: { maxTicketsPerUser: true } },
    },
  });
  if (!order || order.userId !== BigInt(userId)) return { ok: false, error: "ไม่พบคำสั่งซื้อ" };
  if (order.status !== "PENDING" || order.expiresAt < new Date()) {
    return { ok: false, error: "คำสั่งซื้อนี้แก้ไขผู้ถือไม่ได้แล้ว" };
  }
  const itemId = BigInt(parsed.data.itemId);
  if (!order.items.some((i) => i.id === itemId)) {
    return { ok: false, error: "ไม่พบที่นั่งในคำสั่งซื้อนี้" };
  }

  // ค้นบัญชีผู้ถือจาก email (มี @) หรือเบอร์โทร (เทียบทั้งตามที่พิมพ์และแบบตัวเลขล้วน)
  const contact = parsed.data.contact;
  const isEmail = contact.includes("@");
  const phoneDigits = contact.replace(/\D/g, "");
  const holder = await prisma.user.findFirst({
    where: isEmail
      ? { email: contact.toLowerCase() }
      : { OR: [{ phone: contact }, ...(phoneDigits ? [{ phone: phoneDigits }] : [])] },
    select: { id: true, name: true, emailVerified: true, createdAt: true },
  });

  // ทุกเหตุปฏิเสธ → ข้อความกลางเดียวกัน (ดูคอมเมนต์ HOLDER_GENERIC_ERROR)
  const rejected = { ok: false as const, error: HOLDER_GENERIC_ERROR };
  if (!holder) return rejected;
  if (!holder.emailVerified) return rejected; // ต้องยืนยันตัวตนแล้ว
  const holderName = holder.name?.trim() ?? "";
  if (!holderName) return rejected; // ต้องมีชื่อจริงไว้เทียบบัตรประชาชนหน้างาน

  if (holder.id !== BigInt(userId)) {
    // อายุบัญชีขั้นต่ำ (กันบัญชีเพิ่งสมัครมารับบัตรจาก scalper — เกณฑ์ ~1 เดือน)
    if (
      !isHolderAccountOldEnough({
        createdAt: holder.createdAt,
        minDays: env.HOLDER_MIN_ACCOUNT_AGE_DAYS,
      })
    ) {
      return rejected;
    }
    // เพดานรับบัตรฝั่ง "ผู้ถือ" ต่อคอนเสิร์ต (นับข้ามทุกผู้ซื้อ) — ใช้เพดานเดียวกับ per-user limit
    const [issued, pendingAssigned] = await Promise.all([
      // ตั๋วที่คนนี้ถืออยู่แล้ว (ยังไม่ถูกคืน) ของคอนเสิร์ตนี้
      prisma.ticket.count({
        where: { userId: holder.id, returnedAt: null, order: { concertId: order.concertId } },
      }),
      // ที่นั่งใน order อื่นที่ยัง active ซึ่งตั้งชื่อคนนี้เป็นผู้ถือไว้
      prisma.orderItem.count({
        where: {
          holderUserId: holder.id,
          id: { not: itemId },
          order: {
            concertId: order.concertId,
            OR: [{ status: "PAID" }, { status: "PENDING", expiresAt: { gt: new Date() } }],
          },
        },
      }),
    ]);
    if (
      exceedsHolderCap({
        committed: issued + pendingAssigned,
        requested: 1,
        limit: order.concert.maxTicketsPerUser,
      })
    ) {
      return rejected;
    }
  }

  // เขียนแบบ conditional — order ต้องยัง PENDING (กัน race กับการจ่ายเงินที่กำลัง finalize)
  const updated = await prisma.orderItem.updateMany({
    where: { id: itemId, orderId: order.id, order: { status: "PENDING" } },
    data: { holderUserId: holder.id },
  });
  if (updated.count === 0) return { ok: false, error: "คำสั่งซื้อนี้แก้ไขผู้ถือไม่ได้แล้ว" };

  return { ok: true, holderName };
}

// เอาผู้ถือออก (กลับเป็นผู้ซื้อถือเอง) — ได้เฉพาะตอน order ยัง PENDING เช่นกัน
export async function clearHolder(input: {
  orderId: string;
  itemId: string;
}): Promise<{ ok: boolean }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false };

  const updated = await prisma.orderItem.updateMany({
    where: {
      id: BigInt(input.itemId),
      orderId: BigInt(input.orderId),
      order: { userId: BigInt(userId), status: "PENDING" },
    },
    data: { holderUserId: null },
  });
  return { ok: updated.count > 0 };
}

// ---- 4. ยกเลิก order (ปล่อยที่นั่ง) ----
export async function cancelOrder(orderId: string): Promise<{ ok: boolean }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false };

  const order = await prisma.order.findUnique({
    where: { id: BigInt(orderId) },
    include: { items: true },
  });
  if (!order || order.userId !== BigInt(userId) || order.status !== "PENDING") {
    return { ok: false };
  }

  const seatIds = order.items.map((i) => i.seatId);
  // ยกเลิกแบบ atomic & race-safe (N3) — ยกเลิกเฉพาะถ้ายัง PENDING (กัน race กับ submitSlip ที่เพิ่งจ่าย)
  const result = await cancelPendingOrder({ orderId: order.id, userId: BigInt(userId) });
  if (result.ok) {
    await releaseSeats(seatIds.map((s) => s.toString()), userId);
  }
  return { ok: result.ok };
}
