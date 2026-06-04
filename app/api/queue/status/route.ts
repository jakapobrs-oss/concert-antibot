// GET /api/queue/status?token=xxx — ดูตำแหน่งในคิว (client poll ทุก 2-3 วิ)
// ฝั่ง server จะ auto-admit batch ตอนถูก poll ด้วย (on-demand admission)
// เพื่อไม่ต้องมี cron แยก — เหมาะกับ local-only deployment
import { NextRequest, NextResponse } from "next/server";
import { getQueueStatus, admitNext } from "@/lib/queue";
import { redis } from "@/lib/redis";

// จำนวนที่ปล่อยต่อรอบ (ปรับได้ผ่าน env)
const BATCH_SIZE = Number(process.env.QUEUE_BATCH_SIZE ?? 100);
// ปล่อย batch ได้ถี่สุดทุกกี่ ms (กันปล่อยรัวเกิน)
const ADMIT_INTERVAL_MS = 3000;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "ต้องมี token" }, { status: 400 });
  }

  // หา concertId จาก token ก่อน (เพื่อ trigger admit ของคอนเสิร์ตนั้น)
  const meta = await redis.hgetall(`queue:token:${token}`);
  const concertId = meta?.concertId;

  // on-demand admission: ใช้ lock กันหลาย request ปล่อย batch พร้อมกัน
  // SET NX EX — ใครได้ lock คนนั้นปล่อย batch (atomic, กันแย่งกัน)
  if (concertId) {
    const lockKey = `queue:${concertId}:admit-lock`;
    const gotLock = await redis.set(lockKey, "1", "PX", ADMIT_INTERVAL_MS, "NX");
    if (gotLock === "OK") {
      // เราได้สิทธิ์ปล่อย batch รอบนี้
      await admitNext(concertId, BATCH_SIZE);
    }
  }

  const status = await getQueueStatus(token);
  return NextResponse.json(status);
}
