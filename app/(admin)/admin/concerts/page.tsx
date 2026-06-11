// Admin — รายการคอนเสิร์ตทั้งหมด + เปลี่ยนสถานะ (โทนเวทีมืด)
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatThaiDate } from "@/lib/format";
import { Plus } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateConcertStatus } from "@/app/actions/concert";

export const dynamic = "force-dynamic";

// tone ของ Badge ตามสถานะคอนเสิร์ต
const statusTone = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  ON_SALE: "success",
  SOLD_OUT: "danger",
  ENDED: "neutral",
} as const;

const statusLabel: Record<string, string> = {
  DRAFT: "ฉบับร่าง",
  SCHEDULED: "ตั้งเวลา",
  ON_SALE: "กำลังขาย",
  SOLD_OUT: "เต็มแล้ว",
  ENDED: "จบงาน",
};

export default async function AdminConcertsPage() {
  const concerts = await prisma.concert.findMany({
    include: { _count: { select: { zones: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">จัดการคอนเสิร์ต</h1>
          <Link href="/admin/concerts/new">
            <Button leftIcon={<Plus className="size-4" />}>สร้างใหม่</Button>
          </Link>
        </div>

        {concerts.length === 0 ? (
          <p className="py-12 text-center text-fg-faint">ยังไม่มีคอนเสิร์ต</p>
        ) : (
          <div className="space-y-3">
            {concerts.map((c) => (
              <div
                key={c.id.toString()}
                className="rounded-xl border border-fg/10 bg-ink-850 p-4 transition-colors hover:border-fg/20"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/concerts/${c.id.toString()}`}
                        className="truncate font-display font-semibold text-fg hover:text-brand-300"
                      >
                        {c.title}
                      </Link>
                      <Badge tone={statusTone[c.status as keyof typeof statusTone] ?? "neutral"}>
                        {statusLabel[c.status] ?? c.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-fg-faint">
                      {c.venue} · {formatThaiDate(c.eventAt)} · {c._count.zones} โซน
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* toggle publish: DRAFT/SCHEDULED → ON_SALE, ON_SALE → DRAFT */}
                    {c.status !== "ON_SALE" ? (
                      <form
                        action={async () => {
                          "use server";
                          await updateConcertStatus(c.id.toString(), "ON_SALE");
                        }}
                      >
                        <Button size="sm" type="submit">เปิดขาย</Button>
                      </form>
                    ) : (
                      <form
                        action={async () => {
                          "use server";
                          await updateConcertStatus(c.id.toString(), "DRAFT");
                        }}
                      >
                        <Button size="sm" variant="outline" type="submit">ปิดขาย</Button>
                      </form>
                    )}
                    <Link href={`/concerts/${c.slug}`}>
                      <Button size="sm" variant="ghost">ดูหน้าเว็บ</Button>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
