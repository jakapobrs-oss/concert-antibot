// GET /api/queue/status?token=xxx — ดูตำแหน่งในคิว (client poll ทุก 2-3 วิ)
// ฝั่ง server จะ auto-admit batch ตอนถูก poll ด้วย (on-demand admission)
// เพื่อไม่ต้องมี cron แยก — เหมาะกับ local-only deployment
import { NextRequest, NextResponse } from "next/server";
import { getQueueStatus, admitNext } from "@/lib/queue";
import { checkRateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";

// จำนวนที่ปล่อยต่อรอบ (ปรับได้ผ่าน env)
const BATCH_SIZE = Number(process.env.QUEUE_BATCH_SIZE ?? 100);
// ปล่อย batch ได้ถี่สุดทุกกี่ ms (กันปล่อยรัวเกิน)
const ADMIT_INTERVAL_MS = 3000;
// rate limit: client poll ได้ถี่สุด 30 ครั้ง/นาที/token
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "ต้องมี token" }, { status: 400 });
  }

  // rate limit per token กัน flood ที่ทำให้ admit ทำงานหนักเกิน
  const rl = await checkRateLimit({ key: `queue_status:token:${token}`, ...RATE_LIMIT });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "poll ถี่เกินไป" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
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
