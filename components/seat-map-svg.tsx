"use client";

// ============================================================
// Seat Map (SVG) — ผังระดับ "โซน" วางทับรูปสถานที่จริง
// ============================================================
// ⚠️ ตั้งใจ "ไม่แก้" components/seat-map.tsx ตัวเดิม แต่สร้างไฟล์ใหม่แยก
//    เพราะตัวเดิมคือทางเดินเงินที่ผ่านเทสมาแล้ว คอนเสิร์ตเก่าที่ยังไม่มีกรอบโซน
//    จะใช้ตัวเดิมต่อไปเหมือนเดิมเป๊ะ -> ไม่มีทางพังจากงานนี้
//
// 📌 หน้าที่ของผังนี้คือตอบ 2 คำถามเท่านั้น: "เวทีอยู่ตรงไหน" และ "โซนนี้อยู่ตรงไหนของเวที"
//    ไม่ได้ทำหน้าที่โชว์ที่นั่งรายตัวบนรูป (รุ่นก่อนโปรยจุดหลายพันจุดทับรูป ซึ่งเกินความจำเป็น
//    และทำให้ต้องคำนวณพื้นที่กรอบเพื่อหาระยะห่างจุด) -> การเลือกที่นั่งย้ายไปแผงย่อยข้างล่าง
//
// ♿ ผลพลอยได้ที่ตั้งใจ: แผงเลือกที่นั่งเป็น <button> จริงใน HTML ไม่ใช่วงกลมใน SVG
//    ผู้ใช้คีย์บอร์ด/โปรแกรมอ่านหน้าจอจึงเลือกที่นั่งได้ (ของเดิมกดด้วยคีย์บอร์ดไม่ได้ทั้งผัง)
//    และรายการโซนด้านขวาของรูปคือทางเลือกโซนที่ไม่ต้องพึ่งการคลิกบนรูป
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ZoomIn, ZoomOut } from "lucide-react";

import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { holdAndCreateOrder } from "@/app/actions/booking";
import {
  distanceFromStage,
  polygonPoleOfInaccessibility,
  type Polygon,
} from "@/lib/seatmap/polygon";

export interface SvgSeat {
  id: string;
  rowLabel: string;
  seatNumber: number;
  status: string; // AVAILABLE | HELD | SOLD | BLOCKED
}

export interface SvgZone {
  id: string;
  name: string;
  /** ชื่อเรทราคาที่โซนนี้สังกัด — null = โซนเก่าที่ยังไม่ได้นำเข้าจาก Excel */
  tier: string | null;
  price: number;
  color: string;
  polygon: Polygon | null;
  seats: SvgSeat[];
}

interface Selected {
  price: number;
  label: string;
}

// ระดับซูม — ผังสนามจริงมีโซนเล็ก ๆ ริมขอบที่ชื่อโซนอ่านไม่ออกถ้าไม่ขยาย
const ZOOM_STEPS = [1, 1.75, 2.5] as const;
// ขนาดตัวอักษรชื่อโซนบนผัง = สัดส่วนของความกว้างรูป (ไม่ fix พิกเซล เพราะรูปคนละขนาดกัน)
const ZONE_LABEL_RATIO = 1 / 46;
// ความทึบของแผ่นสีทับโซน (เลขฐาน 16 ต่อท้ายรหัสสี) — ต้องเห็นสีชัดแต่ยังเห็นรูปผังข้างใต้
const ZONE_FILL_ALPHA = "59"; // ~35%
const ZONE_FILL_ALPHA_ACTIVE = "b3"; // ~70% สำหรับโซนที่กำลังเลือก
// โซนที่ขายหมดแล้ววาดเป็นสีเทา ไม่ใช่สีเรท — กันคนเสียเวลากดเข้าไปแล้วพบว่าไม่เหลือที่
const SOLD_OUT_COLOR = "#52525b";

export function SeatMapSvg({
  zones,
  layout,
  stagePolygon,
  maxSeats,
  concertId,
  queueToken,
}: {
  zones: SvgZone[];
  layout: { base64: string; width: number; height: number };
  stagePolygon: Polygon | null;
  maxSeats: number;
  concertId: string;
  queueToken: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Map<string, Selected>>(new Map());
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState(0);

  const viewW = layout.width;
  const viewH = layout.height;
  const zoom = ZOOM_STEPS[zoomIndex];

  /**
   * เรียงโซน "ใกล้เวทีก่อน" — นี่คือส่วนที่ตอบคำถาม "โซนนี้อยู่ตรงไหนของเวที" เป็นตัวหนังสือ
   * คนที่ไม่อยากกวาดสายตาหาบนรูป (หรือใช้โปรแกรมอ่านหน้าจอ) ก็เลือกโซนจากรายการนี้ได้เลย
   * ไม่มีกรอบเวที -> เรียงตามราคาแพงไปถูกแทน ซึ่งเป็นลำดับที่ผังขายบัตรจริงใช้กัน
   */
  const orderedZones = useMemo(() => {
    return [...zones]
      .map((zone) => ({
        zone,
        available: zone.seats.filter((seat) => seat.status === "AVAILABLE").length,
        distance: zone.polygon ? distanceFromStage(zone.polygon, stagePolygon) : Infinity,
      }))
      .sort((a, b) =>
        stagePolygon
          ? a.distance - b.distance || b.zone.price - a.zone.price
          : b.zone.price - a.zone.price || a.zone.name.localeCompare(b.zone.name),
      );
  }, [zones, stagePolygon]);

  const availableByZone = useMemo(
    () => new Map(orderedZones.map((item) => [item.zone.id, item.available])),
    [orderedZones],
  );

  /**
   * คำอธิบายสี (legend) — ยุบโซนที่อยู่เรทเดียวกันเหลือบรรทัดเดียว
   *
   * ที่มา: ผังสนามจริง (อิมแพ็ค อารีน่า) มี 69 โซน แต่มีแค่ 7 เรทราคา
   * ถ้าไล่โชว์ทีละโซนจะได้ป้ายสีซ้ำ ๆ 69 อัน อ่านไม่ออกว่าตกลงมีกี่ราคา
   * จัดกลุ่มด้วย "ชื่อเรท" ถ้ามี (มาจากไฟล์ Excel) ไม่งั้นถอยไปใช้ สี+ราคา เหมือนเดิม
   */
  const priceTiers = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; price: number; color: string; zoneCount: number; seats: number }
    >();
    for (const zone of zones) {
      const key = zone.tier ?? `${zone.color}|${zone.price}`;
      const tier = map.get(key);
      if (tier) {
        tier.zoneCount += 1;
        tier.seats += zone.seats.length;
      } else {
        map.set(key, {
          key,
          label: zone.tier ?? formatTHB(zone.price),
          price: zone.price,
          color: zone.color,
          zoneCount: 1,
          seats: zone.seats.length,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.price - a.price || a.label.localeCompare(b.label));
  }, [zones]);

  const activeZone = useMemo(
    () => zones.find((zone) => zone.id === activeZoneId) ?? null,
    [zones, activeZoneId],
  );

  /** ที่นั่งของโซนที่เปิดอยู่ จัดกลุ่มตามแถว (A, B, C…) ตามลำดับที่เจนมา */
  const activeRows = useMemo(() => {
    if (!activeZone) return [];
    const rows = new Map<string, SvgSeat[]>();
    for (const seat of activeZone.seats) {
      const bucket = rows.get(seat.rowLabel);
      if (bucket) bucket.push(seat);
      else rows.set(seat.rowLabel, [seat]);
    }
    return [...rows.entries()].map(([label, seats]) => ({
      label,
      seats: [...seats].sort((a, b) => a.seatNumber - b.seatNumber),
    }));
  }, [activeZone]);

  function toggleSeat(seat: SvgSeat, zonePrice: number, zoneName: string) {
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
        // ต้องมีชื่อโซนนำหน้าเสมอ — ผังสนามจริงมีหลายสิบโซน และทุกโซนมีแถว A เลข 1 เหมือนกันหมด
        // ถ้าโชว์แค่ "A1" ผู้ซื้อจะแยกไม่ออกว่าที่นั่งในตะกร้าอยู่โซนไหน ราคาเท่าไร
        next.set(seat.id, {
          price: zonePrice,
          label: `${zoneName} ${seat.rowLabel}${seat.seatNumber}`,
        });
      }
      return next;
    });
  }

  const total = useMemo(
    () => Array.from(selected.values()).reduce((sum, item) => sum + item.price, 0),
    [selected],
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

  const labelSize = viewW * ZONE_LABEL_RATIO;
  const stageLabelPoint =
    stagePolygon && stagePolygon.length >= 3
      ? polygonPoleOfInaccessibility(stagePolygon)
      : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      {/* ---------- ฝั่งซ้าย: ผังโซนบนรูปจริง + แผงเลือกที่นั่ง ---------- */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm text-fg-faint">
            เลือกโซนบนผัง แล้วเลือกที่นั่งด้านล่าง
          </p>
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
            <img src={layout.base64} alt="ผังสถานที่จัดงาน" className="block w-full" />
            <svg
              viewBox={`0 0 ${viewW} ${viewH}`}
              className="absolute inset-0 h-full w-full"
              role="group"
              aria-label="ผังโซนที่นั่ง"
            >
              {/* ---- เวที ---- */}
              {stagePolygon && stageLabelPoint && (
                <g data-stage="true">
                  <polygon
                    points={stagePolygon.map(([x, y]) => `${x * viewW},${y * viewH}`).join(" ")}
                    fill="#e4e4e7cc"
                    stroke="#fafafa"
                    strokeWidth={viewW / 400}
                  />
                  <text
                    x={stageLabelPoint[0] * viewW}
                    y={stageLabelPoint[1] * viewH}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={labelSize}
                    fill="#18181b"
                    className="pointer-events-none select-none font-display font-semibold"
                    style={{ letterSpacing: "0.2em" }}
                  >
                    เวที · STAGE
                  </text>
                </g>
              )}

              {/* ---- โซน ---- */}
              {orderedZones.map(({ zone, available }) => {
                if (!zone.polygon || zone.polygon.length < 3) return null;
                const isActive = zone.id === activeZoneId;
                const soldOut = available === 0;
                const baseColor = soldOut ? SOLD_OUT_COLOR : zone.color;
                const labelPoint = polygonPoleOfInaccessibility(zone.polygon);
                return (
                  <g
                    key={zone.id}
                    data-zone-name={zone.name}
                    onClick={() => setActiveZoneId(soldOut ? null : zone.id)}
                    className={soldOut ? "cursor-not-allowed" : "cursor-pointer"}
                  >
                    <title>
                      {`${zone.name} · ${formatTHB(zone.price)} · ${soldOut ? "เต็มแล้ว" : `ว่าง ${available} ที่`}`}
                    </title>
                    <polygon
                      points={zone.polygon.map(([x, y]) => `${x * viewW},${y * viewH}`).join(" ")}
                      fill={`${baseColor}${isActive ? ZONE_FILL_ALPHA_ACTIVE : ZONE_FILL_ALPHA}`}
                      stroke={isActive ? "#ffffff" : baseColor}
                      strokeWidth={(viewW / 500) * (isActive ? 2.5 : 1)}
                    />
                    <text
                      x={labelPoint[0] * viewW}
                      y={labelPoint[1] * viewH}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={labelSize}
                      fill="#ffffff"
                      opacity={soldOut ? 0.5 : 1}
                      className="pointer-events-none select-none font-display font-semibold"
                      // ขอบดำจาง ๆ รอบตัวอักษร — กันชื่อโซนกลืนกับสีพื้นที่แอดมินตั้งให้ตรงกับรูป
                      style={{ paintOrder: "stroke", stroke: "#00000099", strokeWidth: labelSize / 6 }}
                    >
                      {zone.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* ---------- คำอธิบายสี = เรทราคา ---------- */}
        <div className="flex flex-col gap-2 text-xs text-fg-faint">
          {priceTiers.map((tier) => (
            <div key={tier.key} className="flex items-center gap-2">
              <span
                className="inline-block size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: tier.color, boxShadow: `0 0 8px ${tier.color}90` }}
                aria-hidden
              />
              <span className="w-24 shrink-0 font-display text-fg-dim">{tier.label}</span>
              <span className="text-led w-20 shrink-0 text-spot-400">{formatTHB(tier.price)}</span>
              <span className="min-w-0">
                {tier.zoneCount} โซน · {tier.seats.toLocaleString()} ที่นั่ง
              </span>
            </div>
          ))}
        </div>

        {/* ---------- รายการโซน (เรียงตามระยะจากเวที) ---------- */}
        <div>
          <h3 className="mb-2 font-display text-sm font-semibold text-fg">
            {stagePolygon ? "โซนทั้งหมด — เรียงจากใกล้เวทีที่สุด" : "โซนทั้งหมด"}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {orderedZones.map(({ zone, available }) => {
              const soldOut = available === 0;
              return (
                <button
                  key={zone.id}
                  type="button"
                  disabled={soldOut}
                  aria-pressed={zone.id === activeZoneId}
                  onClick={() => setActiveZoneId(zone.id)}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    zone.id === activeZoneId
                      ? "border-brand-500 bg-brand-500/15 text-fg"
                      : soldOut
                        ? "cursor-not-allowed border-transparent bg-ink-900 text-fg/25"
                        : "border-fg/15 bg-ink-800 text-fg-dim hover:border-brand-400 hover:text-fg"
                  }`}
                >
                  <span
                    className="inline-block size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: soldOut ? SOLD_OUT_COLOR : zone.color }}
                    aria-hidden
                  />
                  <span className="font-display font-semibold">{zone.name}</span>
                  <span className="text-led text-spot-400">{formatTHB(zone.price)}</span>
                  <span className="text-fg-faint">{soldOut ? "เต็ม" : `ว่าง ${available}`}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ---------- แผงเลือกที่นั่งของโซนที่เปิดอยู่ ---------- */}
        {activeZone ? (
          <div className="rounded-xl border border-fg/10 bg-ink-900/60 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: activeZone.color, boxShadow: `0 0 10px ${activeZone.color}90` }}
                aria-hidden
              />
              <h3 className="font-display font-semibold text-fg">โซน {activeZone.name}</h3>
              {activeZone.tier && <span className="text-xs text-fg-faint">({activeZone.tier})</span>}
              <span className="text-led text-sm text-spot-400">{formatTHB(activeZone.price)}</span>
              <span className="text-xs text-fg-faint">
                ว่าง {availableByZone.get(activeZone.id) ?? 0} / {activeZone.seats.length} ที่
              </span>
              <button
                type="button"
                onClick={() => setActiveZoneId(null)}
                className="ml-auto rounded-md px-2 py-1 text-xs text-fg-faint transition-colors hover:bg-fg/10 hover:text-fg"
              >
                ปิดโซนนี้
              </button>
            </div>

            {/* เลื่อนดูได้ในกล่องตัวเอง — โซนใหญ่มีหลายสิบแถว ไม่ควรดันหน้าเว็บยาวจนหาปุ่มจ่ายเงินไม่เจอ */}
            <div className="max-h-96 space-y-1.5 overflow-auto pr-1">
              {activeRows.map((row) => (
                <div key={row.label} className="flex items-start gap-1.5">
                  <span className="w-6 shrink-0 pt-1.5 font-display text-xs text-fg-faint">
                    {row.label}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {row.seats.map((seat) => (
                      <button
                        key={seat.id}
                        type="button"
                        onClick={() => toggleSeat(seat, activeZone.price, activeZone.name)}
                        disabled={seat.status !== "AVAILABLE"}
                        title={`${activeZone.name} ${seat.rowLabel}${seat.seatNumber}`}
                        aria-label={`ที่นั่ง ${activeZone.name} แถว ${seat.rowLabel} เลข ${seat.seatNumber}`}
                        aria-pressed={selected.has(seat.id)}
                        data-seat-number={seat.seatNumber}
                        className={seatClass(seat.status, selected.has(seat.id))}
                      >
                        {seat.seatNumber}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-fg/15 p-4 text-center text-sm text-fg-faint">
            ยังไม่ได้เลือกโซน — แตะโซนบนผัง หรือเลือกจากรายการโซนด้านบน
          </p>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-fg/10 pt-3 text-xs text-fg-faint">
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

      {/* ---------- ฝั่งขวา: สรุป (พฤติกรรมเดียวกับผังแบบเดิม) ---------- */}
      <div className="h-fit rounded-xl border border-fg/10 bg-ink-850 p-4 shadow-md lg:sticky lg:top-24">
        <h3 className="mb-3 font-display font-semibold text-fg">ที่นั่งที่เลือก</h3>

        {selected.size === 0 ? (
          <p className="text-sm text-fg-faint">ยังไม่ได้เลือกที่นั่ง — เลือกโซนแล้วแตะที่นั่งว่าง</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {Array.from(selected.entries()).map(([id, item]) => (
              <span
                key={id}
                className="text-led inline-flex items-center gap-1 rounded-md border border-brand-500/30 bg-brand-500/15 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-brand-300"
              >
                {item.label}
                <button
                  type="button"
                  aria-label={`เอาที่นั่ง ${item.label} ออก`}
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

// className ของปุ่มที่นั่ง — ชุดเดียวกับผังแบบเดิม (components/seat-map.tsx) ให้หน้าตาเหมือนกันทั้งระบบ
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
