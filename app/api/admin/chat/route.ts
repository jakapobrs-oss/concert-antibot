// POST /api/admin/chat — Gemini chat สำหรับ admin (วิเคราะห์ bot log, ยอดขาย, การตั้งค่า)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { genai, buildAdminSystemPrompt } from "@/lib/gemini";
import { checkRateLimit } from "@/lib/rate-limit";
import { isVerifiedAdmin } from "@/lib/admin-guard";

const RATE_LIMIT = { limit: 40, windowMs: 60_000 };

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
  // .nullish() รับ null ด้วย (panel อาจส่ง null ตอนยังไม่มี context) — .optional() รับแค่ undefined
  pageContext: z.string().max(2000).nullish(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "model"]),
        // G2 (Codex §5 #2): bound parts[] + text — เดิม .max(30) แค่ array นอก แต่ parts/text ไม่จำกัด
        //   → 1 request ยัด text มหึมาเลี่ยง cap 2000 ของ message = เผา Gemini quota/cost + parse ก้อนโต
        parts: z.array(z.object({ text: z.string().max(2000) })).max(4),
      })
    )
    .max(30)
    .optional()
    .default([]),
});

export async function POST(req: NextRequest) {
  // F2: เช็ค role กับ DB จริง (ไม่เชื่อ JWT ค้าง)
  if (!(await isVerifiedAdmin())) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit({ key: `admin-chat:ip:${ip}`, ...RATE_LIMIT });
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
      systemInstruction: buildAdminSystemPrompt(pageContext),
      generationConfig: { maxOutputTokens: 1200 },
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const text = result.response.text();

    return NextResponse.json({ reply: text });
  } catch (err) {
    console.error("[admin-chat] Gemini error:", err);
    return NextResponse.json(
      { error: "ขณะนี้ผู้ช่วย AI ไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง" },
      { status: 503 }
    );
  }
}
