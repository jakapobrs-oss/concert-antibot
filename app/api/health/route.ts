// GET /api/health — ให้ uptime monitor ยิงเช็ค (ไม่ต้อง auth)
//   ตรวจ 2 อย่างที่ระบบขาดไม่ได้: Postgres (SELECT 1) + Redis (PING) → 200 { ok:true, db:"ok", redis:"ok" } / 503 ถ้าตัวใดล้ม
//   ไม่เปิดเผยรายละเอียด (เวอร์ชัน/ข้อความ error) — พอให้รู้ว่า "ล่มตรงไหน" ระดับหยาบเท่านั้น
//   rate-limit เบา ๆ ต่อ IP กันเอาไปยิงเป็น load generator; ถ้า Redis ล่มจน rate-limit ทำงานไม่ได้ก็ยัง probe ต่อ
//   (ไม่งั้น health จะรายงานไม่ได้ตอนที่จำเป็นที่สุด)
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromXff } from "@/lib/get-ip";
import { summarizeHealth, withTimeout } from "@/lib/health";

export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 3000;
const RATE_LIMIT = { limit: 30, windowMs: 60_000 }; // monitor ทั่วไปยิงทุก 1–5 นาที — 30/นาที เหลือเฟือ
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const ip = clientIpFromXff(req.headers.get("x-forwarded-for"));
  try {
    const rl = await withTimeout(checkRateLimit({ key: `health:ip:${ip}`, ...RATE_LIMIT }), PROBE_TIMEOUT_MS);
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
    }
  } catch {
    // Redis ล่ม/ช้า → ข้าม rate-limit แล้วไปรายงาน redis:fail ด้านล่างแทน
  }

  const [dbOk, redisOk] = await Promise.all([
    withTimeout(prisma.$queryRaw`SELECT 1`, PROBE_TIMEOUT_MS).then(
      () => true,
      () => false
    ),
    withTimeout(redis.ping(), PROBE_TIMEOUT_MS).then(
      (reply) => reply === "PONG",
      () => false
    ),
  ]);

  const { status, body } = summarizeHealth(dbOk, redisOk);
  return NextResponse.json(body, { status, headers: NO_STORE });
}
