// Sales Report (Phase 8) — ยอดขาย/รายได้/อัตราขายต่อคอนเสิร์ต
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatTHB } from "@/lib/format";
import { getSalesReport } from "@/lib/admin-stats";

export const dynamic = "force-dynamic";

const statusStyle: Record<string, string> = {
  DRAFT: "bg-neutral-100 text-neutral-600",
  SCHEDULED: "bg-blue-100 text-blue-700",
  ON_SALE: "bg-green-100 text-green-700",
  SOLD_OUT: "bg-red-100 text-red-700",
  ENDED: "bg-neutral-200 text-neutral-500",
};

export default async function SalesReportPage() {
  const report = await getSalesReport();
  const totalRevenue = report.reduce((s, r) => s + r.revenue, 0);
  const totalSold = report.reduce((s, r) => s + r.soldSeats, 0);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link href="/admin" className="text-sm text-neutral-500 hover:text-brand-600">
          ← กลับแดชบอร์ด
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-6">📊 Sales Report</h1>

        {/* สรุปรวม */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent>
              <p className="text-sm text-neutral-500">รายได้รวมทั้งหมด</p>
              <p className="text-2xl font-bold text-green-600">{formatTHB(totalRevenue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-sm text-neutral-500">ตั๋วที่ขายได้</p>
              <p className="text-2xl font-bold">{totalSold.toLocaleString()} ใบ</p>
            </CardContent>
          </Card>
        </div>

        {/* ตารางต่อคอนเสิร์ต */}
        {report.length === 0 ? (
          <p className="text-center text-neutral-500 py-12">ยังไม่มีคอนเสิร์ต</p>
        ) : (
          <div className="space-y-3">
            {report.map((r) => (
              <Card key={r.id}>
                <CardContent>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold">{r.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusStyle[r.status]}`}>
                          {r.status}
                        </span>
                      </div>
                      {/* progress bar ขาย */}
                      <div className="h-2 bg-neutral-200 rounded-full overflow-hidden max-w-md">
                        <div
                          className="h-full bg-brand-500"
                          style={{ width: `${r.soldRate}%` }}
                        />
                      </div>
                      <p className="text-xs text-neutral-500 mt-1">
                        ขาย {r.soldSeats}/{r.totalSeats} ที่นั่ง ({r.soldRate.toFixed(1)}%)
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-green-600">{formatTHB(r.revenue)}</p>
                      <p className="text-xs text-neutral-500">{r.paidOrders} คำสั่งซื้อ</p>
                    </div>
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
