// Regression: /api/chat (user chat) history bounds (Codex §6 #1)
// แฝดของ admin-chat-bound — user chat ต้อง bound parts[]/text ด้วย (เดิมพลาด แก้แค่ admin ใน §5)
import { describe, it, expect, vi, beforeEach } from "vitest";

const { auth, checkRateLimit } = vi.hoisted(() => ({ auth: vi.fn(), checkRateLimit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/env", () => ({ isGeminiConfigured: true }));
vi.mock("@/lib/gemini", () => ({
  genai: {
    getGenerativeModel: vi.fn(() => ({
      startChat: vi.fn(() => ({
        sendMessage: vi.fn(async () => ({ response: { text: () => "ok" } })),
      })),
    })),
  },
  buildUserSystemPrompt: vi.fn(() => "sys"),
}));

import { POST } from "@/app/api/chat/route";
import { NextRequest } from "next/server";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "7" } });
  checkRateLimit.mockResolvedValue({ allowed: true });
});

describe("user chat — history bounds (§6 #1)", () => {
  it("text ใน history ยาวเกิน 500 → 400", async () => {
    const res = await POST(post({ message: "hi", history: [{ role: "user", parts: [{ text: "x".repeat(501) }] }] }));
    expect(res.status).toBe(400);
  });

  it("parts เกิน 1 อัน → 400", async () => {
    const res = await POST(post({ message: "hi", history: [{ role: "user", parts: [{ text: "a" }, { text: "b" }] }] }));
    expect(res.status).toBe(400);
  });

  it("history ปกติ → 200", async () => {
    const res = await POST(post({ message: "hi", history: [{ role: "user", parts: [{ text: "สวัสดี" }] }] }));
    expect(res.status).toBe(200);
  });

  it("ไม่ login → 401", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(post({ message: "hi" }));
    expect(res.status).toBe(401);
  });
});
