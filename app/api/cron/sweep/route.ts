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
  // ตรวจ secret: ถ้าตั้ง CRON_SECRET ไว้ → ต้องมี Authorization ตรงกันเท่านั้น
  //   (กันคนนอกยิง endpoint กวาด order มั่ว ๆ) — ไม่ตั้ง = เปิดให้เรียกได้ (dev)
  const secret = process.env.CRON_SECRET;
  if (secret) {
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
