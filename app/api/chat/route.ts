// POST /api/chat — Gemini chat สำหรับผู้ใช้ทั่วไป (ถามเรื่องจองบัตร/คิว/การชำระเงิน)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { genai, buildUserSystemPrompt } from "@/lib/gemini";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

const bodySchema = z.object({
  message: z.string().min(1).max(500),
  pageContext: z.string().max(1000).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "model"]),
        parts: z.array(z.object({ text: z.string() })),
      })
    )
    .max(20)
    .optional()
    .default([]),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit({ key: `chat:ip:${ip}`, ...RATE_LIMIT });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "ส่งข้อความถี่เกินไป กรุณารอสักครู่" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const { message, pageContext, history } = parsed.data;

  try {
    const model = genai.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: buildUserSystemPrompt(pageContext),
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const text = result.response.text();

    return NextResponse.json({ reply: text });
  } catch (err) {
    console.error("[chat] Gemini error:", err);
    return NextResponse.json(
      { error: "ขณะนี้ผู้ช่วย AI ไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง" },
      { status: 503 }
    );
  }
}
