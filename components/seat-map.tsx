"use client";

// Seat map (client component) — เลือกที่นั่งแบบ interactive (โทนเวทีมืด)
// Phase 7: กด "ดำเนินการ" → hold ที่นั่งจริง (Redis lock) → ไปหน้า checkout
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { holdAndCreateOrder } from "@/app/actions/booking";
import { TurnstileWidget } from "@/components/turnstile-widget";

interface Seat {
  id: string;
  rowLabel: string;
  seatNumber: number;
  status: string; // AVAILABLE | HELD | SOLD | BLOCKED
}

interface Zone {
  id: string;
  name: string;
  price: number;
  color: string;
  seats: Seat[];
}

// ข้อมูลที่นั่งที่เลือก — เก็บ label ไว้แสดงเป็นชิปในแผงสรุป
interface Selected {
  price: number;
  label: string;
}

export function SeatMap({
  zones,
  maxSeats,
  remainingQuota,
  concertId,
  queueToken,
  turnstileSiteKey,
}: {
  zones: Zone[];
  maxSeats: number;
  /** โควตาที่ user คนนี้ยังจองได้ (maxSeats หักที่จอง/ค้างชำระแล้ว) — ค่า ณ ตอนโหลดหน้า */
  remainingQuota: number;
  concertId: string;
  queueToken: string;
  turnstileSiteKey: string;
}) {
  const router = useRouter();
  // เก็บ seatId ที่เลือก → ราคา + ป้ายชื่อที่นั่ง
  const [selected, setSelected] = useState<Map<string, Selected>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ด่าน anti-bot ตอนกดซื้อเด้ง CHALLENGE → โชว์ Turnstile แล้วยิงซ้ำพร้อม token
  const [needChallenge, setNeedChallenge] = useState(false);
  // server บอกว่ามี order ค้างชำระ → โชว์ปุ่มพาไปจ่ายต่อ แทนปล่อยให้จมกับ error
  const [pendingOrder, setPendingOrder] = useState<{ orderId: string } | null>(
    null,
  );

  // เพดานเลือกจริงของ user คนนี้ = ลิมิตต่อบัญชี หักโควตาที่ใช้ไปแล้ว
  const effectiveMax = Math.min(maxSeats, remainingQuota);

  function toggleSeat(seat: Seat, zonePrice: number) {
    if (seat.status !== "AVAILABLE") return; // กดได้เฉพาะที่ว่าง

    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(seat.id)) {
        next.delete(seat.id);
        setError(null);
      } else {
        if (next.size >= effectiveMax) {
          // แจ้งในแผงสรุปแทน alert() — ไม่เด้งขวางจังหวะเลือก
          setError(
            remainingQuota < maxSeats
              ? `เลือกได้อีกสูงสุด ${effectiveMax} ที่นั่ง — จองไปแล้ว ${maxSeats - remainingQuota} จากโควตา ${maxSeats} ที่นั่ง/บัญชี`
              : `เลือกได้สูงสุด ${maxSeats} ที่นั่งต่อบัญชี`,
          );
          return prev;
        }
        setError(null);
        next.set(seat.id, {
          price: zonePrice,
          label: `${seat.rowLabel}${seat.seatNumber}`,
        });
      }
      return next;
    });
  }

  const total = useMemo(
    () => Array.from(selected.values()).reduce((a, b) => a + b.price, 0),
    [selected]
  );

  // hold ที่นั่ง + สร้าง order → ไป checkout
  async function handleSubmit(turnstileToken?: string) {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    setPendingOrder(null);
    const result = await holdAndCreateOrder({
      concertId,
      seatIds: Array.from(selected.keys()),
      queueToken,
      turnstileToken,
    });
    if (result.ok) {
      router.push(`/checkout/${result.orderId}`);
    } else {
      setError(result.error);
      setSubmitting(false);
      // มี order ค้างชำระ → โชว์ทางกลับไปจ่ายต่อใต้ข้อความ error
      setPendingOrder(result.pendingOrder ?? null);
      // ยังไม่ปฏิเสธถาวร — ขอให้ยืนยันว่าไม่ใช่บอทแล้วกดใหม่
      setNeedChallenge(result.challenge === true);
      // ที่นั่งบางที่ถูกจองไป → refresh เพื่อเห็นสถานะใหม่
      if (result.failedSeats?.length) {
        setTimeout(() => router.refresh(), 1500);
      }
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      {/* ฝั่งซ้าย: ผังที่นั่ง */}
      <div className="space-y-7">
        {/* เวที — แถบโค้ง + แสงสาดลงผัง */}
        <div className="relative">
          <div className="rounded-t-md rounded-b-[2.5rem] border border-fg/10 bg-gradient-to-b from-ink-700 to-ink-850 py-3 text-center font-display text-sm font-medium tracking-[0.45em] text-fg-dim">
            เวที · STAGE
          </div>
          <div
            className="absolute inset-x-8 -bottom-8 h-10 rounded-[50%] bg-brand-500/15 blur-xl"
            aria-hidden
          />
        </div>

        {zones.map((zone) => {
          // group seats ตาม row
          const rows = groupByRow(zone.seats);
          return (
            <div key={zone.id}>
              <div className="mb-2.5 flex items-center gap-2">
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: zone.color, boxShadow: `0 0 10px ${zone.color}90` }}
                  aria-hidden
                />
                <h3 className="font-display font-semibold text-fg">{zone.name}</h3>
                <span className="text-led text-sm text-spot-400">{formatTHB(zone.price)}</span>
              </div>
              <div className="space-y-1.5">
                {Object.entries(rows).map(([row, seats]) => (
                  <div key={row} className="flex items-center gap-1.5">
                    <span className="w-5 font-display text-xs text-fg-faint">{row}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {seats.map((seat) => {
                        const isSelected = selected.has(seat.id);
                        return (
                          <button
                            key={seat.id}
                            onClick={() => toggleSeat(seat, zone.price)}
                            disabled={seat.status !== "AVAILABLE"}
                            title={`${seat.rowLabel}${seat.seatNumber}`}
                            aria-pressed={isSelected}
                            className={seatClass(seat.status, isSelected)}
                          >
                            {seat.seatNumber}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* legend */}
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-fg/10 pt-4 text-xs text-fg-faint">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-4 rounded-md border border-fg/20 bg-ink-800" /> ว่าง
          </span>
          <span className="flex items-center gap-1.5">
            <span className="shadow-glow-brand inline-block size-4 rounded-md bg-brand-600" /> เลือกอยู่
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-4 rounded-md bg-ink-900" /> ขายแล้ว / มีคนกำลังจอง
          </span>
        </div>
      </div>

      {/* ฝั่งขวา: สรุป */}
      <div className="h-fit rounded-xl border border-fg/10 bg-ink-850 p-4 shadow-md lg:sticky lg:top-24">
        <h3 className="mb-3 font-display font-semibold text-fg">ที่นั่งที่เลือก</h3>

        {selected.size === 0 ? (
          <p className="text-sm text-fg-faint">
            ยังไม่ได้เลือกที่นั่ง — แตะที่นั่งว่างบนผังได้เลย
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {Array.from(selected.entries()).map(([id, s]) => (
              <span
                key={id}
                className="text-led inline-flex items-center gap-1 rounded-md border border-brand-500/30 bg-brand-500/15 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-brand-300"
              >
                {s.label}
                <button
                  type="button"
                  aria-label={`เอาที่นั่ง ${s.label} ออก`}
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Map(prev);
                      next.delete(id);
                      return next;
                    })
                  }
                  className="rounded p-0.5 transition-colors hover:bg-brand-500/25 hover:text-fg"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-end justify-between border-t border-fg/10 pt-3">
          <span className="font-medium text-fg-dim">
            รวม{selected.size > 0 ? ` ${selected.size} ที่นั่ง` : ""}
          </span>
          <span className="text-led text-xl font-bold text-spot-300">{formatTHB(total)}</span>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-danger/25 bg-danger/10 p-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        {pendingOrder && (
          <button
            type="button"
            onClick={() => router.push(`/checkout/${pendingOrder.orderId}`)}
            className="mt-2 w-full rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-sm font-semibold text-warning transition-colors hover:bg-warning/25"
          >
            ไปชำระเงินต่อ (คำสั่งซื้อเดิมยังอยู่) →
          </button>
        )}

        {needChallenge && (
          <div className="mt-3 space-y-2 rounded-md border border-warning/25 bg-warning/10 p-3">
            <p className="text-center text-xs text-warning">
              ยืนยันว่าคุณไม่ใช่บอท แล้วระบบจะจองที่นั่งให้ต่ออัตโนมัติ
            </p>
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              action="purchase"
              size="compact"
              onVerify={(token) => {
                setNeedChallenge(false);
                void handleSubmit(token);
              }}
            />
          </div>
        )}

        <Button
          className="mt-4 w-full"
          disabled={
            selected.size === 0 ||
            submitting ||
            remainingQuota === 0 ||
            selected.size > remainingQuota
          }
          loading={submitting}
          onClick={() => handleSubmit()}
        >
          {submitting ? "กำลังจองที่นั่ง…" : "ดำเนินการชำระเงิน →"}
        </Button>
        {remainingQuota === 0 ? (
          <p className="mt-2.5 text-center text-xs text-warning">
            คุณจองครบโควตา {maxSeats} ที่นั่ง/บัญชีของคอนเสิร์ตนี้แล้ว
          </p>
        ) : (
          <p className="mt-2.5 text-center text-xs text-fg-faint">
            {remainingQuota < maxSeats
              ? `จองได้อีก ${remainingQuota} ที่นั่ง · ที่นั่งจะถูกล็อกให้คุณ 5 นาทีเพื่อชำระเงิน`
              : "ที่นั่งจะถูกล็อกให้คุณ 5 นาทีเพื่อชำระเงิน"}
          </p>
        )}
      </div>
    </div>
  );
}

// group seat array ตาม rowLabel
function groupByRow(seats: Seat[]): Record<string, Seat[]> {
  return seats.reduce<Record<string, Seat[]>>((acc, s) => {
    (acc[s.rowLabel] ??= []).push(s);
    return acc;
  }, {});
}

// คืน className ของปุ่มที่นั่งตามสถานะ — ที่ว่างชวนกด ที่เลือกติดไฟแดงเต้น
function seatClass(status: string, isSelected: boolean): string {
  const base =
    "flex h-7 w-7 items-center justify-center rounded-md border font-display text-xs transition-all duration-150";
  if (status === "SOLD" || status === "HELD")
    return `${base} cursor-not-allowed border-transparent bg-ink-900 text-fg/20`;
  if (status === "BLOCKED")
    return `${base} cursor-not-allowed border-transparent bg-ink-900/50 text-fg/10`;
  if (isSelected)
    return `${base} animate-glow-pulse border-brand-500 bg-brand-600 font-semibold text-white`;
  return `${base} border-fg/15 bg-ink-800 text-fg-dim hover:-translate-y-0.5 hover:border-brand-400 hover:text-fg hover:shadow-glow-brand`;
}
