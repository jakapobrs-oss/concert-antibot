"use client";

// Seat map (client component) — เลือกที่นั่งแบบ interactive
// Phase 7: กด "ดำเนินการ" → hold ที่นั่งจริง (Redis lock) → ไปหน้า checkout
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { holdAndCreateOrder } from "@/app/actions/booking";

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

export function SeatMap({
  zones,
  maxSeats,
  concertId,
  queueToken,
}: {
  zones: Zone[];
  maxSeats: number;
  concertId: string;
  queueToken: string;
}) {
  const router = useRouter();
  // เก็บ seatId ที่เลือก + map ไป price
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSeat(seat: Seat, zonePrice: number) {
    if (seat.status !== "AVAILABLE") return; // กดได้เฉพาะที่ว่าง

    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(seat.id)) {
        next.delete(seat.id);
      } else {
        if (next.size >= maxSeats) {
          alert(`เลือกได้สูงสุด ${maxSeats} ที่นั่ง`);
          return prev;
        }
        next.set(seat.id, zonePrice);
      }
      return next;
    });
  }

  const total = useMemo(
    () => Array.from(selected.values()).reduce((a, b) => a + b, 0),
    [selected]
  );

  // hold ที่นั่ง + สร้าง order → ไป checkout
  async function handleSubmit() {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    const result = await holdAndCreateOrder({
      concertId,
      seatIds: Array.from(selected.keys()),
      queueToken,
    });
    if (result.ok) {
      router.push(`/checkout/${result.orderId}`);
    } else {
      setError(result.error);
      setSubmitting(false);
      // ที่นั่งบางที่ถูกจองไป → refresh เพื่อเห็นสถานะใหม่
      if (result.failedSeats?.length) {
        setTimeout(() => router.refresh(), 1500);
      }
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      {/* ฝั่งซ้าย: ผังที่นั่ง */}
      <div className="space-y-6">
        {/* เวที */}
        <div className="bg-neutral-800 text-white text-center py-2 rounded-md text-sm tracking-widest">
          เวที / STAGE
        </div>

        {zones.map((zone) => {
          // group seats ตาม row
          const rows = groupByRow(zone.seats);
          return (
            <div key={zone.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: zone.color }} />
                <h3 className="font-semibold">{zone.name}</h3>
                <span className="text-sm text-neutral-500">{formatTHB(zone.price)}</span>
              </div>
              <div className="space-y-1">
                {Object.entries(rows).map(([row, seats]) => (
                  <div key={row} className="flex items-center gap-1">
                    <span className="w-5 text-xs text-neutral-400">{row}</span>
                    <div className="flex flex-wrap gap-1">
                      {seats.map((seat) => {
                        const isSelected = selected.has(seat.id);
                        return (
                          <button
                            key={seat.id}
                            onClick={() => toggleSeat(seat, zone.price)}
                            disabled={seat.status !== "AVAILABLE"}
                            title={`${seat.rowLabel}${seat.seatNumber}`}
                            className={seatClass(seat.status, isSelected, zone.color)}
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
        <div className="flex gap-4 text-xs text-neutral-500 pt-2">
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded border border-neutral-300 bg-white inline-block" /> ว่าง
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded bg-brand-600 inline-block" /> เลือก
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded bg-neutral-300 inline-block" /> ขายแล้ว
          </span>
        </div>
      </div>

      {/* ฝั่งขวา: สรุป */}
      <div className="lg:sticky lg:top-4 h-fit border border-neutral-200 rounded-lg p-4 bg-white">
        <h3 className="font-semibold mb-3">ที่นั่งที่เลือก</h3>
        {selected.size === 0 ? (
          <p className="text-sm text-neutral-400">ยังไม่ได้เลือกที่นั่ง</p>
        ) : (
          <p className="text-sm text-neutral-600 mb-3">{selected.size} ที่นั่ง</p>
        )}
        <div className="border-t border-neutral-100 pt-3 flex justify-between font-semibold">
          <span>รวม</span>
          <span className="text-brand-600">{formatTHB(total)}</span>
        </div>
        {error && (
          <div className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</div>
        )}
        <Button
          className="w-full mt-4"
          disabled={selected.size === 0 || submitting}
          onClick={handleSubmit}
        >
          {submitting ? "กำลังจองที่นั่ง..." : "ดำเนินการชำระเงิน →"}
        </Button>
        <p className="text-xs text-neutral-400 mt-2 text-center">
          ที่นั่งจะถูกล็อกให้คุณ 5 นาทีเพื่อชำระเงิน
        </p>
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

// คืน className ของปุ่มที่นั่งตามสถานะ
function seatClass(status: string, isSelected: boolean, _zoneColor: string): string {
  const base =
    "w-7 h-7 rounded text-xs flex items-center justify-center transition-colors border";
  if (status === "SOLD" || status === "HELD")
    return `${base} bg-neutral-300 text-neutral-400 border-neutral-300 cursor-not-allowed`;
  if (status === "BLOCKED")
    return `${base} bg-neutral-100 text-neutral-300 border-neutral-200 cursor-not-allowed`;
  if (isSelected)
    return `${base} bg-brand-600 text-white border-brand-600`;
  return `${base} bg-white text-neutral-700 border-neutral-300 hover:border-brand-500 hover:bg-brand-50`;
}
