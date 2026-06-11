// Concert detail page — รายละเอียด + ปุ่มไปหน้าคิว (โทนเวทีมืด)
// hero ใช้โปสเตอร์เป็นฉากหลังเบลอ + ข้อมูลเป็นชิปอ่านง่าย
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, CalendarDays, Ticket, Music2, ArrowRight, Clock, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatTHB, formatThaiDate } from "@/lib/format";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EqBars } from "@/components/eq-bars";

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
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      {/* Hero — โปสเตอร์เป็นฉากหลัง + ม่านเงาให้ตัวหนังสือเด่น */}
      <section className="bg-stage relative overflow-hidden border-b border-fg/10">
        {concert.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={concert.coverImageUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full scale-105 object-cover opacity-30 blur-sm"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-fg/8" aria-hidden>
            <Music2 className="size-44" />
          </div>
        )}
        {/* ม่านเงา — ไล่จากล่างขึ้นบนให้เนื้อหาคมเสมอ */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-ink-deep via-ink-deep/70 to-ink-deep/30"
          aria-hidden
        />
        <div className="bg-grain absolute inset-0" aria-hidden />

        <div className="relative mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <div className="animate-fade-in-up mb-4">
            {isOnSale && (
              <Badge tone="brand" className="border border-brand-500/30 bg-ink-deep/70 backdrop-blur-sm">
                <EqBars className="h-2.5 text-brand-400" />
                กำลังขาย
              </Badge>
            )}
            {saleNotYet && <Badge tone="info">เร็ว ๆ นี้</Badge>}
            {!isOnSale && !saleNotYet && <Badge tone="neutral">ปิดการขาย</Badge>}
          </div>

          <h1
            className="animate-fade-in-up max-w-3xl font-display text-4xl font-bold leading-[1.12] tracking-tight text-fg sm:text-6xl"
            style={{ animationDelay: "80ms" }}
          >
            {concert.title}
          </h1>

          <div
            className="animate-fade-in-up mt-6 flex flex-wrap gap-2.5"
            style={{ animationDelay: "160ms" }}
          >
            <span className="flex items-center gap-1.5 rounded-full border border-fg/15 bg-ink-deep/70 px-3.5 py-1.5 text-sm text-fg-dim backdrop-blur-sm">
              <MapPin className="size-4 text-brand-400" /> {concert.venue}
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-fg/15 bg-ink-deep/70 px-3.5 py-1.5 text-sm text-fg-dim backdrop-blur-sm">
              <CalendarDays className="size-4 text-brand-400" /> {formatThaiDate(concert.eventAt)}
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-fg/15 bg-ink-deep/70 px-3.5 py-1.5 text-sm text-fg-dim backdrop-blur-sm">
              <Ticket className="size-4 text-brand-400" /> จำกัด {concert.maxTicketsPerUser} ใบ/บัญชี
            </span>
          </div>
        </div>
      </section>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
          {/* รายละเอียด + โซน */}
          <div className="space-y-10">
            <div>
              <h2 className="mb-3 font-display text-xl font-semibold text-fg">เกี่ยวกับงานนี้</h2>
              <p className="max-w-prose whitespace-pre-line leading-relaxed text-fg-dim">
                {concert.description}
              </p>
            </div>

            <div>
              <h2 className="mb-4 font-display text-xl font-semibold text-fg">โซนที่นั่งและราคา</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {concert.zones.map((z) => {
                  const left = z._count.seats;
                  const ratio = z.totalSeats > 0 ? left / z.totalSeats : 0;
                  const soldOut = left === 0;
                  return (
                    <div
                      key={z.id.toString()}
                      className={`rounded-xl border bg-ink-850 p-4 transition-colors ${
                        soldOut ? "border-fg/5 opacity-60" : "border-fg/10 hover:border-fg/20"
                      }`}
                    >
                      <div className="mb-1.5 flex items-center gap-2">
                        <span
                          className="size-3 rounded-full"
                          style={{ backgroundColor: z.color, boxShadow: `0 0 10px ${z.color}90` }}
                          aria-hidden
                        />
                        <h3 className="font-display font-semibold text-fg">{z.name}</h3>
                      </div>
                      {z.description && (
                        <p className="mb-2 text-sm text-fg-faint">{z.description}</p>
                      )}
                      <p className="text-led text-xl font-bold text-spot-300">
                        {formatTHB(z.price.toString())}
                      </p>
                      <div className="mt-3">
                        <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                          <div
                            className={`h-full rounded-full ${
                              ratio > 0.3 ? "bg-success" : ratio > 0 ? "bg-warning" : "bg-fg/20"
                            }`}
                            style={{ width: `${Math.max(ratio * 100, left > 0 ? 6 : 0)}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-xs text-fg-faint">
                          {soldOut
                            ? "โซนนี้เต็มแล้ว"
                            : `เหลือ ${left.toLocaleString()} / ${z.totalSeats.toLocaleString()} ที่นั่ง`}
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
            <div className="rounded-xl border border-fg/10 bg-ink-850 p-5 shadow-md">
              <p className="text-sm text-fg-faint">ช่วงเปิดขาย</p>
              <p className="mt-1 text-sm font-medium leading-relaxed text-fg-dim">
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
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-info/20 bg-info/10 px-4 py-3 text-sm font-medium text-info">
                    <Clock className="size-4" />
                    เริ่มขาย {formatThaiDate(concert.saleStartAt)}
                  </div>
                ) : (
                  <div className="rounded-lg bg-fg/10 px-4 py-3 text-center text-sm text-fg-dim">
                    ขายหมดแล้ว / จบงานแล้ว
                  </div>
                )}
              </div>

              <p className="mt-4 flex items-start gap-2 border-t border-fg/10 pt-4 text-xs leading-relaxed text-fg-faint">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand-400" />
                ทุกคนผ่านห้องรอแบบสุ่มคิวเหมือนกัน — เปิดหลายแท็บไม่ช่วยให้เร็วขึ้น
              </p>
            </div>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
