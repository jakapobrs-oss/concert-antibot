// หน้า "คำสั่งซื้อของฉัน" (Phase 2.4, docs/24)
// เติมช่องโหว่ใหญ่ของระบบเดิม: order ที่ยังไม่จ่ายไม่มีทางกลับไปจ่ายต่อเลยถ้าปิดแท็บ checkout ไป
//   → ผู้ใช้ไม่รู้ว่าที่นั่งยังจองค้างอยู่ และทีมงานก็ไล่ตามให้ไม่ได้
// สถานะคำนวณสดจากเวลา (lib/order-view.ts) ไม่ต้องรอ sweeper มาปิด order ก่อนถึงจะแสดงถูก
import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt, MapPin, CalendarDays, Ticket } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { formatTHB, formatThaiDate } from "@/lib/format";
import { orderDisplayStatus, ORDER_STATUS_LABEL } from "@/lib/order-view";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { PendingOrderActions } from "@/components/order-actions";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login?callbackUrl=/account/orders");

  const now = new Date();
  const orders = await prisma.order.findMany({
    where: { userId: BigInt(userId) },
    include: {
      concert: { select: { title: true, slug: true, venue: true, eventAt: true } },
      items: { include: { seat: { include: { zone: { select: { name: true } } } } } },
      payment: { select: { status: true } },
      // รอบที่ซื้อ — ให้ผู้ใช้เห็นว่าตั๋วใบนี้ได้มาจากรอบสมาชิก/รอบทั่วไป (docs/21)
      saleRound: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="mb-1 font-display text-3xl font-bold tracking-tight text-fg">
          คำสั่งซื้อของฉัน
        </h1>
        <p className="mb-6 text-sm text-fg-faint">
          คำสั่งซื้อที่ยังไม่ชำระจะหมดเวลาใน 5 นาที — กลับมาจ่ายต่อจากหน้านี้ได้ก่อนหมดเวลา
        </p>

        {orders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 py-16 text-center">
            <Receipt className="mx-auto size-10 text-fg/20" />
            <p className="mt-3 text-fg-faint">ยังไม่มีคำสั่งซื้อ</p>
            <Link
              href="/concerts"
              className="mt-1 inline-block text-sm font-medium text-brand-300 hover:underline"
            >
              ดูคอนเสิร์ตที่เปิดขาย →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => {
              const state = orderDisplayStatus(
                { status: o.status, expiresAt: o.expiresAt, paymentStatus: o.payment?.status ?? null },
                now
              );
              const label = ORDER_STATUS_LABEL[state];
              const seats = o.items
                .map((i) => `${i.seat.zone.name} ${i.seat.rowLabel}${i.seat.seatNumber}`)
                .join(" · ");

              return (
                <article
                  key={o.id.toString()}
                  className={`rounded-xl border bg-ink-850 p-4 ${
                    state === "AWAITING_PAYMENT" ? "border-warning/30" : "border-fg/10"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="font-display font-semibold text-fg">{o.concert.title}</h2>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-faint">
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3" /> {o.concert.venue}
                        </span>
                        <span className="flex items-center gap-1">
                          <CalendarDays className="size-3" /> {formatThaiDate(o.concert.eventAt)}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {o.saleRound && <Badge tone="brand">{o.saleRound.name}</Badge>}
                      <Badge tone={label.tone}>{label.text}</Badge>
                    </div>
                  </div>

                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="inline-flex items-center gap-1 text-fg-dim">
                      <Ticket className="size-3.5 text-brand-300" />
                      {seats || "—"}
                    </span>
                    <span className="text-led font-bold text-spot-300">
                      {formatTHB(o.totalAmount.toString())}
                    </span>
                  </p>

                  <p className="mt-1 text-xs text-fg-faint">
                    สั่งซื้อ {formatThaiDate(o.createdAt)} · เลขที่ #{o.id.toString()}
                  </p>

                  <div className="mt-3">
                    {state === "AWAITING_PAYMENT" && (
                      <PendingOrderActions
                        orderId={o.id.toString()}
                        expiresAt={o.expiresAt.toISOString()}
                      />
                    )}
                    {state === "EXPIRED" && (
                      <p className="text-xs text-fg-faint">
                        หมดเวลาชำระเงิน ที่นั่งถูกคืนเข้าระบบแล้ว —{" "}
                        <Link
                          href={`/concerts/${o.concert.slug}`}
                          className="font-medium text-brand-300 hover:underline"
                        >
                          จองใหม่อีกครั้ง
                        </Link>
                      </p>
                    )}
                    {state === "PAID" && (
                      <Link
                        href={`/account/tickets?order=${o.id.toString()}`}
                        className="text-sm font-medium text-brand-300 hover:underline"
                      >
                        ดูตั๋วของคำสั่งซื้อนี้ →
                      </Link>
                    )}
                    {state === "REFUND_REQUIRED" && (
                      <p className="text-xs text-danger">
                        เงินเข้าระบบแล้วแต่ออกตั๋วไม่สำเร็จ — ทีมงานกำลังดำเนินการคืนเงินให้
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
