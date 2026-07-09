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
  // 🔒 บังคับ login ก่อน (Codex §3 #1/#2)
  //   เดิม endpoint นี้ "ไม่ auth" ทำให้:
  //   (#1) rate-limit ผูก x-forwarded-for ตัวซ้ายสุดที่ปลอมได้ → ยิงรัวไม่จำกัด
  //        สร้าง behavior_sessions row ถาวร (ไม่มี TTL/cleanup) = DB write DoS
  //   (#2) sessionKey (=fingerprint) client เลือกเอง + ไม่เช็ค owner → เขียนทับ verdict ของคนอื่นได้ (poison)
  //   waiting room เรียก endpoint นี้ตอนอยู่ในคิว (ต้อง login แล้วเสมอ) → บังคับ auth ไม่กระทบ flow จริง
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  // 🚦 rate limit ผูก userId (ไม่ใช่ IP ที่ปลอมได้) — กัน spam เขียน DB
  const rl = await checkRateLimit({ key: `behavior:user:${userId}`, ...RATE_LIMIT });
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
  const uid = BigInt(userId);

  // upsert — ผูก userId ทุกครั้ง (รวม update) เพื่อให้ row สะท้อน "เจ้าของจริง"
  //   ฝั่งบังคับใช้ (queue/join) lookup แบบ scope userId → row ที่คนอื่น squat ด้วย fingerprint เรา จะไม่ match (poison ไร้ผล)
  await prisma.behaviorSession.upsert({
    where: { sessionKey: f.sessionKey },
    update: {
      userId: uid,
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
      userId: uid,
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
