// Bot Detection Log viewer (Phase 8) — ดู bot_events + behavior stats
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getBotEvents, getBehaviorStats } from "@/lib/admin-stats";

export const dynamic = "force-dynamic";

const actionStyle: Record<string, string> = {
  ALLOW: "bg-green-100 text-green-700",
  CHALLENGE: "bg-amber-100 text-amber-700",
  BLOCK: "bg-red-100 text-red-700",
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
        <Link href="/admin" className="text-sm text-neutral-500 hover:text-brand-600">
          ← กลับแดชบอร์ด
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-6">🛡️ Bot Detection Log</h1>

        {/* behavior summary (thesis material) */}
        <Card className="mb-6">
          <CardContent>
            <h2 className="font-semibold mb-3">สรุปพฤติกรรม (Behavior Analysis)</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-neutral-500">Sessions ทั้งหมด</p>
                <p className="text-xl font-bold">{behavior.total}</p>
              </div>
              <div>
                <p className="text-neutral-500">น่าจะเป็นมนุษย์</p>
                <p className="text-xl font-bold text-green-600">{behavior.human}</p>
              </div>
              <div>
                <p className="text-neutral-500">น่าจะเป็นบอท</p>
                <p className="text-xl font-bold text-red-600">{behavior.likelyBot}</p>
              </div>
            </div>
            {behavior.total > 0 && (
              <div className="mt-4 text-xs text-neutral-500 border-t border-neutral-100 pt-3">
                <p className="font-medium mb-1">ค่าเฉลี่ย feature (มนุษย์ vs บอท) — สำหรับวิเคราะห์ thesis:</p>
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
          </CardContent>
        </Card>

        {/* filter */}
        <div className="flex gap-2 mb-4">
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
          <p className="text-center text-neutral-500 py-12">ยังไม่มี event</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-500">
                  <th className="py-2 pr-4">เวลา</th>
                  <th className="py-2 pr-4">Score</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">IP</th>
                  <th className="py-2 pr-4">User-Agent</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-neutral-100">
                    <td className="py-2 pr-4 text-neutral-500 whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString("th-TH")}
                    </td>
                    <td className="py-2 pr-4 font-mono font-bold">{e.score}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${actionStyle[e.action]}`}>
                        {e.action}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{e.ip ?? "-"}</td>
                    <td className="py-2 pr-4 text-xs text-neutral-500 max-w-xs truncate">
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
