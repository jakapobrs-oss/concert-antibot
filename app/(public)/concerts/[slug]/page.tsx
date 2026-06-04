// Concert detail page — รายละเอียด + ปุ่มไปหน้า seat map
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, CalendarDays, Ticket, Music2, ArrowRight, Clock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatTHB, formatThaiDate } from "@/lib/format";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const revalidate = 60;

export default async function ConcertDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const concert = await prisma.concert.findUnique({
    where: { slug },
    include: {
      zones: {
        include: {
          _count: { select: { seats: { where: { status: "AVAILABLE" } } } },
        },
        orderBy: { price: "desc" },
      },
    },
  });

  if (!concert) notFound();

  const isOnSale = concert.status === "ON_SALE";
  const saleNotYet = concert.status === "SCHEDULED";

  return (
    <>
      <SiteHeader />

      {/* Hero — พื้นเวที + ชื่อคอนเสิร์ตซ้อนบน */}
      <section className="bg-stage relative overflow-hidden">
        {concert.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={concert.coverImageUrl}
            alt={concert.title}
            className="absolute inset-0 size-full object-cover opacity-40"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-white/10">
            <Music2 className="size-40" />
          </div>
        )}
        <div className="relative mx-auto max-w-4xl px-4 py-16 sm:py-20">
          <div className="mb-3">
            {isOnSale && <Badge tone="danger" dot>กำลังขาย</Badge>}
            {saleNotYet && <Badge tone="info">เร็ว ๆ นี้</Badge>}
            {!isOnSale && !saleNotYet && <Badge tone="neutral">ปิดการขาย</Badge>}
          </div>
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-5xl">
            {concert.title}
          </h1>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/75">
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4 text-brand-400" /> {concert.venue}
            </span>
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-4 text-brand-400" /> {formatThaiDate(concert.eventAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <Ticket className="size-4 text-brand-400" /> จำกัด {concert.maxTicketsPerUser} ใบ/บัญชี
            </span>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
          {/* รายละเอียด + โซน */}
          <div className="space-y-8">
            <div>
              <h2 className="mb-3 text-lg font-semibold text-neutral-900">เกี่ยวกับงานนี้</h2>
              <p className="whitespace-pre-line leading-relaxed text-neutral-600">
                {concert.description}
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold text-neutral-900">โซนที่นั่งและราคา</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {concert.zones.map((z) => {
                  const left = z._count.seats;
                  const ratio = z.totalSeats > 0 ? left / z.totalSeats : 0;
                  return (
                    <div
                      key={z.id.toString()}
                      className="rounded-xl border border-neutral-200 bg-white p-4"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className="size-3 rounded-full ring-2 ring-white"
                          style={{ backgroundColor: z.color, boxShadow: `0 0 0 1px ${z.color}40` }}
                        />
                        <h3 className="font-semibold text-neutral-900">{z.name}</h3>
                      </div>
                      {z.description && (
                        <p className="mb-3 text-sm text-neutral-500">{z.description}</p>
                      )}
                      <p className="text-xl font-bold text-brand-600">
                        {formatTHB(z.price.toString())}
                      </p>
                      <div className="mt-2.5">
                        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                          <div
                            className={`h-full rounded-full ${
                              ratio > 0.3 ? "bg-success" : ratio > 0 ? "bg-warning" : "bg-neutral-300"
                            }`}
                            style={{ width: `${Math.max(ratio * 100, left > 0 ? 6 : 0)}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-xs text-neutral-500">
                          เหลือ {left.toLocaleString()} / {z.totalSeats.toLocaleString()} ที่นั่ง
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* แผง CTA แบบ sticky */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-neutral-500">เปิดขาย</p>
              <p className="text-sm font-medium text-neutral-800">
                {formatThaiDate(concert.saleStartAt)}
                {" – "}
                {formatThaiDate(concert.saleEndAt)}
              </p>

              <div className="mt-5">
                {isOnSale ? (
                  <Link href={`/concerts/${concert.slug}/queue`}>
                    <Button size="lg" className="w-full" rightIcon={<ArrowRight className="size-4" />}>
                      เข้าคิวจองตั๋ว
                    </Button>
                  </Link>
                ) : saleNotYet ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg bg-info-bg px-4 py-3 text-sm font-medium text-info">
                    <Clock className="size-4" />
                    เริ่มขาย {formatThaiDate(concert.saleStartAt)}
                  </div>
                ) : (
                  <div className="rounded-lg bg-neutral-100 px-4 py-3 text-center text-sm text-neutral-500">
                    ขายหมดแล้ว / จบงานแล้ว
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
