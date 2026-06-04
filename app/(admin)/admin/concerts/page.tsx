// Admin — รายการคอนเสิร์ตทั้งหมด + เปลี่ยนสถานะ
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatThaiDate } from "@/lib/format";
import { Plus } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold tracking-tight">จัดการคอนเสิร์ต</h1>
          <Link href="/admin/concerts/new">
            <Button leftIcon={<Plus className="size-4" />}>สร้างใหม่</Button>
          </Link>
        </div>

        {concerts.length === 0 ? (
          <p className="text-neutral-500 text-center py-12">ยังไม่มีคอนเสิร์ต</p>
        ) : (
          <div className="space-y-3">
            {concerts.map((c) => (
              <Card key={c.id.toString()} className="p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{c.title}</h3>
                      <Badge tone={statusTone[c.status as keyof typeof statusTone] ?? "neutral"}>
                        {statusLabel[c.status] ?? c.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-neutral-500">
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
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
