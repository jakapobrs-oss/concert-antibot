// Sales Report (Phase 8) — ยอดขาย/รายได้/อัตราขายต่อคอนเสิร์ต (โทนเวทีมืด)
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { formatTHB } from "@/lib/format";
import { getSalesReport } from "@/lib/admin-stats";

export const dynamic = "force-dynamic";

// สีป้ายสถานะคอนเสิร์ตในรายงาน
const statusStyle: Record<string, string> = {
  DRAFT: "bg-fg/10 text-fg-dim",
  SCHEDULED: "bg-info/12 text-info",
  ON_SALE: "bg-success/12 text-success",
  SOLD_OUT: "bg-danger/12 text-danger",
  ENDED: "bg-fg/8 text-fg-faint",
};

export default async function SalesReportPage() {
  const report = await getSalesReport();
  const totalRevenue = report.reduce((s, r) => s + r.revenue, 0);
  const totalSold = report.reduce((s, r) => s + r.soldSeats, 0);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link href="/admin" className="text-sm text-fg-faint transition-colors hover:text-brand-300">
          ← กลับแดชบอร์ด
        </Link>
        <h1 className="mb-6 mt-2 flex items-center gap-2.5 font-display text-2xl font-bold text-fg">
          <BarChart3 className="size-6 text-brand-400" />
          Sales Report
        </h1>

        {/* สรุปรวม — แถวเดียวคั่นเส้น */}
        <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-xl border border-fg/10 bg-ink-850">
          <div className="p-5">
            <p className="text-sm text-fg-faint">รายได้รวมทั้งหมด</p>
            <p className="text-led mt-1 text-2xl font-bold text-success">{formatTHB(totalRevenue)}</p>
          </div>
          <div className="border-l border-fg/10 p-5">
            <p className="text-sm text-fg-faint">ตั๋วที่ขายได้</p>
            <p className="text-led mt-1 text-2xl font-bold text-fg">
              {totalSold.toLocaleString()} <span className="text-sm font-normal text-fg-faint">ใบ</span>
            </p>
          </div>
        </div>

        {/* ตารางต่อคอนเสิร์ต */}
        {report.length === 0 ? (
          <p className="py-12 text-center text-fg-faint">ยังไม่มีคอนเสิร์ต</p>
        ) : (
          <div className="space-y-3">
            {report.map((r) => (
              <div key={r.id} className="rounded-xl border border-fg/10 bg-ink-850 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2.5 flex items-center gap-2">
                      <h3 className="truncate font-display font-semibold text-fg">{r.title}</h3>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 font-display text-xs font-medium ${statusStyle[r.status]}`}
                      >
                        {r.status}
                      </span>
                    </div>
                    {/* progress bar ขาย */}
                    <div className="h-2 max-w-md overflow-hidden rounded-full bg-ink-700">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand-700 to-brand-500"
                        style={{ width: `${r.soldRate}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-fg-faint">
                      ขาย {r.soldSeats}/{r.totalSeats} ที่นั่ง ({r.soldRate.toFixed(1)}%)
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-led text-lg font-bold text-success">{formatTHB(r.revenue)}</p>
                    <p className="text-xs text-fg-faint">{r.paidOrders} คำสั่งซื้อ</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
