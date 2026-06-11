// หน้าตั๋วของฉัน (Phase 7) — แสดงตั๋วที่จองสำเร็จ + QR สำหรับเข้างาน
// การ์ดออกแบบเป็น "ตั๋วจริง": ฝั่ง QR พื้นขาว + รอยปรุ + แถบ barcode
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { formatTHB, formatThaiDate } from "@/lib/format";
import { PartyPopper, MapPin, CalendarDays, Ticket } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

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

  // ดึงตั๋วทั้งหมดของ user (หรือเฉพาะ order ถ้าระบุ)
  const tickets = await prisma.ticket.findMany({
    where: {
      userId: BigInt(userId),
      ...(orderId ? { orderId: BigInt(orderId) } : {}),
    },
    include: {
      seat: { include: { zone: { include: { concert: true } } } },
    },
    orderBy: { issuedAt: "desc" },
  });

  // gen QR สำหรับแต่ละตั๋ว
  const ticketsWithQr = await Promise.all(
    tickets.map(async (t) => ({
      id: t.id.toString(),
      qrCode: t.qrCode,
      qrDataUrl: await QRCode.toDataURL(t.qrCode, { width: 200, margin: 1 }),
      concertTitle: t.seat.zone.concert.title,
      venue: t.seat.zone.concert.venue,
      eventAt: t.seat.zone.concert.eventAt,
      zoneName: t.seat.zone.name,
      seat: `${t.seat.rowLabel}${t.seat.seatNumber}`,
      price: t.price.toString(),
    }))
  );

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

        {ticketsWithQr.length === 0 ? (
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
            {ticketsWithQr.map((t, i) => (
              <article
                key={t.id}
                className="animate-fade-in-up relative flex overflow-hidden rounded-xl border border-fg/10 bg-ink-850 shadow-md"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                {/* ฝั่ง QR — ต้องพื้นขาวเพื่อให้เครื่องสแกนหน้างานอ่านได้ */}
                <div className="grid shrink-0 place-items-center bg-white p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.qrDataUrl} alt={`QR ตั๋ว ${t.concertTitle} ที่นั่ง ${t.seat}`} className="size-28" />
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
                  <p className="pt-0.5">
                    <span className="text-led mr-2 rounded-md border border-brand-500/25 bg-brand-500/12 px-2 py-0.5 text-xs font-semibold text-brand-300">
                      โซน {t.zoneName} · {t.seat}
                    </span>
                    <span className="text-led font-bold text-spot-300">{formatTHB(t.price)}</span>
                  </p>
                  <div className="flex items-end justify-between gap-3 pt-1">
                    <p className="truncate font-mono text-xs text-fg-faint">
                      {t.qrCode.slice(0, 20)}…
                    </p>
                    <div className="bg-barcode h-5 w-20 shrink-0 text-fg/25" aria-hidden />
                  </div>
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
