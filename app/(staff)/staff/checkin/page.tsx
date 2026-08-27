// จุดสแกนเช็คอินหน้างาน (docs/19 Phase 2 · ย้ายมาจาก /admin/checkin ใน rev 42)
// สิทธิ์: STAFF หรือ ADMIN — middleware + (staff)/layout.tsx เช็ค 2 ชั้น + action checkInTicket เช็คซ้ำอีกชั้น
// จุดสแกนต้อง "เลือกงาน" ก่อน (?concert=<id>) — server ปฏิเสธตั๋วของงานอื่น/นอกกรอบเวลา (audit rev 42, lib/checkin-policy.ts)
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { formatThaiDate } from "@/lib/format";
import { isConcertSelectableAtGate } from "@/lib/checkin-policy";
import { SiteHeader } from "@/components/site-header";
import { CheckinClient } from "@/components/checkin-client";
import { CheckinConcertPicker, type GateConcertOption } from "@/components/checkin-concert-picker";

export const dynamic = "force-dynamic";

export default async function StaffCheckinPage({
  searchParams,
}: {
  searchParams: Promise<{ concert?: string }>;
}) {
  const { concert: concertParam } = await searchParams;
  const now = new Date();
  const closeAfterMs = env.CHECKIN_CLOSE_AFTER_HOURS * 60 * 60 * 1000;

  // งานที่ยังไม่เลยกรอบปิดสแกน (งานที่จบไปแล้วไม่โชว์ให้เลือกผิด) — ฉบับร่าง/จบงาน ไม่เอา
  const concerts = await prisma.concert.findMany({
    where: {
      status: { in: ["SCHEDULED", "ON_SALE", "SOLD_OUT"] },
      eventAt: { gte: new Date(now.getTime() - closeAfterMs) },
    },
    orderBy: { eventAt: "asc" },
    take: 50,
    select: { id: true, title: true, eventAt: true, venue: true },
  });
  const options: GateConcertOption[] = concerts
    .filter((c) => isConcertSelectableAtGate({ eventAt: c.eventAt, now, closeAfterMs }))
    .map((c) => ({ id: c.id.toString(), title: c.title, label: `${formatThaiDate(c.eventAt)} · ${c.venue}` }));
  const selected = options.find((o) => o.id === concertParam) ?? null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl px-4 py-8">
        <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-fg">
          เช็คอินหน้างาน
        </h1>
        <p className="mb-6 text-sm text-fg-faint">
          1 บัตรเข้าได้ครั้งเดียว — ระบบโชว์ชื่อผู้ถือให้เทียบบัตรประชาชน · ใช้กล้องมือถือ หรือปืนสแกนก็ได้
        </p>
        <div className="space-y-4">
          <CheckinConcertPicker options={options} selectedId={selected?.id ?? null} />
          <CheckinClient concert={selected} />
        </div>
      </main>
    </>
  );
}
