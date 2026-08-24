import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmitted } from "@/lib/queue";
import { checkRateLimit } from "@/lib/rate-limit";
import { getHeldSeats } from "@/lib/seat-hold";

export const dynamic = "force-dynamic";

const SEAT_LIST_RATE_LIMIT = { limit: 30, windowMs: 60_000 };
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function jsonNoStore(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; zoneId: string }> },
) {
  const { id: concertId, zoneId } = await params;

  // 1) ต้องรู้ตัวผู้ใช้ก่อนทุกด่าน เพื่อไม่ให้ endpoint นี้กลายเป็นช่องอ่านสต็อกแบบไม่ล็อกอิน
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return jsonNoStore({ error: "กรุณาเข้าสู่ระบบ" }, 401);

  // 2) ด่านคิวต้องมาก่อน query โซน/ที่นั่งเสมอ: กันบอท scrape สต็อกทีละโซนด้วย token มั่ว
  const queueToken = new URL(request.url).searchParams.get("qt") ?? "";
  const admitted = await isAdmitted(queueToken, concertId, userId);
  if (!admitted)
    return jsonNoStore({ error: "คิวหมดอายุหรือไม่มีสิทธิ์ดูที่นั่ง" }, 403);

  // จำกัดการเปิดโซนต่อ user หลังผ่านคิวแล้ว ลดการไล่ดูสต็อกทั้งงานแบบอัตโนมัติ
  const rateLimit = await checkRateLimit({
    key: `zone_seats:${concertId}:user:${userId}`,
    ...SEAT_LIST_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(rateLimit.retryAfterMs / 1000),
    );
    return jsonNoStore(
      { error: "เปิดดูที่นั่งถี่เกินไป กรุณารอสักครู่" },
      429,
      { "Retry-After": String(retryAfterSeconds) },
    );
  }

  // 3) หลังผ่าน auth+queue แล้วจึงแตะ DB และผูก zoneId กับ concertId; โซนยืนไม่มีรายที่นั่งให้เปิดดู
  if (!/^\d+$/.test(concertId) || !/^\d+$/.test(zoneId)) {
    return jsonNoStore({ error: "ไม่พบโซนที่นั่ง" }, 404);
  }
  const zone = await prisma.zone.findFirst({
    where: {
      id: BigInt(zoneId),
      concertId: BigInt(concertId),
      isStanding: false,
    },
    select: {
      seats: {
        select: { id: true, rowLabel: true, seatNumber: true, status: true },
        orderBy: [{ rowLabel: "asc" }, { seatNumber: "asc" }],
      },
    },
  });
  if (!zone) return jsonNoStore({ error: "ไม่พบโซนที่นั่ง" }, 404);

  // 4) รวม Redis hold สดก่อนคืนเฉพาะโซนที่ผู้ใช้เปิด ไม่เปิดเผยภาพรวมสต็อกทั้งคอนเสิร์ต
  const seatIds = zone.seats.map((seat) => seat.id.toString());
  const heldSet = await getHeldSeats(seatIds);
  return jsonNoStore({
    seats: zone.seats.map((seat) => {
      const id = seat.id.toString();
      return {
        id,
        rowLabel: seat.rowLabel,
        seatNumber: seat.seatNumber,
        status:
          heldSet.has(id) && seat.status === "AVAILABLE" ? "HELD" : seat.status,
      };
    }),
  });
}
