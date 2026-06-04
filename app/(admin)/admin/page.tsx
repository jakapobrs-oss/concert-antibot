// Admin dashboard (Phase 8) — สถิติรวม + anti-bot + queue + ลิงก์ไปรายงาน
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatTHB } from "@/lib/format";
import { getOverviewStats, getLiveQueueStats } from "@/lib/admin-stats";

export const dynamic = "force-dynamic"; // admin ต้องเห็นข้อมูลล่าสุดเสมอ

export default async function AdminDashboard() {
  const [stats, queues] = await Promise.all([getOverviewStats(), getLiveQueueStats()]);

  const overview = [
    { label: "คอนเสิร์ตทั้งหมด", value: stats.concertCount, icon: "🎤" },
    { label: "กำลังขาย", value: stats.onSaleCount, icon: "🔥" },
    { label: "ผู้ใช้", value: stats.userCount, icon: "👤" },
    { label: "ตั๋วที่ขายได้", value: stats.totalTickets, icon: "🎫" },
  ];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <h1 className="text-3xl font-bold">แดชบอร์ดผู้ดูแล</h1>
          <div className="flex gap-2">
            <Link href="/admin/concerts">
              <Button variant="outline">จัดการคอนเสิร์ต</Button>
            </Link>
            <Link href="/admin/concerts/new">
              <Button>+ สร้างคอนเสิร์ต</Button>
            </Link>
          </div>
        </div>

        {/* ภาพรวม */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {overview.map((s) => (
            <Card key={s.label}>
              <CardContent className="text-center">
                <div className="text-3xl mb-1">{s.icon}</div>
                <div className="text-2xl font-bold">{s.value.toLocaleString()}</div>
                <div className="text-sm text-neutral-500">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* รายได้ + คำสั่งซื้อ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent>
              <p className="text-sm text-neutral-500">รายได้รวม (จ่ายแล้ว)</p>
              <p className="text-3xl font-bold text-green-600">{formatTHB(stats.revenue)}</p>
              <p className="text-xs text-neutral-400 mt-1">{stats.paidOrders} คำสั่งซื้อสำเร็จ</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-sm text-neutral-500">การตรวจจับบอท (Anti-Bot)</p>
              <div className="flex gap-4 mt-2">
                <div>
                  <span className="text-xl font-bold text-green-600">{stats.bot.ALLOW}</span>
                  <span className="text-xs text-neutral-500 block">ผ่าน</span>
                </div>
                <div>
                  <span className="text-xl font-bold text-amber-600">{stats.bot.CHALLENGE}</span>
                  <span className="text-xs text-neutral-500 block">ท้าทาย</span>
                </div>
                <div>
                  <span className="text-xl font-bold text-red-600">{stats.bot.BLOCK}</span>
                  <span className="text-xs text-neutral-500 block">บล็อก</span>
                </div>
              </div>
              <Link href="/admin/bot-log" className="text-xs text-brand-600 hover:underline mt-2 inline-block">
                ดู log ทั้งหมด →
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* คิว real-time */}
        {queues.length > 0 && (
          <Card className="mb-6">
            <CardContent>
              <h2 className="font-semibold mb-3">คิว Real-time</h2>
              <div className="space-y-2">
                {queues.map((q) => (
                  <div key={q.id} className="flex items-center justify-between text-sm">
                    <span>{q.title}</span>
                    <span className="text-neutral-500">
                      รอ <strong className="text-brand-600">{q.waiting}</strong> · เข้าแล้ว{" "}
                      <strong className="text-green-600">{q.admitted}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ลิงก์รายงาน */}
        <div className="flex gap-3 flex-wrap">
          <Link href="/admin/bot-log">
            <Button variant="outline">🛡️ Bot Detection Log</Button>
          </Link>
          <Link href="/admin/sales">
            <Button variant="outline">📊 Sales Report</Button>
          </Link>
        </div>
      </main>
    </>
  );
}
