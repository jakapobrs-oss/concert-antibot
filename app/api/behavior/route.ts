// POST /api/behavior — รับ behavior features จาก client → วิเคราะห์ → เก็บ
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { analyzeBehavior } from "@/lib/behavior";
import { checkRateLimit } from "@/lib/rate-limit";

// rate limit: 60 ครั้ง/นาที ต่อ IP — client flush behavior เป็นช่วง ๆ อยู่แล้ว
// endpoint นี้ "ไม่ต้อง login" จึงต้องกัน spam เขียน DB + กันปั่นคะแนน anti-bot ของ session คนอื่น
const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

const bodySchema = z.object({
  sessionKey: z.string().min(1).max(64),
  mouseMoveCount: z.number().int().min(0),
  keyPressCount: z.number().int().min(0),
  mouseTimingVariance: z.number().min(0),
  mousePathEntropy: z.number().min(0),
  dwellTimeMs: z.number().int().min(0),
});

export async function POST(req: NextRequest) {
  // 🚦 rate limit ต่อ IP ก่อนทำอย่างอื่น (กัน spam endpoint ที่ไม่ต้อง auth)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit({ key: `behavior:ip:${ip}`, ...RATE_LIMIT });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "ส่งข้อมูลถี่เกินไป" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const f = parsed.data;
  const assessment = analyzeBehavior(f);

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  // upsert — sessionKey เดียวกันอัปเดต (client อาจ flush หลายครั้ง)
  await prisma.behaviorSession.upsert({
    where: { sessionKey: f.sessionKey },
    update: {
      mouseMoveCount: f.mouseMoveCount,
      keyPressCount: f.keyPressCount,
      mouseTimingVariance: f.mouseTimingVariance,
      mousePathEntropy: f.mousePathEntropy,
      dwellTimeMs: f.dwellTimeMs,
      behaviorScore: assessment.behaviorScore,
      isLikelyBot: assessment.isLikelyBot,
    },
    create: {
      sessionKey: f.sessionKey,
      userId: userId ? BigInt(userId) : null,
      mouseMoveCount: f.mouseMoveCount,
      keyPressCount: f.keyPressCount,
      mouseTimingVariance: f.mouseTimingVariance,
      mousePathEntropy: f.mousePathEntropy,
      dwellTimeMs: f.dwellTimeMs,
      behaviorScore: assessment.behaviorScore,
      isLikelyBot: assessment.isLikelyBot,
    },
  });

  return NextResponse.json({
    behaviorScore: assessment.behaviorScore,
    isLikelyBot: assessment.isLikelyBot,
  });
}
