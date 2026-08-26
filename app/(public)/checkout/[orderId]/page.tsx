// Checkout page (Phase 7) — แสดง QR PromptPay + upload สลิป (โทนเวทีมืด)
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { returnCutoffHours } from "@/lib/legal-info";
import { auth } from "@/lib/auth";
import { generatePromptPayQR } from "@/lib/promptpay";
import { SiteHeader } from "@/components/site-header";
import { CheckoutClient } from "@/components/checkout-client";
import { formatSeatLabel } from "@/lib/seatmap/seat-rows";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  const order = await prisma.order.findUnique({
    where: { id: BigInt(orderId) },
    include: {
      concert: { select: { title: true, slug: true } },
      items: {
        include: {
          seat: { include: { zone: { select: { name: true, isStanding: true } } } },
          // named ticket: ผู้ถือที่ระบุไว้แล้ว (null = ผู้ซื้อถือเอง)
          holder: { select: { name: true, email: true } },
        },
      },
      payment: true,
    },
  });

  if (!order || order.userId !== BigInt(userId)) notFound();

  // ถ้าจ่ายแล้ว → ไปหน้าตั๋ว
  if (order.status === "PAID") {
    redirect(`/account/tickets?order=${orderId}`);
  }

  // ถ้าหมดอายุ/ยกเลิก
  const expired = order.status === "CANCELLED" || order.expiresAt < new Date();

  const amount = Number(order.totalAmount.toString());
  const { dataUrl } = await generatePromptPayQR(amount);

  const seatLabels = order.items.map((item) =>
    formatSeatLabel({
      zoneName: item.seat.zone.name,
      isStanding: item.seat.zone.isStanding,
      rowLabel: item.seat.rowLabel,
      seatNumber: item.seat.seatNumber,
    }),
  );

  // named ticket: รายการที่นั่ง + ผู้ถือปัจจุบัน สำหรับฟอร์มระบุผู้ถือ (แก้ได้จนกว่าจะจ่าย)
  const holderItems = order.items.map((i) => ({
    itemId: i.id.toString(),
    seatLabel: formatSeatLabel({
      zoneName: i.seat.zone.name,
      isStanding: i.seat.zone.isStanding,
      rowLabel: i.seat.rowLabel,
      seatNumber: i.seat.seatNumber,
    }),
    holderName: i.holder ? (i.holder.name?.trim() || i.holder.email) : null,
  }));

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8">
        <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-fg">ชำระเงิน</h1>
        <p className="mb-6 text-sm text-fg-faint">{order.concert.title}</p>

        {expired ? (
          <div className="rounded-xl border border-danger/25 bg-danger/10 p-5 text-center text-sm text-danger">
            คำสั่งซื้อหมดอายุแล้ว — ที่นั่งถูกปล่อยคืน กรุณาเริ่มจองใหม่
          </div>
        ) : (
          <>
            {/* เงื่อนไขบัตรที่ต้องเห็นก่อนจ่าย (บัตรระบุชื่อ/คืนบัตร/คืนเงิน) — ลิงก์ไปฉบับเต็ม */}
            <p className="mb-4 rounded-lg border border-fg/10 bg-ink-900/60 px-3.5 py-2.5 text-xs leading-relaxed text-fg-faint">
              การชำระเงินถือว่ายอมรับ{" "}
              <Link href="/ticket-terms" target="_blank" className="font-semibold text-fg-dim underline underline-offset-2 hover:text-fg">
                เงื่อนไขบัตรและการคืนเงิน
              </Link>{" "}
              — บัตรระบุชื่อผู้ถือ โอนสิทธิ์ไม่ได้ · คืนบัตรได้ถึง {returnCutoffHours} ชั่วโมงก่อนเริ่มงาน คืนเงินเต็มจำนวน
            </p>
            <CheckoutClient
            orderId={orderId}
            amount={amount}
            qrDataUrl={dataUrl}
            seatLabels={seatLabels}
            holderItems={holderItems}
            expiresAt={order.expiresAt.toISOString()}
            concertSlug={order.concert.slug}
          />
          </>
        )}
      </main>
    </div>
  );
}
