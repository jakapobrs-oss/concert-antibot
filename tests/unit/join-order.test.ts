// ============================================================
// Regression: /api/queue/join ต้องเช็ค auth + rate-limit "ก่อน" แตะ DB (Codex §2 #6)
// ============================================================
// เดิม prisma.concert.findUnique อยู่ก่อน gate → ยิง concertId ปลอมรัว ๆ กิน DB ฟรี (unauth, ไม่ติด limit)
// พิสูจน์ด้วยการ mock deps: request ที่ไม่ผ่าน gate ต้องไม่เรียก findUnique เลย
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock ทุก dependency ของ route (hoisted ให้ vi.mock ใช้ได้)
const { auth, concertFindUnique, checkRateLimit, acquireInflight, assessRequest, joinQueue } =
  vi.hoisted(() => ({
    auth: vi.fn(),
    concertFindUnique: vi.fn(),
    checkRateLimit: vi.fn(),
    acquireInflight: vi.fn(),
    assessRequest: vi.fn(),
    joinQueue: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    concert: { findUnique: concertFindUnique },
    botEvent: { create: vi.fn() },
    queueToken: { create: vi.fn() },
    behaviorSession: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/load-shed", () => ({ acquireInflight, releaseInflight: vi.fn() }));
vi.mock("@/lib/antibot", () => ({ assessRequest }));
vi.mock("@/lib/queue", () => ({ joinQueue }));
vi.mock("@/lib/get-ip", () => ({ getClientIp: () => "1.2.3.4" }));

import { POST } from "@/app/api/queue/join/route";
import { NextRequest } from "next/server";

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/queue/join", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("join order — DB findUnique ต้องอยู่หลัง auth+rate-limit (#6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireInflight.mockResolvedValue("slot-1"); // ผ่าน load-shed gate เสมอ
    assessRequest.mockResolvedValue({ action: "ALLOW", score: 0, signals: {} });
    joinQueue.mockResolvedValue({ token: "t", deduped: false, bucket: 0, random: 0 });
  });

  it("ไม่ login → 401 โดยไม่แตะ prisma.concert.findUnique", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(makeReq({ concertId: "999" }));
    expect(res.status).toBe(401);
    expect(concertFindUnique).not.toHaveBeenCalled();
  });

  it("ติด rate-limit → 429 โดยไม่แตะ prisma.concert.findUnique", async () => {
    auth.mockResolvedValue({ user: { id: "1" } });
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 1000 });
    const res = await POST(makeReq({ concertId: "999" }));
    expect(res.status).toBe(429);
    expect(concertFindUnique).not.toHaveBeenCalled();
  });

  it("positive control: ผ่าน auth+rate-limit แล้ว → แตะ DB จริง 1 ครั้ง", async () => {
    auth.mockResolvedValue({ user: { id: "1" } });
    checkRateLimit.mockResolvedValue({ allowed: true });
    concertFindUnique.mockResolvedValue(null); // ไม่พบคอนเสิร์ต → 404
    const res = await POST(makeReq({ concertId: "999" }));
    expect(concertFindUnique).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(404);
  });
});
