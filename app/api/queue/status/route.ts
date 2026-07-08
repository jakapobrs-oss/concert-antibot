// GET /api/queue/status?token=xxx — ดูตำแหน่งในคิว (client poll ทุก 2-3 วิ)
// ฝั่ง server จะ auto-admit batch ตอนถูก poll ด้วย (on-demand admission)
// เพื่อไม่ต้องมี cron แยก — เหมาะกับ local-only deployment
import { NextRequest, NextResponse } from "next/server";
import { getQueueStatus, admitNext } from "@/lib/queue";
import { countAvailableSeats } from "@/lib/seat-availability";
import { isQueuePaused, getEffectiveCap } from "@/lib/queue-control";
import { checkRateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";
import { env } from "@/lib/env";

// ปล่อย batch ได้ถี่สุดทุกกี่ ms (กันปล่อยรัวเกิน)
const ADMIT_INTERVAL_MS = 3000;
// rate limit: client poll ได้ถี่สุด 30 ครั้ง/นาที/token
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  // validate รูปแบบก่อนแตะ Redis — token จริง = hex 64 ตัว (crypto.randomBytes(32).toString("hex"))
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: "token ไม่ถูกต้อง" }, { status: 400 });
  }

  // อ่าน meta ก่อน (hgetall = read เฉย ๆ ไม่สร้าง key) แล้วใช้เป็น "ประตูตรวจว่ามี token จริง"
  //   ถ้า token ไม่มีจริง/หมดอายุ → คืน NOT_FOUND โดย "ไม่" ไปแตะ checkRateLimit
  //   → กันหมุน token สุ่มรัว ๆ สร้าง rate-limit key ไม่จำกัด + เลี่ยง per-token limit (unauth Redis DoS)
  //   จำนวน rate-limit key จะผูกกับ "จำนวน token จริง" เท่านั้น
  const meta = await redis.hgetall(`queue:token:${token}`);
  const concertId = meta?.concertId;
  if (!concertId) {
    return NextResponse.json({ token, status: "NOT_FOUND", position: 0, ahead: 0, total: 0 });
  }

  // rate limit per token (หลังยืนยันว่า token มีจริงแล้ว) กัน flood ที่ทำให้ admit ทำงานหนักเกิน
  const rl = await checkRateLimit({ key: `queue_status:token:${token}`, ...RATE_LIMIT });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "poll ถี่เกินไป" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  // on-demand admission: ใช้ lock กันหลาย request ปล่อย batch พร้อมกัน
  // SET NX EX — ใครได้ lock คนนั้นปล่อย batch (atomic, กันแย่งกัน)
  if (concertId) {
    const lockKey = `queue:${concertId}:admit-lock`;
    const gotLock = await redis.set(lockKey, "1", "PX", ADMIT_INTERVAL_MS, "NX");
    if (gotLock === "OK") {
      // แอดมินสั่งหยุดปล่อยคิวชั่วคราวไหม — ถ้าหยุด ข้ามรอบนี้ (คิวค้างไว้ ไม่ปล่อยเพิ่ม)
      if (!(await isQueuePaused(concertId))) {
        // capacity-aware: ไม่เกินความจุห้อง (cap; ใช้ค่า override ของแอดมินถ้ามี) และไม่เกินที่นั่งที่เหลือ
        let seatsLeft: number | undefined;
        try {
          seatsLeft = await countAvailableSeats(concertId);
        } catch {
          // นับที่นั่งไม่ได้ (เช่น concertId ไม่ใช่เลข/DB ล่ม) → พึ่ง cap อย่างเดียว
          // ยังปลอดภัยเพราะ seat-hold (SET NX) กัน double-book ที่ชั้นเลือกที่นั่งอยู่แล้ว
          seatsLeft = undefined;
        }
        await admitNext(concertId, {
          batchSize: env.QUEUE_BATCH_SIZE,
          cap: await getEffectiveCap(concertId),
          seatsLeft,
        });
      }
    }
  }

  const status = await getQueueStatus(token);
  return NextResponse.json(status);
}
