"use client";

// แผงแอดมินคุมคิว (docs/19 queue-runner) — ต่อ data จริง (poll /api/admin/queue-stats)
//   แสดงตัวเลขสด: รอในคิว / อยู่ข้างใน / ที่นั่งเหลือ / ความจุ (cap)
//   ควบคุม: หยุด-ปล่อยคิว + ปรับ cap สด ๆ (เขียนลง Redis ผ่าน server action)
import { useState, useEffect, useCallback, useRef, useTransition } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setQueuePausedAction, setQueueCapAction } from "@/app/actions/admin-queue";

interface Stats {
  waiting: number;
  inside: number;
  seatsLeft: number | null;
  cap: number;
  paused: boolean;
}
interface ConcertOpt {
  id: string;
  title: string;
}

export function AdminQueuePanel({ concerts }: { concerts: ConcertOpt[] }) {
  const [concertId, setConcertId] = useState(concerts[0]?.id ?? "");
  const [stats, setStats] = useState<Stats | null>(null);
  const [capInput, setCapInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const concertRef = useRef(concertId);
  concertRef.current = concertId;

  const fetchStats = useCallback(async () => {
    const id = concertRef.current;
    if (!id) return;
    try {
      const res = await fetch(`/api/admin/queue-stats?concertId=${id}`);
      if (res.ok) setStats(await res.json());
    } catch {
      /* เงียบ — รอบถัดไป poll ใหม่เอง */
    }
  }, []);

  // poll ตัวเลขสดทุก 2.5 วิ (รีเซ็ตเมื่อเปลี่ยนคอนเสิร์ต)
  useEffect(() => {
    setStats(null);
    fetchStats();
    const id = setInterval(fetchStats, 2500);
    return () => clearInterval(id);
  }, [concertId, fetchStats]);

  function togglePause() {
    if (!stats) return;
    startTransition(async () => {
      const r = await setQueuePausedAction({ concertId, paused: !stats.paused });
      setMsg(r.ok ? null : r.error);
      fetchStats();
    });
  }

  function applyCap() {
    const n = Number(capInput);
    if (!Number.isInteger(n) || n < 1) {
      setMsg("cap ต้องเป็นจำนวนเต็มบวก");
      return;
    }
    startTransition(async () => {
      const r = await setQueueCapAction({ concertId, cap: n });
      setMsg(r.ok ? null : r.error);
      if (r.ok) setCapInput("");
      fetchStats();
    });
  }

  function resetCap() {
    startTransition(async () => {
      const r = await setQueueCapAction({ concertId, cap: null });
      setMsg(r.ok ? null : r.error);
      fetchStats();
    });
  }

  if (concerts.length === 0) {
    return (
      <div className="rounded-xl border border-fg/10 bg-ink-900/60 p-6 text-center text-sm text-fg-faint">
        ยังไม่มีคอนเสิร์ตที่กำลังเปิดขาย (ON_SALE) — เปิดขายก่อนจึงจะคุมคิวได้
      </div>
    );
  }

  const insidePct =
    stats && stats.cap > 0 ? Math.min(100, Math.round((stats.inside / stats.cap) * 100)) : 0;

  return (
    <div className="space-y-5">
      {/* เลือกคอนเสิร์ต */}
      <div>
        <label className="mb-1 block text-xs text-fg-faint">คอนเสิร์ต</label>
        <select
          value={concertId}
          onChange={(e) => setConcertId(e.target.value)}
          className="w-full rounded-lg border border-fg/15 bg-ink-900 px-3 py-2 text-sm text-fg"
        >
          {concerts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>

      {/* สถานะการปล่อยคิว */}
      <div className="flex items-center justify-between rounded-xl border border-fg/10 bg-ink-850 p-4">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
            stats?.paused
              ? "bg-warning/15 text-warning"
              : "bg-brand-500/15 text-brand-400"
          }`}
        >
          {stats?.paused ? "❚❚ หยุดปล่อยคิวชั่วคราว" : "● กำลังปล่อยคิว"}
        </span>
        <Button
          variant={stats?.paused ? "primary" : "outline"}
          onClick={togglePause}
          disabled={pending || !stats}
        >
          {stats?.paused ? (
            <>
              <Play className="mr-1.5 size-4" /> ปล่อยคิวต่อ
            </>
          ) : (
            <>
              <Pause className="mr-1.5 size-4" /> หยุดปล่อยคิว
            </>
          )}
        </Button>
      </div>

      {/* ตัวเลขสด */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="รออยู่ในคิว" value={fmt(stats?.waiting)} tone="fg" />
        <Stat
          label="อยู่ข้างใน / cap"
          value={stats ? `${stats.inside} / ${stats.cap}` : "—"}
          tone="brand"
          sub={stats ? `${insidePct}%` : undefined}
        />
        <Stat label="ที่นั่งเหลือ" value={fmt(stats?.seatsLeft)} tone="spot" />
        <Stat label="ความจุ (cap)" value={fmt(stats?.cap)} tone="fg" />
      </div>

      {/* แถบความจุข้างใน */}
      <div>
        <div className="mb-1 flex justify-between text-[11px] text-fg-faint">
          <span>ความจุข้างใน (concurrency)</span>
          <span>{stats ? `${stats.inside}/${stats.cap}` : "—"}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-ink-700">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              insidePct >= 100 ? "bg-warning" : "bg-brand-500"
            }`}
            style={{ width: `${insidePct}%` }}
          />
        </div>
      </div>

      {/* ปรับ cap */}
      <div className="rounded-xl border border-fg/10 bg-ink-850 p-4">
        <label className="mb-2 block text-xs text-fg-faint">
          ปรับความจุ (cap) สด — override ค่า env เฉพาะคอนเสิร์ตนี้
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            placeholder={stats ? String(stats.cap) : "cap"}
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            className="w-28 rounded-lg border border-fg/15 bg-ink-900 px-3 py-2 text-sm text-fg"
          />
          <Button onClick={applyCap} disabled={pending || !capInput}>
            ตั้งค่า
          </Button>
          <Button variant="outline" onClick={resetCap} disabled={pending}>
            <RotateCcw className="mr-1.5 size-4" /> กลับค่า env
          </Button>
        </div>
      </div>

      {msg && <p className="text-sm text-danger">{msg}</p>}
    </div>
  );
}

function fmt(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString() : "—";
}

// การ์ดตัวเลขสถิติ
function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: "fg" | "brand" | "spot";
  sub?: string;
}) {
  const color = tone === "brand" ? "text-brand-400" : tone === "spot" ? "text-spot-300" : "text-fg";
  return (
    <div className="rounded-xl border border-fg/10 bg-ink-900/60 p-3 text-center">
      <p className="text-[11px] text-fg-faint">{label}</p>
      <p className={`mt-0.5 font-display text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-fg-faint">{sub}</p>}
    </div>
  );
}
