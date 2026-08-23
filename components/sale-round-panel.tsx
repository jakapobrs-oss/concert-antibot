"use client";

// แผง "รอบกดบัตร" ในหน้าคอนเสิร์ต (Phase 2.1, docs/21)
// โหลดผ่าน API เพราะหน้าคอนเสิร์ตเป็นหน้าแคช (revalidate 60) — สถานะรายบุคคลห้ามติดแคชร่วมกัน
// คอนเสิร์ตที่ไม่มีรอบ → คอมโพเนนต์นี้ไม่ render อะไรเลย (หน้าเดิมเหมือนเดิมเป๊ะ)
import { useCallback, useEffect, useState } from "react";
import { Lock, Check, Clock, Ticket, KeyRound, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { preRegisterForRound, redeemRoundAccessCode } from "@/app/actions/sale-round";
import { Countdown } from "@/components/countdown";

type RoundState = "OPEN_ELIGIBLE" | "OPEN_DENIED" | "UPCOMING" | "ENDED" | "SOLD_OUT";

type RoundView = {
  id: string;
  name: string;
  audience: "FANCLUB" | "PARTNER" | "MEMBER_ONLY" | "PUBLIC";
  audienceLabel: string;
  startAt: string;
  endAt: string;
  state: RoundState;
  denyReason: string | null;
  denyMessage: string | null;
  requiresPreRegistration: boolean;
  preRegisterEndAt: string;
  canPreRegisterNow: boolean;
  preRegistered: boolean;
  preRegCode: string | null;
  unlocked: boolean;
  maxTicketsPerUser: number | null;
  seatQuota: number | null;
  seatsTaken: number | null;
};

type RoundsResponse = {
  hasRounds: boolean;
  soldOut: boolean;
  seatsLeft: number;
  me: { loggedIn: boolean; membershipTier: "STANDARD" | "PREMIUM" | null } | null;
  entry:
    | { ok: true; roundId: string | null; roundName: string | null }
    | { ok: false; reason: string; message: string; nextRoundAt: string | null }
    | null;
  rounds: RoundView[];
};

const timeFmt = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

const stateBadge: Record<RoundState, { text: string; tone: "success" | "danger" | "info" | "neutral" }> = {
  OPEN_ELIGIBLE: { text: "เปิดอยู่ — คุณเข้าได้", tone: "success" },
  OPEN_DENIED: { text: "เปิดอยู่ — คุณยังไม่มีสิทธิ์", tone: "danger" },
  UPCOMING: { text: "ยังไม่เริ่ม", tone: "info" },
  ENDED: { text: "จบรอบแล้ว", tone: "neutral" },
  SOLD_OUT: { text: "ไม่เปิดขาย — บัตรหมดก่อน", tone: "neutral" },
};

export function SaleRoundPanel({ concertId }: { concertId: string }) {
  const [data, setData] = useState<RoundsResponse | null>(null);
  const [busyRound, setBusyRound] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [code, setCode] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/concerts/${concertId}/rounds`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      /* หน้าคอนเสิร์ตต้องใช้งานต่อได้แม้แผงนี้โหลดไม่ขึ้น */
    }
  }, [concertId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data?.hasRounds) return null;

  const partnerRound = data.rounds.find((r) => r.audience === "PARTNER" && !r.unlocked);

  async function handlePreRegister(roundId: string) {
    setBusyRound(roundId);
    setMessage(null);
    const res = await preRegisterForRound({ saleRoundId: roundId });
    setMessage(
      res.ok
        ? { ok: true, text: `ลงทะเบียนล่วงหน้าแล้ว — โค้ดของคุณคือ ${res.code}` }
        : { ok: false, text: res.error }
    );
    setBusyRound(null);
    await load();
  }

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    setBusyRound("code");
    setMessage(null);
    const res = await redeemRoundAccessCode({ concertId, code });
    if (res.ok) {
      setMessage({ ok: true, text: `ปลดล็อก${res.roundName}แล้ว` });
      setCode("");
    } else {
      setMessage({ ok: false, text: res.error });
    }
    setBusyRound(null);
    await load();
  }

  return (
    <div>
      <h2 className="mb-1 font-display text-xl font-semibold text-fg">รอบกดบัตร</h2>
      <p className="mb-4 text-sm text-fg-faint">
        งานนี้แบ่งขายเป็นรอบตามลำดับสิทธิ์ — แต่ละรอบยังเข้าคิวแบบสุ่มลำดับเหมือนกันทุกคน
      </p>

      {/* บัตรหมดทั้งงาน — ประกาศทับทุกอย่าง (ตรงกับที่ผู้จัดประกาศ sold out) */}
      {data.soldOut && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-4">
          <p className="font-display font-semibold text-danger">บัตรหมดแล้ว (SOLD OUT)</p>
          <p className="mt-0.5 text-sm text-fg-dim">
            บัตรหมดตั้งแต่รอบก่อนหน้า — รอบที่ยังไม่ถึงเวลาจะไม่เปิดขาย
          </p>
        </div>
      )}

      {/* สรุปว่าตอนนี้ฉันกดได้ไหม */}
      {!data.soldOut && data.entry && (
        <div
          className={`mb-4 rounded-xl border p-4 text-sm ${
            data.entry.ok
              ? "border-success/25 bg-success/10 text-success"
              : "border-warning/25 bg-warning/10 text-warning"
          }`}
        >
          {data.entry.ok
            ? `ตอนนี้คุณกดบัตรได้ใน${data.entry.roundName ?? "รอบที่เปิดอยู่"}`
            : data.entry.message}
        </div>
      )}

      <ol className="space-y-3">
        {data.rounds.map((r) => {
          const badge = stateBadge[r.state];
          return (
            <li
              key={r.id}
              className={`rounded-xl border bg-ink-850 p-4 ${
                r.state === "OPEN_ELIGIBLE"
                  ? "border-success/30"
                  : r.state === "ENDED" || r.state === "SOLD_OUT"
                    ? "border-fg/5 opacity-60"
                    : "border-fg/10"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display font-semibold text-fg">{r.name}</h3>
                <Badge tone={badge.tone}>{badge.text}</Badge>
              </div>

              <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-faint">
                <CalendarClock className="size-3.5 shrink-0" />
                {timeFmt.format(new Date(r.startAt))} – {timeFmt.format(new Date(r.endAt))}
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <span className="rounded-md bg-fg/10 px-2 py-0.5 text-fg-dim">{r.audienceLabel}</span>
                {r.maxTicketsPerUser !== null && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-fg/10 px-2 py-0.5 text-fg-dim">
                    <Ticket className="size-3" /> จำกัด {r.maxTicketsPerUser} ใบ/คน
                  </span>
                )}
                {r.seatQuota !== null && (
                  <span className="rounded-md bg-fg/10 px-2 py-0.5 text-fg-dim">
                    โควต้า {r.seatsTaken ?? 0}/{r.seatQuota} ที่นั่ง
                  </span>
                )}
                {r.requiresPreRegistration && (
                  <span className="rounded-md bg-brand-500/15 px-2 py-0.5 text-brand-300">
                    ต้องลงทะเบียนล่วงหน้า
                  </span>
                )}
              </div>

              {/* สิ่งที่ผู้ใช้ต้องทำต่อ */}
              {r.state !== "ENDED" && r.state !== "SOLD_OUT" && (
                <div className="mt-3 space-y-2">
                  {r.preRegistered && r.preRegCode && (
                    <p className="flex items-center gap-1.5 text-sm text-success">
                      <Check className="size-4 shrink-0" />
                      ลงทะเบียนล่วงหน้าแล้ว · โค้ด{" "}
                      <code className="rounded bg-success/10 px-1.5 py-0.5 font-mono text-xs">
                        {r.preRegCode}
                      </code>
                    </p>
                  )}

                  {r.canPreRegisterNow && (
                    <div>
                      <Button
                        size="sm"
                        variant="subtle"
                        loading={busyRound === r.id}
                        onClick={() => handlePreRegister(r.id)}
                      >
                        ลงทะเบียนล่วงหน้า
                      </Button>
                      <p className="mt-1 text-xs text-fg-faint">
                        ปิดรับ {timeFmt.format(new Date(r.preRegisterEndAt))} — เลยเวลานี้แล้วลงไม่ได้
                      </p>
                    </div>
                  )}

                  {r.state === "OPEN_DENIED" && r.denyMessage && !r.canPreRegisterNow && (
                    <p className="flex items-center gap-1.5 text-sm text-fg-faint">
                      <Lock className="size-3.5 shrink-0" />
                      {r.denyMessage}
                    </p>
                  )}

                  {r.unlocked && (
                    <p className="flex items-center gap-1.5 text-sm text-success">
                      <Check className="size-4 shrink-0" /> ปลดล็อกด้วยโค้ดสิทธิ์แล้ว
                    </p>
                  )}

                  {r.state === "UPCOMING" && (
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-faint">
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-3.5 shrink-0" />
                        รอบนี้เริ่ม {timeFmt.format(new Date(r.startAt))}
                      </span>
                      {/* นับถอยหลัง แล้วพอถึงเวลาไปถาม server ว่าเปิดจริงหรือยัง — ผู้ใช้ไม่ต้องกด F5 รัว */}
                      <span className="font-medium text-brand-300">
                        <Countdown targetAt={r.startAt} onReach={load} />
                      </span>
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* กรอกโค้ดสิทธิ์ — โชว์เฉพาะเมื่อมีรอบพาร์ทเนอร์ที่ยังไม่ปลดล็อก */}
      {partnerRound && (
        <form onSubmit={handleRedeem} className="mt-4 rounded-xl border border-fg/10 bg-ink-900/60 p-4">
          <label htmlFor="access-code" className="flex items-center gap-1.5 text-sm font-medium text-fg">
            <KeyRound className="size-4 text-brand-300" />
            มีโค้ดสิทธิ์จากผู้สนับสนุน?
          </label>
          <p className="mt-1 text-xs text-fg-faint">
            เช่น โค้ดพรีเซลบัตรเครดิต หรือรหัสจากใบเสร็จ — ใช้ปลดล็อก{partnerRound.name}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              id="access-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="กรอกโค้ด"
              className="min-w-44 flex-1 uppercase"
              maxLength={64}
            />
            <Button type="submit" variant="outline" loading={busyRound === "code"}>
              ใช้โค้ด
            </Button>
          </div>
        </form>
      )}

      {message && (
        <p role="status" className={`mt-3 text-sm ${message.ok ? "text-success" : "text-danger"}`}>
          {message.text}
        </p>
      )}

      {data.me && !data.me.loggedIn && (
        <p className="mt-3 text-xs text-fg-faint">
          เข้าสู่ระบบเพื่อดูว่าคุณมีสิทธิ์รอบไหน และลงทะเบียนล่วงหน้า
        </p>
      )}
    </div>
  );
}
