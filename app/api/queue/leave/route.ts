// POST /api/queue/leave — ออกจากคิวเอง
import { NextRequest, NextResponse } from "next/server";
import { leaveQueue } from "@/lib/queue";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({ token: null }));
  if (!token) {
    return NextResponse.json({ error: "ต้องมี token" }, { status: 400 });
  }

  await leaveQueue(token);

  // อัปเดต audit ใน DB (best-effort)
  await prisma.queueToken
    .updateMany({ where: { token }, data: { status: "LEFT" } })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
