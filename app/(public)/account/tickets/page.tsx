// หน้าตั๋วของฉัน (Phase 7 + docs/19 named ticket) — ตั๋วที่ "ฉันเป็นผู้ถือ" + QR เข้างานแบบหมุน
// การ์ดออกแบบเป็น "ตั๋วจริง": ฝั่ง QR พื้นขาว + รอยปรุ + แถบ barcode
// QR เป็น dynamic (หมุนทุก ~30 วิ ผ่าน server action) — ภาพแคปหน้าจอใช้เข้างานไม่ได้
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatTHB, formatThaiDate } from "@/lib/format";
import { PartyPopper, MapPin, CalendarDays, Ticket, UserRound, CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { TicketEntryQr } from "@/components/ticket-entry-qr";
import { TicketReturnButton } from "@/components/ticket-return-button";

export const dynamic = "force-dynamic";

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderId } = await searchParams;

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login?callbackUrl=/account/tickets");

  // ตั๋วที่ user นี้เป็น "ผู้ถือ" (named ticket: คนอื่นซื้อให้ก็โผล่ที่นี่) — ไม่รวมใบที่คืนแล้ว
  const tickets = await prisma.ticket.findMany({
    where: {
      userId: BigInt(userId),
      returnedAt: null,
      ...(orderId ? { orderId: BigInt(orderId) } : {}),
    },
    include: {
      seat: { include: { zone: { include: { concert: true } } } },
      order: { select: { userId: true } },
    },
    orderBy: { issuedAt: "desc" },
  });

  const now = Date.now();
  const cutoffMs = env.RETURN_CUTOFF_HOURS * 60 * 60 * 1000;

  const ticketCards = tickets.map((t) => ({
    id: t.id.toString(),
    holderName: t.holderName,
    checkedIn: !!t.checkedInAt,
    concertTitle: t.seat.zone.concert.title,
    venue: t.seat.zone.concert.venue,
    eventAt: t.seat.zone.concert.eventAt,
    zoneName: t.seat.zone.name,
    seat: `${t.seat.rowLabel}${t.seat.seatNumber}`,
    price: t.price.toString(),
    // คืนได้เฉพาะ: ฉันเป็นผู้ซื้อ + ยังไม่เช็คอิน + ยังไม่พ้นเส้นตายคืน
    canReturn:
      t.order.userId === BigInt(userId) &&
      !t.checkedInAt &&
      now < t.seat.zone.concert.eventAt.getTime() - cutoffMs,
  }));

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        {orderId && (
          <div className="animate-fade-in-up mb-6 flex items-center justify-center gap-2 rounded-xl border border-success/25 bg-success/10 p-4 text-center text-sm font-medium text-success">
            <PartyPopper className="size-5" />
            จองตั๋วสำเร็จ! ตั๋วของคุณพร้อมแล้ว
          </div>
        )}
        <h1 className="mb-6 font-display text-3xl font-bold tracking-tight text-fg">ตั๋วของฉัน</h1>

        {ticketCards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 py-16 text-center">
            <Ticket className="mx-auto size-10 text-fg/20" />
            <p className="mt-3 text-fg-faint">ยังไม่มีตั๋ว</p>
            <Link
              href="/concerts"
              className="mt-1 inline-block text-sm font-medium text-brand-300 hover:underline"
            >
              ดูคอนเสิร์ตที่เปิดขาย →
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {ticketCards.map((t, i) => (
              <article
                key={t.id}
                className="animate-fade-in-up relative flex overflow-hidden rounded-xl border border-fg/10 bg-ink-850 shadow-md"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                {/* ฝั่ง QR — ต้องพื้นขาวเพื่อให้เครื่องสแกนหน้างานอ่านได้ (dynamic — หมุนเองใน client) */}
                <div className="grid shrink-0 place-items-center bg-white p-4">
                  <TicketEntryQr
                    ticketId={t.id}
                    alt={`QR ตั๋ว ${t.concertTitle} ที่นั่ง ${t.seat}`}
                  />
                </div>

                {/* รอยปรุระหว่างซีก QR กับรายละเอียด + รูเจาะบน-ล่างแบบตั๋วฉีก */}
                <div className="relative w-[3px] shrink-0 self-stretch" aria-hidden>
                  <div className="border-perforated-y absolute inset-0" />
                  <span className="absolute -top-2.5 left-1/2 size-5 -translate-x-1/2 rounded-full bg-ink-950" />
                  <span className="absolute -bottom-2.5 left-1/2 size-5 -translate-x-1/2 rounded-full bg-ink-950" />
                </div>

                {/* รายละเอียดตั๋ว */}
                <div className="min-w-0 flex-1 space-y-1.5 p-4 text-sm">
                  <h3 className="truncate font-display text-base font-bold text-fg">
                    {t.concertTitle}
                  </h3>
                  <p className="flex items-center gap-1.5 text-fg-faint">
                    <MapPin className="size-3.5 shrink-0" />
                    <span className="truncate">{t.venue}</span>
                  </p>
                  <p className="flex items-center gap-1.5 text-fg-faint">
                    <CalendarDays className="size-3.5 shrink-0" /> {formatThaiDate(t.eventAt)}
                  </p>
                  {/* ชื่อผู้ถือ — จนท.หน้างานเทียบกับบัตรประชาชน */}
                  <p className="flex items-center gap-1.5 font-medium text-fg">
                    <UserRound className="size-3.5 shrink-0 text-brand-300" />
                    <span className="truncate">{t.holderName || "(ไม่มีชื่อบนตั๋ว)"}</span>
                    {t.checkedIn && (
                      <span className="ml-1 inline-flex items-center gap-0.5 rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                        <CheckCircle2 className="size-3" /> เช็คอินแล้ว
                      </span>
                    )}
                  </p>
                  <p className="pt-0.5">
                    <span className="text-led mr-2 rounded-md border border-brand-500/25 bg-brand-500/12 px-2 py-0.5 text-xs font-semibold text-brand-300">
                      โซน {t.zoneName} · {t.seat}
                    </span>
                    <span className="text-led font-bold text-spot-300">{formatTHB(t.price)}</span>
                  </p>
                  <div className="flex items-end justify-between gap-3 pt-1">
                    <p className="text-xs text-fg-faint">บัตรผูกชื่อ — โอน/ขายต่อไม่ได้</p>
                    <div className="bg-barcode h-5 w-20 shrink-0 text-fg/25" aria-hidden />
                  </div>
                  {t.canReturn && <TicketReturnButton ticketId={t.id} />}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
