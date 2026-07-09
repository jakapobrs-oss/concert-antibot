// POST /api/chat — Gemini chat สำหรับผู้ใช้ทั่วไป (ต้อง login)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { genai, buildUserSystemPrompt } from "@/lib/gemini";
import { checkRateLimit } from "@/lib/rate-limit";
import { auth } from "@/lib/auth";
import { isGeminiConfigured } from "@/lib/env";

// keyed on userId (ไม่ใช่ IP) — ไม่สามารถ bypass ด้วย XFF spoofing
const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

const bodySchema = z.object({
  message: z.string().min(1).max(500),
  // .nullish() ไม่ใช่ .optional(): widget ส่ง pageContext:null ตอนหน้าไม่มี context
  // ถ้าใช้ .optional() (รับแค่ undefined) จะ reject null → 400 ทุกข้อความ
  pageContext: z.string().max(1000).nullish(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "model"]),
        // §6 (Codex #1): bound parts[]/text — แฝดของ admin chat (§5 G2) ที่ user chat ยังไม่ได้แก้
        //   user turn = 1 part, message cap 500 → parts.max(1) + text.max(500) (เข้มกว่า admin)
        parts: z.array(z.object({ text: z.string().max(500) })).max(1),
      })
    )
    .max(20)
    .optional()
    .default([]),
});

export async function POST(req: NextRequest) {
  // ต้อง login — กัน anonymous quota drain + prompt injection
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "กรุณาเข้าสู่ระบบก่อนใช้งานผู้ช่วย AI" },
      { status: 401 }
    );
  }

  // §6 (Codex #2): ยังไม่ตั้ง GEMINI_API_KEY → ตอบชัดว่า AI ปิด ก่อนเผา rate-limit / เรียก Gemini ด้วย key ว่าง
  if (!isGeminiConfigured) {
    return NextResponse.json({ error: "ผู้ช่วย AI ยังไม่พร้อมใช้งาน" }, { status: 503 });
  }

  // rate limit ต่อ userId (ไม่ใช่ IP → XFF spoofing ไม่ได้ผล)
  const rl = await checkRateLimit({ key: `chat:user:${userId}`, ...RATE_LIMIT });
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
      model: "gemini-3.5-flash", // free-tier: Pro=quota 0, flash ฟรี → 3.5-flash flash ที่ใหม่/เก่งสุดที่ฟรี (2.5-flash = fallback)
      systemInstruction: buildUserSystemPrompt(pageContext),
      generationConfig: { maxOutputTokens: 600 },
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
