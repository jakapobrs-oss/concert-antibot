// ============================================================
// Queue control — runtime override สำหรับแอดมิน (เก็บใน Redis ปรับได้ไม่ต้อง restart)
// ============================================================
// แผงแอดมิน (app/(admin)/admin/queue) ใช้ตัวนี้สั่ง "หยุด/ปล่อยคิว" + ปรับ "ความจุ (cap)" สด ๆ
//   - paused flag: route /api/queue/status จะไม่เรียก admitNext ระหว่างหยุด (คิวค้างไว้ ไม่ปล่อยเพิ่ม)
//   - cap override: แทนค่า env.QUEUE_ADMIT_CAP เฉพาะคอนเสิร์ตนี้ (เช่นลด cap ตอนหน้างานล่ม)
import { redis } from "@/lib/redis";
import { env } from "@/lib/env";

const keys = {
  paused: (concertId: string) => `queue:${concertId}:paused`,
  capOverride: (concertId: string) => `queue:${concertId}:cap-override`,
};

// คิวถูกสั่งหยุดปล่อยชั่วคราวไหม (แอดมินกดหยุด)
export async function isQueuePaused(concertId: string): Promise<boolean> {
  return (await redis.get(keys.paused(concertId))) === "1";
}

export async function setQueuePaused(concertId: string, paused: boolean): Promise<void> {
  if (paused) await redis.set(keys.paused(concertId), "1");
  else await redis.del(keys.paused(concertId));
}

// cap ที่มีผลจริง: override ของแอดมิน (ถ้าตั้งไว้และ valid) มาก่อน ไม่งั้น fallback ค่า env
export async function getEffectiveCap(concertId: string): Promise<number> {
  const override = await redis.get(keys.capOverride(concertId));
  const n = override ? Number(override) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : env.QUEUE_ADMIT_CAP;
}

// ตั้ง/ล้าง cap override (null = กลับไปใช้ค่า env)
export async function setCapOverride(concertId: string, cap: number | null): Promise<void> {
  if (cap === null) await redis.del(keys.capOverride(concertId));
  else await redis.set(keys.capOverride(concertId), String(Math.floor(cap)));
}
