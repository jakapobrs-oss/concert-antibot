// Regression: /api/cron/sweep auth (Codex §5 #1 / G1 fail-closed)
// prod ที่ลืมตั้ง CRON_SECRET ต้อง "ปฏิเสธ" ไม่ใช่เปิดโล่งให้ใครก็กวาด order ทั้งระบบ
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { expireStaleOrders } = vi.hoisted(() => ({ expireStaleOrders: vi.fn() }));
vi.mock("@/lib/order-sweeper", () => ({ expireStaleOrders }));

import { GET } from "@/app/api/cron/sweep/route";

function req(auth?: string) {
  return new Request("http://localhost/api/cron/sweep", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  expireStaleOrders.mockResolvedValue(3);
});
afterEach(() => vi.unstubAllEnvs());

describe("cron/sweep — fail-closed (G1)", () => {
  it("prod + ไม่มี CRON_SECRET → 503 โดยไม่กวาด (fail-closed)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(expireStaleOrders).not.toHaveBeenCalled();
  });

  it("dev + ไม่มี secret → 200 กวาดได้ (สะดวกตอน dev)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(expireStaleOrders).toHaveBeenCalledTimes(1);
  });

  it("มี secret + Authorization ผิด → 401 ไม่กวาด", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(expireStaleOrders).not.toHaveBeenCalled();
  });

  it("มี secret + Authorization ถูก → 200 กวาด", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(expireStaleOrders).toHaveBeenCalledTimes(1);
  });
});
