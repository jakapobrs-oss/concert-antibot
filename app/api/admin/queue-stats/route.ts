// GET /api/admin/queue-stats?concertId=X — ตัวเลขสดของคิว (แผงแอดมิน poll ทุก ~2-3 วิ)
// คืน: waiting (รอในคิว) / inside (อยู่ในห้องเลือกที่นั่ง) / seatsLeft / cap / paused
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getQueueStats } from "@/lib/queue";
import { countAvailableSeats } from "@/lib/seat-availability";
import { isQueuePaused, getEffectiveCap } from "@/lib/queue-control";

export async function GET(req: NextRequest) {
  // admin only — เช็คในตัว endpoint (defense in depth; endpoint นี้อยู่นอก (admin) page group)
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const concertId = req.nextUrl.searchParams.get("concertId");
  if (!concertId || !/^\d+$/.test(concertId)) {
    return NextResponse.json({ error: "concertId ไม่ถูกต้อง" }, { status: 400 });
  }

  const [{ waiting, admitted }, seatsLeft, cap, paused] = await Promise.all([
    getQueueStats(concertId), // prune ghost แล้ว → inside ตรง
    countAvailableSeats(concertId).catch(() => null),
    getEffectiveCap(concertId),
    isQueuePaused(concertId),
  ]);

  return NextResponse.json({
    waiting,
    inside: admitted, // คนที่อยู่ในห้องเลือกที่นั่งตอนนี้
    seatsLeft,
    cap,
    paused,
  });
}
