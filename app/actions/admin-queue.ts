"use server";

// ============================================================
// Admin queue control actions (docs/19 queue-runner)
// ============================================================
// แผงแอดมินคุมคิว: หยุด/ปล่อยคิว + ปรับความจุห้องเลือกที่นั่ง (cap) สด ๆ ไม่ต้อง restart
//   RBAC: middleware + (admin)/layout เช็ค ADMIN แล้ว — ที่นี่เช็คซ้ำ (defense in depth เหมือน tickets.ts)
import { z } from "zod";
import { isVerifiedAdmin } from "@/lib/admin-guard";
import { setQueuePaused, setCapOverride } from "@/lib/queue-control";

// F2 (Codex §4 #2): เช็ค role กับ DB จริง (ไม่เชื่อ JWT ที่ค้างได้ถึง 30 วัน)
async function isAdmin(): Promise<boolean> {
  return isVerifiedAdmin();
}

const idSchema = z.string().regex(/^\d+$/, "concertId ไม่ถูกต้อง");

export type QueueControlResult = { ok: true } | { ok: false; error: string };

// หยุด/ปล่อยคิว — ระหว่างหยุด route จะไม่ปล่อยคนเข้าเพิ่ม (คิวค้างไว้)
export async function setQueuePausedAction(input: {
  concertId: string;
  paused: boolean;
}): Promise<QueueControlResult> {
  if (!(await isAdmin())) return { ok: false, error: "ต้องเป็นแอดมิน" };
  const parsed = idSchema.safeParse(input.concertId);
  if (!parsed.success) return { ok: false, error: "concertId ไม่ถูกต้อง" };
  await setQueuePaused(parsed.data, input.paused);
  return { ok: true };
}

// ปรับความจุ (cap) เฉพาะคอนเสิร์ตนี้ — null = ล้าง override กลับไปใช้ค่า env
export async function setQueueCapAction(input: {
  concertId: string;
  cap: number | null;
}): Promise<QueueControlResult> {
  if (!(await isAdmin())) return { ok: false, error: "ต้องเป็นแอดมิน" };
  const parsed = idSchema.safeParse(input.concertId);
  if (!parsed.success) return { ok: false, error: "concertId ไม่ถูกต้อง" };
  if (input.cap !== null && (!Number.isInteger(input.cap) || input.cap < 1 || input.cap > 100000)) {
    return { ok: false, error: "cap ต้องเป็นจำนวนเต็ม 1–100000" };
  }
  await setCapOverride(parsed.data, input.cap);
  return { ok: true };
}
