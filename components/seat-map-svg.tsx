"use client";

// ============================================================
// Seat Map (SVG) — ผังที่นั่งวางทับรูปสถานที่จริง (Phase 2 / D4)
// ============================================================
// ⚠️ ตั้งใจ "ไม่แก้" components/seat-map.tsx ตัวเดิม แต่สร้างไฟล์ใหม่แยก
//    เพราะตัวเดิมคือทางเดินเงินที่ผ่านเทสมาแล้ว คอนเสิร์ตเก่าที่ยังไม่มีกรอบโซน
//    จะใช้ตัวเดิมต่อไปเหมือนเดิมเป๊ะ -> ไม่มีทางพังจากงานนี้
//    แลกมาด้วยโค้ดแผงสรุป/ปุ่มจ่ายเงินที่ซ้ำกันสองที่ — ยอมรับได้เมื่อเทียบกับความเสี่ยง
//
// 🔑 พิกัดที่นั่งเก็บเป็นสัดส่วน 0-1 ของรูป ไม่ใช่พิกเซล
//    เปิดจอไหน ขนาดเท่าไร ตำแหน่งบนรูปก็ตรงเดิมเสมอ
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ZoomIn, ZoomOut } from "lucide-react";

import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { holdAndCreateOrder } from "@/app/actions/booking";

export interface SvgSeat {
  id: string;
  rowLabel: string;
  seatNumber: number;
  status: string; // AVAILABLE | HELD | SOLD | BLOCKED
  x: number; // 0-1
  y: number; // 0-1
}

export interface SvgZone {
  id: string;
  name: string;
  price: number;
  color: string;
  polygon: [number, number][] | null;
  seats: SvgSeat[];
}

interface Selected {
  price: number;
  label: string;
}

// ระดับซูม — ผังจริงมีที่นั่งหลายร้อยจุด ดูบนมือถือ/โน้ตบุ๊กจอเล็กแล้วจิ้มไม่โดน
const ZOOM_STEPS = [1, 1.75, 2.5] as const;
// รัศมีจุดที่นั่ง = สัดส่วนของระยะห่างระหว่างที่นั่ง (ไม่ fix ค่าตายตัว เพราะแต่ละโซนความหนาแน่นไม่เท่ากัน)
//   0.2 = เส้นผ่านศูนย์กลาง 40% ของระยะห่าง -> ยังเห็นช่องไฟระหว่างที่นั่งชัด เหมือนผังโรงมหรสพจริง
//   เคยตั้ง 0.34 แล้วจุดโป่งจนแทบชนกัน อ่านเป็น "ผัง" ไม่ออก (เห็นตอนดูภาพจริง เทสจับไม่ได้)
const SEAT_RADIUS_RATIO = 0.2;
// พื้นที่กดต้องใหญ่กว่าจุดที่มองเห็นมาก ไม่งั้นนิ้วจิ้มไม่โดน (จุดเล็กลงแล้วยิ่งต้องเผื่อ)
const HIT_RADIUS_RATIO = 0.48;
// โชว์เลขที่นั่งบนจุดเมื่อซูมพอ + โซนไม่ใหญ่เกิน — บนมือถือไม่มี hover เลยพึ่ง tooltip ไม่ได้
const LABEL_MIN_ZOOM = 1.75;
const LABEL_MAX_SEATS = 400;

/**
 * หาระยะห่างระหว่างที่นั่งที่ใกล้ที่สุดในโซน (หน่วยเดียวกับ viewBox)
 *
 * ไม่ไล่เทียบทุกคู่ (O(n²) — โซนใหญ่ ๆ หลายพันที่จะหน่วง) แต่ใช้โครงสร้างของผัง:
 * ที่นั่งถูกเจนเป็นกริด -> ดูระยะในแถวเดียวกัน (แกน X) กับระยะระหว่างแถว (แกน Y) พอ
 */
function seatSpacing(seats: SvgSeat[], viewW: number, viewH: number): number {
  if (seats.length < 2) return Math.min(viewW, viewH) / 40;

  const rows = new Map<string, number[]>();
  const rowY = new Map<string, number>();
  for (const seat of seats) {
    if (!rows.has(seat.rowLabel)) rows.set(seat.rowLabel, []);
    rows.get(seat.rowLabel)!.push(seat.x * viewW);
    rowY.set(seat.rowLabel, seat.y * viewH);
  }

  let smallest = Infinity;
  for (const xs of rows.values()) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i] - xs[i - 1];
      if (gap > 0 && gap < smallest) smallest = gap;
    }
  }
  const ys = [...rowY.values()].sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) {
    const gap = ys[i] - ys[i - 1];
    if (gap > 0 && gap < smallest) smallest = gap;
  }

  // โซนที่มีที่นั่งแถวเดียวหรือคอลัมน์เดียว จะหาไม่เจอ -> ใช้ค่าประมาณจากขนาดรูป
  return Number.isFinite(smallest) ? smallest : Math.min(viewW, viewH) / 40;
}

// สีจุดที่นั่งตามสถานะ — ที่ขายแล้ว/ถูกจองอยู่ต้องดูจืดจนรู้ว่ากดไม่ได้
function seatFill(status: string, isSelected: boolean, zoneColor: string): string {
  if (isSelected) return "#ffffff";
  if (status === "SOLD" || status === "HELD") return "#3f3f46";
  if (status === "BLOCKED") return "#27272a";
  return zoneColor;
}

export function SeatMapSvg({
  zones,
  layout,
  maxSeats,
  concertId,
  queueToken,
}: {
  zones: SvgZone[];
  layout: { base64: string; width: number; height: number };
  maxSeats: number;
  concertId: string;
  queueToken: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Map<string, Selected>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState(0);

  const viewW = layout.width;
  const viewH = layout.height;
  const zoom = ZOOM_STEPS[zoomIndex];

  // เลขที่นั่งจะอ่านออกก็ต่อเมื่อซูมพอ และถ้าที่นั่งเยอะมากการวาด text ทุกจุดจะหน่วงเปล่า ๆ
  const totalSeats = zones.reduce((sum, z) => sum + z.seats.length, 0);
  const showLabels = zoom >= LABEL_MIN_ZOOM && totalSeats <= LABEL_MAX_SEATS;

  // ขนาดจุดคำนวณครั้งเดียวต่อโซน — ไม่ต้องคิดใหม่ทุกครั้งที่เลือกที่นั่ง
  const zoneRadius = useMemo(() => {
    const map = new Map<string, { dot: number; hit: number }>();
    for (const zone of zones) {
      const spacing = seatSpacing(zone.seats, viewW, viewH);
      map.set(zone.id, {
        dot: spacing * SEAT_RADIUS_RATIO,
        hit: spacing * HIT_RADIUS_RATIO,
      });
    }
    return map;
  }, [zones, viewW, viewH]);

  // ตำแหน่งวางตัวอักษรแถว (A, B, C) ไว้ซ้ายสุดของแต่ละแถว
  // จำเป็นเพราะบนจุดโชว์ได้แค่ "เลขที่นั่ง" ซึ่งซ้ำกันทุกแถว (ทุกแถวมี 1) ถ้าไม่มีตัวอักษรแถว
  // ผู้ซื้อจะไม่รู้ว่ากำลังจะกดแถวไหน ทั้งที่ในใบเสร็จ/แผงสรุปเรียกว่า A1 B1
  const zoneRowAnchors = useMemo(() => {
    const map = new Map<string, { label: string; x: number; y: number }[]>();
    for (const zone of zones) {
      const leftmost = new Map<string, { x: number; y: number }>();
      for (const seat of zone.seats) {
        const current = leftmost.get(seat.rowLabel);
        if (!current || seat.x < current.x) leftmost.set(seat.rowLabel, { x: seat.x, y: seat.y });
      }
      map.set(
        zone.id,
        [...leftmost.entries()].map(([label, pos]) => ({
          label,
          x: pos.x * viewW,
          y: pos.y * viewH,
        }))
      );
    }
    return map;
  }, [zones, viewW, viewH]);

  function toggleSeat(seat: SvgSeat, zonePrice: number) {
    if (seat.status !== "AVAILABLE") return; // กดได้เฉพาะที่ว่าง

    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(seat.id)) {
        next.delete(seat.id);
        setError(null);
      } else {
        if (next.size >= maxSeats) {
          setError(`เลือกได้สูงสุด ${maxSeats} ที่นั่งต่อบัญชี`);
          return prev;
        }
        setError(null);
        next.set(seat.id, { price: zonePrice, label: `${seat.rowLabel}${seat.seatNumber}` });
      }
      return next;
    });
  }

  const total = useMemo(
    () => Array.from(selected.values()).reduce((a, b) => a + b.price, 0),
    [selected]
  );

  // hold ที่นั่ง + สร้าง order → ไป checkout (ทางเดินเดียวกับผังแบบเดิมทุกประการ)
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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      {/* ---------- ฝั่งซ้าย: ผังบนรูปจริง ---------- */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-fg-faint">แตะที่นั่งว่างบนผังเพื่อเลือก</p>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="ย่อผัง"
              disabled={zoomIndex === 0}
              onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
            >
              <ZoomOut className="size-4" aria-hidden />
            </Button>
            <span className="w-10 text-center font-display text-xs text-fg-faint">{zoom}×</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="ขยายผัง"
              disabled={zoomIndex === ZOOM_STEPS.length - 1}
              onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
            >
              <ZoomIn className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        {/* ซูมแล้วเลื่อนดูได้ — ไม่ให้ผังล้นออกนอกหน้าจอ */}
        <div className="overflow-auto rounded-xl border border-fg/10 bg-ink-950">
          <div className="relative" style={{ width: `${zoom * 100}%` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={layout.base64} alt="ผังที่นั่งของสถานที่จัดงาน" className="block w-full" />
            <svg
              viewBox={`0 0 ${viewW} ${viewH}`}
              className="absolute inset-0 h-full w-full"
              role="group"
              aria-label="ผังที่นั่ง"
            >
              {zones.map((zone) => {
                const radius = zoneRadius.get(zone.id) ?? { dot: 6, hit: 10 };
                return (
                  <g key={zone.id}>
                    {zone.polygon && zone.polygon.length >= 3 && (
                      <polygon
                        points={zone.polygon.map(([x, y]) => `${x * viewW},${y * viewH}`).join(" ")}
                        fill={`${zone.color}14`}
                        stroke={`${zone.color}66`}
                        strokeWidth={viewW / 600}
                      />
                    )}
                    {showLabels &&
                      (zoneRowAnchors.get(zone.id) ?? []).map((row) => (
                        <text
                          key={`row-${zone.id}-${row.label}`}
                          data-row-label={row.label}
                          x={row.x - radius.hit * 1.9}
                          y={row.y}
                          textAnchor="end"
                          dominantBaseline="central"
                          fontSize={radius.dot * 1.4}
                          fill={zone.color}
                          className="pointer-events-none select-none font-display"
                        >
                          {row.label}
                        </text>
                      ))}
                    {zone.seats.map((seat) => {
                      const isSelected = selected.has(seat.id);
                      const clickable = seat.status === "AVAILABLE";
                      const cx = seat.x * viewW;
                      const cy = seat.y * viewH;
                      return (
                        <g
                          key={seat.id}
                          onClick={() => toggleSeat(seat, zone.price)}
                          className={clickable ? "cursor-pointer" : "cursor-not-allowed"}
                        >
                          <title>{`${zone.name} ${seat.rowLabel}${seat.seatNumber} · ${formatTHB(zone.price)}${clickable ? "" : " (ไม่ว่าง)"}`}</title>
                          <circle
                            cx={cx}
                            cy={cy}
                            r={radius.dot}
                            fill={seatFill(seat.status, isSelected, zone.color)}
                            stroke={isSelected ? zone.color : "transparent"}
                            strokeWidth={radius.dot * 0.5}
                            opacity={clickable || isSelected ? 1 : 0.55}
                          />
                          {showLabels && (
                            <text
                              data-seat-number={seat.seatNumber}
                              x={cx}
                              y={cy}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fontSize={radius.dot * 1.25}
                              fill={isSelected ? "#18181b" : "#ffffff"}
                              opacity={clickable || isSelected ? 0.9 : 0.4}
                              className="pointer-events-none select-none font-display"
                            >
                              {seat.seatNumber}
                            </text>
                          )}
                          {/* วงใสทับไว้ให้พื้นที่กดใหญ่กว่าจุดที่เห็น — นิ้วจิ้มโดนง่ายขึ้น */}
                          <circle cx={cx} cy={cy} r={radius.hit} fill="transparent" />
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* ---------- คำอธิบายสี + ราคาแต่ละโซน ---------- */}
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-fg-faint">
          {zones.map((zone) => (
            <span key={zone.id} className="flex items-center gap-1.5">
              <span
                className="inline-block size-3 rounded-full"
                style={{ backgroundColor: zone.color, boxShadow: `0 0 8px ${zone.color}90` }}
                aria-hidden
              />
              {zone.name}
              <span className="text-led text-spot-400">{formatTHB(zone.price)}</span>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-fg/10 pt-3 text-xs text-fg-faint">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-full bg-white ring-2 ring-brand-500" />
            เลือกอยู่
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-full bg-ink-700" />
            ขายแล้ว / มีคนกำลังจอง
          </span>
        </div>
      </div>

      {/* ---------- ฝั่งขวา: สรุป (พฤติกรรมเดียวกับผังแบบเดิม) ---------- */}
      <div className="h-fit rounded-xl border border-fg/10 bg-ink-850 p-4 shadow-md lg:sticky lg:top-24">
        <h3 className="mb-3 font-display font-semibold text-fg">ที่นั่งที่เลือก</h3>

        {selected.size === 0 ? (
          <p className="text-sm text-fg-faint">ยังไม่ได้เลือกที่นั่ง — แตะที่นั่งว่างบนผังได้เลย</p>
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

        <Button
          className="mt-4 w-full"
          disabled={selected.size === 0 || submitting}
          loading={submitting}
          onClick={handleSubmit}
        >
          {submitting ? "กำลังจองที่นั่ง…" : "ดำเนินการชำระเงิน →"}
        </Button>
        <p className="mt-2.5 text-center text-xs text-fg-faint">
          ที่นั่งจะถูกล็อกให้คุณ 5 นาทีเพื่อชำระเงิน
        </p>
      </div>
    </div>
  );
}
