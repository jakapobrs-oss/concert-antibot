// Admin — แก้ไขข้อมูลคอนเสิร์ต (rev 41): ชื่อ/รายละเอียด/สถานที่/วันเวลา/ช่วงขาย/จำกัดตั๋ว/สถานะ/slug/โปสเตอร์ + ลบ
//   โซน/ที่นั่งแก้ที่หน้า "จัดผังที่นั่งจากรูป" · รอบกดบัตรแก้ที่หน้ารายละเอียด (แยกกันตามเดิม)
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { toThaiDateTimeLocal } from "@/lib/local-datetime";
import { canDeleteConcert } from "@/lib/concert-form";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConcertEditForm } from "@/components/concert-edit-form";

export const dynamic = "force-dynamic";

export default async function EditConcertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(id) },
    include: { _count: { select: { orders: true, zones: true } } },
  });
  if (!concert) notFound();

  const paidOrderCount = await prisma.order.count({ where: { concertId: concert.id, status: "PAID" } });
  const deleteGate = canDeleteConcert({ orderCount: concert._count.orders });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Link
          href={`/admin/concerts/${id}`}
          className="text-sm text-fg-faint transition-colors hover:text-brand-300"
        >
          ← กลับไปหน้าคอนเสิร์ต
        </Link>

        <Card className="mt-3">
          <CardHeader>
            <CardTitle>แก้ไขคอนเสิร์ต</CardTitle>
            <p className="mt-1 text-sm text-fg-faint">
              #{id} · {concert._count.zones} โซน · คำสั่งซื้อ {concert._count.orders} รายการ (จ่ายแล้ว {paidOrderCount})
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <ConcertEditForm
              concertId={id}
              initial={{
                title: concert.title,
                description: concert.description,
                venue: concert.venue,
                eventAt: toThaiDateTimeLocal(concert.eventAt),
                saleStartAt: toThaiDateTimeLocal(concert.saleStartAt),
                saleEndAt: toThaiDateTimeLocal(concert.saleEndAt),
                maxTicketsPerUser: concert.maxTicketsPerUser,
                coverImageUrl: concert.coverImageUrl ?? "",
                slug: concert.slug,
                status: concert.status,
              }}
              orderCount={concert._count.orders}
              paidOrderCount={paidOrderCount}
              deleteBlockedReason={deleteGate.ok ? null : deleteGate.reason}
            />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
