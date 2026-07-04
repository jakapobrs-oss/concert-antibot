// หน้า admin: งานคืนเงินค้าง — 2 แหล่ง
//   1) Payment REFUND_REQUIRED (Codex #3): เงินเข้าจริงแต่ออกตั๋วไม่ได้ (order ตาย/ที่นั่งหลุด/ชน payer cap)
//   2) TicketReturn PENDING: ผู้ซื้อคืนบัตรเข้าระบบ รอโอนราคาหน้าบัตรคืน
// ทีมงานโอนเงินคืนนอกระบบ (แอปธนาคาร) แล้วมากด "โอนคืนแล้ว" เพื่อปิดงาน
import { AlertTriangle, Undo2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatTHB } from "@/lib/format";
import { SiteHeader } from "@/components/site-header";
import { MarkRefundedButton } from "@/components/refund-actions";

export const dynamic = "force-dynamic";

export default async function RefundsPage() {
  const [payments, returns] = await Promise.all([
    prisma.payment.findMany({
      where: { status: "REFUND_REQUIRED" },
      include: { order: { include: { user: { select: { email: true, name: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ticketReturn.findMany({
      where: { status: "PENDING" },
      include: { payer: { select: { email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-fg">งานคืนเงิน</h1>
        <p className="mb-6 text-sm text-fg-faint">
          โอนคืนผ่านแอปธนาคารก่อน แล้วค่อยกดปิดงาน — ปุ่มนี้แค่บันทึกสถานะ ไม่ได้โอนเงินจริง
        </p>

        {/* 1) จ่ายแล้วแต่ไม่ได้ตั๋ว (REFUND_REQUIRED) */}
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 font-display font-semibold text-fg">
            <AlertTriangle className="size-4 text-warning" />
            จ่ายเงินแล้วแต่ไม่ได้ตั๋ว ({payments.length})
          </h2>
          {payments.length === 0 ? (
            <p className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 p-5 text-center text-sm text-fg-faint">
              ไม่มีรายการค้าง
            </p>
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div
                  key={p.id.toString()}
                  className="flex items-center justify-between gap-3 rounded-xl border border-warning/20 bg-ink-850 p-4 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-fg">
                      {formatTHB(p.amount.toString())} · order #{p.orderId.toString()}
                    </p>
                    <p className="truncate text-xs text-fg-faint">
                      ผู้ซื้อ: {p.order.user.name || p.order.user.email}
                      {p.senderName ? ` · โอนจาก: ${p.senderName}` : ""}
                      {p.slipRef ? ` · slipRef: ${p.slipRef}` : ""}
                    </p>
                  </div>
                  <MarkRefundedButton kind="payment" id={p.id.toString()} />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 2) คืนบัตรเข้าระบบ (รอคืนราคาหน้าบัตร) */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-display font-semibold text-fg">
            <Undo2 className="size-4 text-brand-300" />
            คืนบัตรเข้าระบบ ({returns.length})
          </h2>
          {returns.length === 0 ? (
            <p className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 p-5 text-center text-sm text-fg-faint">
              ไม่มีรายการค้าง
            </p>
          ) : (
            <div className="space-y-2">
              {returns.map((r) => (
                <div
                  key={r.id.toString()}
                  className="flex items-center justify-between gap-3 rounded-xl border border-fg/10 bg-ink-850 p-4 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-fg">
                      {formatTHB(r.amount.toString())} · {r.seatLabel}
                    </p>
                    <p className="truncate text-xs text-fg-faint">
                      คืนเงินให้: {r.payer.name || r.payer.email} · ticket #{r.ticketId.toString()}
                    </p>
                  </div>
                  <MarkRefundedButton kind="return" id={r.id.toString()} />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
