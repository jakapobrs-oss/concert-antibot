// หน้าตั๋วของฉัน (Phase 7) — แสดงตั๋วที่จองสำเร็จ + QR สำหรับเข้างาน
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { formatTHB, formatThaiDate } from "@/lib/format";
import { PartyPopper, MapPin, CalendarDays, Ticket } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent } from "@/components/ui/card";

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
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-8">
        {orderId && (
          <div className="mb-6 flex items-center justify-center gap-2 rounded-lg bg-success-bg p-4 text-center text-sm font-medium text-success">
            <PartyPopper className="size-5" />
            จองตั๋วสำเร็จ! ตั๋วของคุณพร้อมแล้ว
          </div>
        )}
        <h1 className="mb-6 text-2xl font-bold tracking-tight">ตั๋วของฉัน</h1>

        {ticketsWithQr.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-white py-16 text-center">
            <Ticket className="mx-auto size-10 text-neutral-300" />
            <p className="mt-3 text-neutral-500">ยังไม่มีตั๋ว</p>
            <Link
              href="/concerts"
              className="mt-1 inline-block text-sm font-medium text-brand-600 hover:underline"
            >
              ดูคอนเสิร์ตที่เปิดขาย →
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {ticketsWithQr.map((t) => (
              <Card key={t.id} className="overflow-hidden">
                {/* การ์ดตั๋วสไตล์ stub — แถบซ้ายเป็น QR */}
                <CardContent className="flex items-center gap-4 p-0">
                  <div className="grid place-items-center self-stretch bg-neutral-50 p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.qrDataUrl} alt="ticket QR" className="size-28 shrink-0" />
                  </div>
                  <div className="space-y-1 py-4 pr-4 text-sm">
                    <h3 className="text-base font-bold text-neutral-900">{t.concertTitle}</h3>
                    <p className="flex items-center gap-1.5 text-neutral-500">
                      <MapPin className="size-3.5" /> {t.venue}
                    </p>
                    <p className="flex items-center gap-1.5 text-neutral-500">
                      <CalendarDays className="size-3.5" /> {formatThaiDate(t.eventAt)}
                    </p>
                    <p className="pt-0.5 font-medium text-brand-600">
                      โซน {t.zoneName} · ที่นั่ง {t.seat} · {formatTHB(t.price)}
                    </p>
                    <p className="font-mono text-xs text-neutral-400">{t.qrCode.slice(0, 20)}…</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
