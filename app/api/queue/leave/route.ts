// POST /api/queue/leave — ออกจากคิวเอง
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { leaveQueue } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/get-ip";

const RATE_LIMIT = { limit: 10, windowMs: 60_000 };

const bodySchema = z.object({
  token: z.string().min(1).max(128),
});

export async function POST(req: NextRequest) {
  // rate limit — กัน mass-evict tokens คนอื่น
  const ip = getClientIp(req);
  const rl = await checkRateLimit({ key: `queue_leave:ip:${ip}`, ...RATE_LIMIT });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "ส่งคำขอถี่เกินไป" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "ต้องมี token" }, { status: 400 });
  }

  const { token } = parsed.data;

  // ต้อง login — join บังคับ login อยู่แล้ว = token ทุกใบผูกกับผู้ใช้ จึงเช็คความเป็นเจ้าของได้เสมอ
  //   เดิมข้ามเช็คตอนไม่ login (`if (userId)`) → logout แล้วยิง token เหยื่อ = เตะเขาออกจากคิวได้ (auth bypass)
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  }
  const { redis } = await import("@/lib/redis");
  const owner = await redis.hget(`queue:token:${token}`, "userId");
  // เจ้าของ token ต้องตรงกับผู้ใช้ปัจจุบัน (owner ว่าง = token ตายแล้ว → leaveQueue เป็น no-op ปลอดภัย)
  if (owner && owner !== userId) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ยกเลิกคิวนี้" }, { status: 403 });
  }

  await leaveQueue(token);

  await prisma.queueToken
    .updateMany({ where: { token }, data: { status: "LEFT" } })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
