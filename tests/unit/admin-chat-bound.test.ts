// Regression: /api/admin/chat history bounds (Codex §5 #2 / G2)
// history[].parts + text ต้องมีเพดาน — กัน 1 request ยัดก้อนโตเลี่ยง cap 2000 ของ message
import { describe, it, expect, vi, beforeEach } from "vitest";

const { isVerifiedAdmin, checkRateLimit } = vi.hoisted(() => ({
  isVerifiedAdmin: vi.fn(),
  checkRateLimit: vi.fn(),
}));
vi.mock("@/lib/admin-guard", () => ({ isVerifiedAdmin }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/gemini", () => ({
  // chain: getGenerativeModel().startChat().sendMessage() → response.text()
  genai: {
    getGenerativeModel: vi.fn(() => ({
      startChat: vi.fn(() => ({
        sendMessage: vi.fn(async () => ({ response: { text: () => "ok" } })),
      })),
    })),
  },
  buildAdminSystemPrompt: vi.fn(() => "sys"),
}));

import { POST } from "@/app/api/admin/chat/route";
import { NextRequest } from "next/server";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/admin/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isVerifiedAdmin.mockResolvedValue(true); // ผ่าน admin gate
  checkRateLimit.mockResolvedValue({ allowed: true });
});

describe("admin/chat — history bounds (G2)", () => {
  it("text ใน history ยาวเกิน 2000 → 400 (schema reject ก่อนถึง Gemini)", async () => {
    const res = await POST(
      post({ message: "hi", history: [{ role: "user", parts: [{ text: "x".repeat(2001) }] }] })
    );
    expect(res.status).toBe(400);
  });

  it("parts ใน 1 entry เกิน 4 อัน → 400", async () => {
    const res = await POST(
      post({ message: "hi", history: [{ role: "user", parts: Array(5).fill({ text: "x" }) }] })
    );
    expect(res.status).toBe(400);
  });

  it("history ปกติ (สั้น) → ผ่าน schema → 200", async () => {
    const res = await POST(
      post({ message: "hi", history: [{ role: "user", parts: [{ text: "สวัสดี" }] }] })
    );
    expect(res.status).toBe(200);
  });
});
