// Bot Detection Log viewer (Phase 8) — ดู bot_events + behavior stats (โทนเวทีมืด)
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { getBotEvents, getBehaviorStats } from "@/lib/admin-stats";

export const dynamic = "force-dynamic";

// สีป้ายผลตัดสินของ anti-bot ต่อ event
const actionStyle: Record<string, string> = {
  ALLOW: "bg-success/12 text-success",
  CHALLENGE: "bg-warning/12 text-warning",
  BLOCK: "bg-danger/12 text-danger",
};

export default async function BotLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const { action } = await searchParams;
  const filterAction =
    action === "ALLOW" || action === "CHALLENGE" || action === "BLOCK" ? action : undefined;

  const [events, behavior] = await Promise.all([
    getBotEvents({ action: filterAction, limit: 100 }),
    getBehaviorStats(),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Link href="/admin" className="text-sm text-fg-faint transition-colors hover:text-brand-300">
          ← กลับแดชบอร์ด
        </Link>
        <h1 className="mb-6 mt-2 flex items-center gap-2.5 font-display text-2xl font-bold text-fg">
          <ShieldCheck className="size-6 text-brand-400" />
          Bot Detection Log
        </h1>

        {/* behavior summary (thesis material) */}
        <div className="mb-6 rounded-xl border border-fg/10 bg-ink-850 p-5">
          <h2 className="mb-3 font-display font-semibold text-fg">สรุปพฤติกรรม (Behavior Analysis)</h2>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <div>
              <p className="text-fg-faint">Sessions ทั้งหมด</p>
              <p className="text-led text-xl font-bold text-fg">{behavior.total}</p>
            </div>
            <div>
              <p className="text-fg-faint">น่าจะเป็นมนุษย์</p>
              <p className="text-led text-xl font-bold text-success">{behavior.human}</p>
            </div>
            <div>
              <p className="text-fg-faint">น่าจะเป็นบอท</p>
              <p className="text-led text-xl font-bold text-danger">{behavior.likelyBot}</p>
            </div>
          </div>
          {behavior.total > 0 && (
            <div className="mt-4 space-y-1 border-t border-fg/10 pt-3 text-xs text-fg-faint">
              <p className="mb-1 font-medium text-fg-dim">
                ค่าเฉลี่ย feature (มนุษย์ vs บอท) — สำหรับวิเคราะห์ thesis:
              </p>
              <p>
                Entropy เส้นทางเมาส์: มนุษย์ {behavior.avgHuman.entropy.toFixed(3)} · บอท{" "}
                {behavior.avgBot.entropy.toFixed(3)}
              </p>
              <p>
                Variance timing: มนุษย์ {behavior.avgHuman.variance.toFixed(1)} · บอท{" "}
                {behavior.avgBot.variance.toFixed(1)}
              </p>
              <p>
                Dwell time (ms): มนุษย์ {behavior.avgHuman.dwellMs.toFixed(0)} · บอท{" "}
                {behavior.avgBot.dwellMs.toFixed(0)}
              </p>
            </div>
          )}
        </div>

        {/* filter */}
        <div className="mb-4 flex flex-wrap gap-2">
          <Link href="/admin/bot-log">
            <Button size="sm" variant={!filterAction ? "primary" : "outline"}>ทั้งหมด</Button>
          </Link>
          <Link href="/admin/bot-log?action=ALLOW">
            <Button size="sm" variant={filterAction === "ALLOW" ? "primary" : "outline"}>ผ่าน</Button>
          </Link>
          <Link href="/admin/bot-log?action=CHALLENGE">
            <Button size="sm" variant={filterAction === "CHALLENGE" ? "primary" : "outline"}>ท้าทาย</Button>
          </Link>
          <Link href="/admin/bot-log?action=BLOCK">
            <Button size="sm" variant={filterAction === "BLOCK" ? "primary" : "outline"}>บล็อก</Button>
          </Link>
        </div>

        {/* event table */}
        {events.length === 0 ? (
          <p className="py-12 text-center text-fg-faint">ยังไม่มี event</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-fg/10 bg-ink-850">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-fg/15 text-left font-display text-fg-faint">
                  <th className="px-4 py-3 font-medium">เวลา</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium">User-Agent</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-fg/5 transition-colors last:border-0 hover:bg-fg/5"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 text-fg-faint">
                      {new Date(e.createdAt).toLocaleString("th-TH")}
                    </td>
                    <td className="text-led px-4 py-2.5 font-bold text-fg">{e.score}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 font-display text-xs font-medium ${actionStyle[e.action]}`}
                      >
                        {e.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-fg-dim">{e.ip ?? "-"}</td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-xs text-fg-faint">
                      {e.userAgent ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
