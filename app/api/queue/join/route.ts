// POST /api/queue/join — เข้าคิว virtual waiting room
// body: { concertId, fingerprintHash? }
// คืน: { token } — client เก็บไว้ poll สถานะ
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { joinQueue } from "@/lib/queue";
import { assessRequest } from "@/lib/antibot";
import { checkRateLimit } from "@/lib/rate-limit";
import { acquireInflight, releaseInflight } from "@/lib/load-shed";

const bodySchema = z.object({
  concertId: z.string().min(1),
  fingerprintHash: z.string().optional(),
  // Turnstile token จาก widget ฝั่ง client
  turnstileToken: z.string().optional(),
});

// rate limit: เข้าคิวได้สูงสุด 10 ครั้ง/นาที ต่อ IP (กันยิงรัว)
const RATE_LIMIT = { limit: 10, windowMs: 60_000 };

// peak-load: เพดาน request ที่ทำพร้อมกันทั้งระบบ (load shedding) — เกินนี้ตอบ 503 ทันที
const MAX_INFLIGHT_JOINS = Number(process.env.MAX_INFLIGHT_JOINS ?? 500);
// peak-load A/B: ตั้ง "1" เพื่อเขียน audit แบบ blocking (ของเดิม) — ใช้เทียบ before/after
//   ค่า default = เขียนแบบ non-blocking ผ่าน after() (เอา DB ออกจาก critical path)
const SYNC_AUDIT = process.env.QUEUE_SYNC_AUDIT === "1";

// เขียน audit log แบบไม่บล็อก response — รันหลังส่ง response แล้ว (after) เว้นแต่โหมด A/B
async function writeAudit(label: string, fn: () => Promise<unknown>) {
  if (SYNC_AUDIT) {
    await fn().catch((e) => console.error(`[audit:${label}]`, e));
  } else {
    after(() => fn().catch((e) => console.error(`[audit:${label}]`, e)));
  }
}

export async function POST(req: NextRequest) {
  // 🛑 load shedding — ถ้า in-flight เกินเพดาน ปฏิเสธเร็ว ๆ (กันระบบล่มทั้งหมด)
  if (!(await acquireInflight("queue_join", MAX_INFLIGHT_JOINS))) {
    return NextResponse.json(
      { error: "ระบบกำลังหนาแน่นมาก กรุณารอสักครู่แล้วลองใหม่", action: "OVERLOADED" },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }
  try {
    return await handleJoin(req);
  } finally {
    await releaseInflight("queue_join");
  }
}

async function handleJoin(req: NextRequest): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const { concertId, fingerprintHash, turnstileToken } = parsed.data;

  // ตรวจว่าคอนเสิร์ตมีอยู่ + กำลังเปิดขาย (กันเข้าคิวคอนเสิร์ตที่ยังไม่ขาย)
  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(concertId) },
    select: { status: true },
  });
  if (!concert) {
    return NextResponse.json({ error: "ไม่พบคอนเสิร์ต" }, { status: 404 });
  }
  if (concert.status !== "ON_SALE") {
    return NextResponse.json({ error: "คอนเสิร์ตนี้ยังไม่เปิดขาย" }, { status: 403 });
  }

  // ดึง user (ถ้า login) + ip
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const userAgent = req.headers.get("user-agent");

  // ============================================================
  // 🚦 Rate Limit (Layer 2) — กันยิงรัวต่อ IP
  // ============================================================
  const rlKey = `queue_join:ip:${ip ?? "unknown"}`;
  const rl = await checkRateLimit({ key: rlKey, ...RATE_LIMIT });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: "คุณเข้าคิวบ่อยเกินไป กรุณารอสักครู่",
        action: "RATE_LIMITED",
        retryAfterMs: rl.retryAfterMs,
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  // ============================================================
  // 🛡️ Anti-Bot Layer 1 — ประเมินก่อนเข้าคิว
  // ============================================================
  const assessment = await assessRequest({
    turnstileToken,
    userAgent,
    headers: req.headers,
    fingerprintHash,
    ip,
  });

  // บันทึก bot event ทุกครั้ง (สำหรับ dashboard + thesis)
  // peak-load: ไม่ await — เป็น audit ไม่ใช่ critical path (สถานะคิวจริงอยู่ใน Redis)
  // เขียนหลังส่ง response ผ่าน after() เพื่อเอา DB write ออกจาก hot path ตอน flash-crowd
  await writeAudit("botEvent", () =>
    prisma.botEvent.create({
      data: {
        userId: userId ? BigInt(userId) : null,
        ip: ip ?? null,
        userAgent: userAgent ?? null,
        fingerprintHash: fingerprintHash ?? null,
        score: assessment.score,
        action: assessment.action,
        // cast เป็น plain object ให้ตรง Prisma Json input type
        signals: { ...assessment.signals },
        checkpoint: "queue_join",
      },
    })
  );

  // BLOCK → ปฏิเสธทันที (มั่นใจว่าบอท)
  if (assessment.action === "BLOCK") {
    return NextResponse.json(
      { error: "ระบบตรวจพบกิจกรรมที่ผิดปกติ", action: "BLOCK", score: assessment.score },
      { status: 403 }
    );
  }

  // CHALLENGE → ขอให้ทำ Turnstile (ไม่ block — กัน false positive กับคนจริง)
  if (assessment.action === "CHALLENGE") {
    return NextResponse.json(
      { error: "กรุณายืนยันว่าคุณไม่ใช่บอท", action: "CHALLENGE", score: assessment.score },
      { status: 428 } // 428 Precondition Required
    );
  }

  // ALLOW → เข้าคิวได้
  const result = await joinQueue({ concertId, userId, fingerprintHash, ip });

  // บันทึก audit ลง DB เฉพาะตอนสร้าง slot ใหม่ (non-blocking — ดู writeAudit)
  // ถ้า deduped (เปิดหลายแท็บ → คืน token เดิม) ข้ามไป กัน unique constraint ชน
  if (!result.deduped) {
    await writeAudit("queueToken", () =>
      prisma.queueToken.create({
        data: {
          token: result.token,
          concertId: BigInt(concertId),
          userId: userId ? BigInt(userId) : null,
          fingerprintHash: fingerprintHash ?? null,
          ip: ip ?? null,
          timeBucket: BigInt(result.bucket),
          randomScore: result.random,
          status: "WAITING",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 ชม
        },
      })
    );
  }

  // deduped=true → บอก client ว่าใช้คิวเดิม (เปิดหลายแท็บไม่ได้ slot เพิ่ม)
  return NextResponse.json({ token: result.token, deduped: result.deduped });
}
