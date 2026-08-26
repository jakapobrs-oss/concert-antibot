// Health check — pure helpers (ไม่ import prisma/redis เพื่อให้ unit test ได้) ใช้โดย app/api/health/route.ts
//
// เหตุ (gap map 2026-08-27 ขั้น 4 ops): ไม่มี endpoint ให้ uptime monitor (UptimeRobot / Better Stack) ยิงเช็ค
//   → ระบบล่ม (Neon หลับ / Upstash หมดโควตา / Redis ETIMEDOUT) รู้ตอนลูกค้าบ่น
// กติกา:
//   - ตอบสั้น: { ok, db, redis } เท่านั้น — ไม่บอกเวอร์ชัน/host/ข้อความ error (กัน recon)
//   - ok = ทุกตัวผ่าน → 200 · ตัวใดตัวหนึ่งล้ม → 503 (monitor ส่วนใหญ่ถือ non-2xx = down)
//   - probe แต่ละตัวมี timeout สั้น ๆ (withTimeout) ไม่งั้น request แขวนจน function timeout เอง

export type ProbeState = "ok" | "fail";

export type HealthReport = {
  ok: boolean;
  db: ProbeState;
  redis: ProbeState;
};

export function summarizeHealth(dbOk: boolean, redisOk: boolean): { status: 200 | 503; body: HealthReport } {
  const ok = dbOk && redisOk;
  return {
    status: ok ? 200 : 503,
    body: { ok, db: dbOk ? "ok" : "fail", redis: redisOk ? "ok" : "fail" },
  };
}

// รอ promise ไม่เกิน ms — เกิน = reject (ผู้เรียก map เป็น fail) · เคลียร์ timer เสมอ ไม่ให้ handle ค้าง
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
