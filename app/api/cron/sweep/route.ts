// ============================================================
// Vercel Cron Endpoint — กวาด order ค้างทั้งระบบ คืนที่นั่งที่หมดเวลา
// ============================================================
// แทน scripts/sweep-orders.ts (ที่เดิมรันผ่าน cron ของ OS) — บน Vercel ใช้ Cron Jobs
// Vercel จะเรียก GET เส้นนี้ตาม schedule ใน vercel.json โดยแนบ header
//   Authorization: Bearer <CRON_SECRET>  (ถ้าตั้ง CRON_SECRET ใน env)
//
// หมายเหตุ: ตัวกวาดหลักจริง ๆ คือ on-read sweep ใน holdAndCreateOrder (กวาดตอนมีคนจอง)
//   cron เส้นนี้เป็นตัวเสริม กวาด "ทุกคอนเสิร์ต" เผื่อคอนเสิร์ตที่ไม่มีคนจองมานาน
import { NextResponse } from "next/server";
import { expireStaleOrders } from "@/lib/order-sweeper";

// Prisma + argon2 ใช้ Node API — บังคับ Node runtime (รันบน edge ไม่ได้)
export const runtime = "nodejs";
// ห้าม cache — ต้องรันสด คืนที่นั่งจริงทุกครั้ง
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // ตรวจ secret (G1 / Codex §5 #1 — fail-CLOSED บน production):
  //   เดิม if(secret){check} → prod ที่ "ลืมตั้ง" CRON_SECRET = endpoint เปลือย
  //   ใครก็ยิง GET กวาด order ทั้งระบบได้ (unauth DoS + crawler/prefetch trigger เพราะเป็น GET)
  //   ให้เข้ากับปรัชญา fail-closed ของ payment/turnstile: prod ต้องมี secret เสมอ
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";
  if (!secret) {
    // prod ไม่มี secret → ปฏิเสธ (ไม่ปล่อยเปลือย); dev ไม่มี secret → ยอมให้เรียกเพื่อความสะดวก
    if (isProd) {
      return NextResponse.json({ ok: false, error: "cron not configured" }, { status: 503 });
    }
  } else {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const started = Date.now();
  // ไม่ส่ง concertId = กวาดทั้งระบบ
  const cancelled = await expireStaleOrders();
  const ms = Date.now() - started;

  return NextResponse.json({ ok: true, cancelled, ms });
}
