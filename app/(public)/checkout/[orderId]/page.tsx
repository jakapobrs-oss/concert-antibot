// Checkout page (Phase 7) — แสดง QR PromptPay + upload สลิป (โทนเวทีมืด)
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { generatePromptPayQR } from "@/lib/promptpay";
import { SiteHeader } from "@/components/site-header";
import { CheckoutClient } from "@/components/checkout-client";

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
          seat: { include: { zone: { select: { name: true } } } },
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

  const seatLabels = order.items.map(
    (i) => `${i.seat.zone.name} ${i.seat.rowLabel}${i.seat.seatNumber}`
  );

  // named ticket: รายการที่นั่ง + ผู้ถือปัจจุบัน สำหรับฟอร์มระบุผู้ถือ (แก้ได้จนกว่าจะจ่าย)
  const holderItems = order.items.map((i) => ({
    itemId: i.id.toString(),
    seatLabel: `${i.seat.zone.name} ${i.seat.rowLabel}${i.seat.seatNumber}`,
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
          <CheckoutClient
            orderId={orderId}
            amount={amount}
            qrDataUrl={dataUrl}
            seatLabels={seatLabels}
            holderItems={holderItems}
            expiresAt={order.expiresAt.toISOString()}
            concertSlug={order.concert.slug}
          />
        )}
      </main>
    </div>
  );
}
