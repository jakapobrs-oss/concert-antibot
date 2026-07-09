// ============================================================
// Regression: Anti-bot Part 3 (Codex review §3) — behavior/escalation wiring
// ============================================================
// พิสูจน์ 3 เรื่องด้วยการ mock deps ของ route:
//   [join #2 loop]   ผ่าน Turnstile จริงแล้ว → "ห้าม" re-escalate จาก behavior (ตัด 428 วนไม่จบ)
//   [join #2 poison] lookup behavior แบบ scope userId → row ที่คนอื่น squat ด้วย fingerprint เรา ไม่ match
//   [behavior #1/#2] /api/behavior บังคับ login (401) + ผูก userId กับ row + rate-limit ผูก user
import { describe, it, expect, vi, beforeEach } from "vitest";

// เปิดโหมด audit แบบ blocking (await) แทน after() — กัน "after() outside request scope" ใน unit env
vi.hoisted(() => {
  process.env.QUEUE_SYNC_AUDIT = "1";
});

const {
  auth,
  checkRateLimit,
  acquireInflight,
  assessRequest,
  joinQueue,
  concertFindUnique,
  behaviorFindFirst,
  behaviorUpsert,
  botEventCreate,
  queueTokenCreate,
} = vi.hoisted(() => ({
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  acquireInflight: vi.fn(),
  assessRequest: vi.fn(),
  joinQueue: vi.fn(),
  concertFindUnique: vi.fn(),
  behaviorFindFirst: vi.fn(),
  behaviorUpsert: vi.fn(),
  botEventCreate: vi.fn(),
  queueTokenCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/load-shed", () => ({ acquireInflight, releaseInflight: vi.fn() }));
vi.mock("@/lib/antibot", () => ({ assessRequest }));
vi.mock("@/lib/queue", () => ({ joinQueue }));
vi.mock("@/lib/get-ip", () => ({ getClientIp: () => "1.2.3.4" }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    concert: { findUnique: concertFindUnique },
    botEvent: { create: botEventCreate },
    queueToken: { create: queueTokenCreate },
    behaviorSession: { findFirst: behaviorFindFirst, upsert: behaviorUpsert },
  },
}));

import { POST as joinPOST } from "@/app/api/queue/join/route";
import { POST as behaviorPOST } from "@/app/api/behavior/route";
import { NextRequest } from "next/server";

function makeReq(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("§3 join — behavior escalation (loop fix + poison scope)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireInflight.mockResolvedValue("slot-1");
    checkRateLimit.mockResolvedValue({ allowed: true });
    concertFindUnique.mockResolvedValue({ status: "ON_SALE" });
    joinQueue.mockResolvedValue({ token: "tok", deduped: false, bucket: 0, random: 0 });
    botEventCreate.mockResolvedValue({});
    queueTokenCreate.mockResolvedValue({});
    auth.mockResolvedValue({ user: { id: "7" } });
  });

  it("#2 loop: ผ่าน Turnstile จริงแล้ว → ไม่ re-escalate (ไม่แตะ behaviorSession) → ALLOW เข้าคิว", async () => {
    // Layer1 = ALLOW และ signal turnstile = "pass" (เพิ่งแก้ challenge สำเร็จ)
    assessRequest.mockResolvedValue({ action: "ALLOW", score: 0, signals: { turnstile: "pass" } });
    behaviorFindFirst.mockResolvedValue({ isLikelyBot: true }); // ต่อให้มี row botlike ก็ต้องไม่ถูกอ่าน

    const res = await joinPOST(makeReq("/api/queue/join", { concertId: "1", fingerprintHash: "fp1", turnstileToken: "x" }));

    expect(behaviorFindFirst).not.toHaveBeenCalled(); // ← หัวใจ: ตัด loop
    expect(joinQueue).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it("#2 loop: ยังไม่ผ่าน Turnstile + row botlike → escalate เป็น CHALLENGE (428)", async () => {
    assessRequest.mockResolvedValue({ action: "ALLOW", score: 0, signals: { turnstile: "missing" } });
    behaviorFindFirst.mockResolvedValue({ isLikelyBot: true });

    const res = await joinPOST(makeReq("/api/queue/join", { concertId: "1", fingerprintHash: "fp1" }));

    expect(behaviorFindFirst).toHaveBeenCalledTimes(1);
    expect(joinQueue).not.toHaveBeenCalled();
    expect(res.status).toBe(428);
  });

  it("#2 poison: lookup behavior ผูก userId ของผู้เรียก (ไม่ใช่ sessionKey ลอย ๆ)", async () => {
    assessRequest.mockResolvedValue({ action: "ALLOW", score: 0, signals: { turnstile: "missing" } });
    behaviorFindFirst.mockResolvedValue(null);

    await joinPOST(makeReq("/api/queue/join", { concertId: "1", fingerprintHash: "fp1" }));

    expect(behaviorFindFirst).toHaveBeenCalledTimes(1);
    const arg = behaviorFindFirst.mock.calls[0][0];
    expect(arg.where.sessionKey).toBe("fp1");
    expect(arg.where.userId).toBe(BigInt("7")); // ← scope userId = poison ข้าม user ไม่ match
  });
});

describe("§3 /api/behavior — auth gate + userId binding (#1 DoS / #2 poison ต้นทาง)", () => {
  const goodBody = {
    sessionKey: "fp1",
    mouseMoveCount: 10,
    keyPressCount: 2,
    mouseTimingVariance: 500,
    mousePathEntropy: 0.6,
    dwellTimeMs: 4000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ allowed: true });
    behaviorUpsert.mockResolvedValue({});
  });

  it("ไม่ login → 401 โดยไม่แตะ DB (ปิด unauth write DoS)", async () => {
    auth.mockResolvedValue(null);
    const res = await behaviorPOST(makeReq("/api/behavior", goodBody));
    expect(res.status).toBe(401);
    expect(behaviorUpsert).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("login แล้ว → rate-limit ผูก user + upsert ผูก userId ทั้ง create/update", async () => {
    auth.mockResolvedValue({ user: { id: "7" } });
    const res = await behaviorPOST(makeReq("/api/behavior", goodBody));
    expect(res.status).toBe(200);

    // rate-limit key ผูก user ไม่ใช่ IP ที่ปลอมได้
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "behavior:user:7" })
    );
    // row ผูก userId เจ้าของจริงทั้งสองทาง
    const arg = behaviorUpsert.mock.calls[0][0];
    expect(arg.where.sessionKey).toBe("fp1");
    expect(arg.create.userId).toBe(BigInt("7"));
    expect(arg.update.userId).toBe(BigInt("7"));
  });
});
