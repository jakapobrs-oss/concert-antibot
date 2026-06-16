// Admin dashboard (Phase 8) — สถิติรวม + anti-bot + queue + ลิงก์ไปรายงาน (โทนเวทีมืด)
import Link from "next/link";
import { Music2, Flame, Users, Ticket, ShieldCheck, BarChart3 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { EqBars } from "@/components/eq-bars";
import { AdminChatPanel } from "@/components/admin-chat-panel";
import { formatTHB } from "@/lib/format";
import { getOverviewStats, getLiveQueueStats } from "@/lib/admin-stats";

export const dynamic = "force-dynamic"; // admin ต้องเห็นข้อมูลล่าสุดเสมอ

export default async function AdminDashboard() {
  const [stats, queues] = await Promise.all([getOverviewStats(), getLiveQueueStats()]);

  const overview = [
    { label: "คอนเสิร์ตทั้งหมด", value: stats.concertCount, icon: Music2 },
    { label: "กำลังขาย", value: stats.onSaleCount, icon: Flame },
    { label: "ผู้ใช้", value: stats.userCount, icon: Users },
    { label: "ตั๋วที่ขายได้", value: stats.totalTickets, icon: Ticket },
  ];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-bold text-fg">แดชบอร์ดผู้ดูแล</h1>
          <div className="flex gap-2">
            <Link href="/admin/concerts">
              <Button variant="outline">จัดการคอนเสิร์ต</Button>
            </Link>
            <Link href="/admin/concerts/new">
              <Button>+ สร้างคอนเสิร์ต</Button>
            </Link>
          </div>
        </div>

        {/* ภาพรวม — แถวเดียวคั่นเส้น อ่านกวาดตาเร็วกว่าการ์ดแยก */}
        <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-xl border border-fg/10 bg-ink-850 md:grid-cols-4">
          {overview.map((s, i) => (
            <div
              key={s.label}
              className={`relative p-5 ${i % 2 === 1 ? "max-md:border-l" : ""} ${
                i >= 2 ? "max-md:border-t" : ""
              } ${i > 0 ? "md:border-l" : ""} border-fg/10`}
            >
              <s.icon className="absolute right-4 top-4 size-4 text-fg-faint" aria-hidden />
              <p className="text-xs text-fg-faint">{s.label}</p>
              <p className="text-led mt-1 text-3xl font-bold text-fg">{s.value.toLocaleString()}</p>
            </div>
          ))}
        </div>

        {/* รายได้ + ผลตรวจบอท */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-fg/10 bg-ink-850 p-5">
            <p className="text-sm text-fg-faint">รายได้รวม (จ่ายแล้ว)</p>
            <p className="text-led mt-1 text-3xl font-bold text-success">{formatTHB(stats.revenue)}</p>
            <p className="mt-1 text-xs text-fg-faint">{stats.paidOrders} คำสั่งซื้อสำเร็จ</p>
          </div>
          <div className="rounded-xl border border-fg/10 bg-ink-850 p-5">
            <p className="text-sm text-fg-faint">การตรวจจับบอท (Anti-Bot)</p>
            <div className="mt-2 flex gap-6">
              <div>
                <span className="text-led text-xl font-bold text-success">{stats.bot.ALLOW}</span>
                <span className="block text-xs text-fg-faint">ผ่าน</span>
              </div>
              <div>
                <span className="text-led text-xl font-bold text-warning">{stats.bot.CHALLENGE}</span>
                <span className="block text-xs text-fg-faint">ท้าทาย</span>
              </div>
              <div>
                <span className="text-led text-xl font-bold text-danger">{stats.bot.BLOCK}</span>
                <span className="block text-xs text-fg-faint">บล็อก</span>
              </div>
            </div>
            <Link
              href="/admin/bot-log"
              className="mt-2 inline-block text-xs text-brand-300 hover:underline"
            >
              ดู log ทั้งหมด →
            </Link>
          </div>
        </div>

        {/* คิว real-time */}
        {queues.length > 0 && (
          <div className="mb-6 rounded-xl border border-fg/10 bg-ink-850 p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display font-semibold text-fg">
              <EqBars className="h-3 text-brand-400" />
              คิว Real-time
            </h2>
            <div className="space-y-2.5">
              {queues.map((q) => (
                <div
                  key={q.id}
                  className="flex items-center justify-between border-b border-fg/5 pb-2.5 text-sm last:border-0 last:pb-0"
                >
                  <span className="text-fg-dim">{q.title}</span>
                  <span className="text-fg-faint">
                    รอ <strong className="text-led text-brand-300">{q.waiting}</strong> · เข้าแล้ว{" "}
                    <strong className="text-led text-success">{q.admitted}</strong>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ลิงก์รายงาน */}
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/bot-log">
            <Button variant="outline" leftIcon={<ShieldCheck className="size-4" />}>
              Bot Detection Log
            </Button>
          </Link>
          <Link href="/admin/sales">
            <Button variant="outline" leftIcon={<BarChart3 className="size-4" />}>
              Sales Report
            </Button>
          </Link>
        </div>

        {/* Gemini AI Assistant */}
        <div className="mt-6">
          <AdminChatPanel />
        </div>
      </main>
    </>
  );
}
