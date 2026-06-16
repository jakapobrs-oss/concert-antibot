// POST /api/admin/chat — Gemini chat สำหรับ admin (วิเคราะห์ bot log, ยอดขาย, การตั้งค่า)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { genai, ADMIN_SYSTEM_PROMPT } from "@/lib/gemini";
import { checkRateLimit } from "@/lib/rate-limit";
import { auth } from "@/lib/auth";

const RATE_LIMIT = { limit: 40, windowMs: 60_000 };

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "model"]),
        parts: z.array(z.object({ text: z.string() })),
      })
    )
    .max(30)
    .optional()
    .default([]),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit({ key: `admin-chat:ip:${ip}`, ...RATE_LIMIT });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "ส่งข้อความถี่เกินไป กรุณารอสักครู่" },
      { status: 429 }
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const { message, history } = parsed.data;

  try {
    const model = genai.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: ADMIN_SYSTEM_PROMPT,
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
