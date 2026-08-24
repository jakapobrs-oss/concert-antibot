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
import {
  holdAndCreateOrder,
  holdBestAvailable,
  holdStandingZone,
} from "@/app/actions/booking";
import { formatSeatLabel } from "@/lib/seatmap/seat-rows";
import {
  distanceFromStage,
  polygonPoleOfInaccessibility,
  stageSideAuto,
  type Polygon,
  type StageSide,
} from "@/lib/seatmap/polygon";
import { seatGridRenderHints } from "@/lib/seatmap/render-hints";

export interface SvgSeat {
  id: string;
  rowLabel: string;
  seatNumber: number;
  status: string; // AVAILABLE | HELD | SOLD | BLOCKED
}

interface SvgZoneBase {
  id: string;
  name: string;
  /** ชื่อเรทราคาที่โซนนี้สังกัด — null = โซนเก่าที่ยังไม่ได้นำเข้าจาก Excel */
  tier: string | null;
  price: number;
  color: string;
  polygon: Polygon | null;
  stageSide: StageSide | null;
}

export interface SvgZone extends SvgZoneBase {
  isStanding: boolean;
  /** หน้าแรกรู้แค่ยอดรวม ที่นั่งรายตัวของโซนนั่งต้องโหลดผ่าน endpoint หลังผ่านคิว */
  availability: { available: number; total: number };
}

interface Selected {
  price: number;
  label: string;
}

interface StandingSelection {
  zoneId: string;
  zoneName: string;
  price: number;
  quantity: number;
}

interface BestAvailableSelection {
  zoneId: string;
  zoneName: string;
  price: number;
  quantity: number;
}

type SeatedMode = "best" | "manual";

// ระดับซูม — ผังสนามจริงมีโซนเล็ก ๆ ริมขอบที่ชื่อโซนอ่านไม่ออกถ้าไม่ขยาย
const ZOOM_STEPS = [1, 1.75, 2.5] as const;
// ขนาดตัวอักษรชื่อโซนบนผัง = สัดส่วนของความกว้างรูป (ไม่ fix พิกเซล เพราะรูปคนละขนาดกัน)
const ZONE_LABEL_RATIO = 1 / 46;
// ความทึบของแผ่นสีทับโซน (เลขฐาน 16 ต่อท้ายรหัสสี) — ต้องเห็นสีชัดแต่ยังเห็นรูปผังข้างใต้
const ZONE_FILL_ALPHA = "59"; // ~35%
const ZONE_FILL_ALPHA_ACTIVE = "b3"; // ~70% สำหรับโซนที่กำลังเลือก
// โซนที่ขายหมดแล้ววาดเป็นสีเทา ไม่ใช่สีเรท — กันคนเสียเวลากดเข้าไปแล้วพบว่าไม่เหลือที่
const SOLD_OUT_COLOR = "#52525b";

function zoneAvailable(zone: SvgZone): number {
  return zone.availability.available;
}

function zoneTotal(zone: SvgZone): number {
  return zone.availability.total;
}

/** แถบเวทีในแผงเลือกที่นั่ง แกนข้างใช้ข้อความแนวตั้งเพื่อไม่กินพื้นที่กริด */
function StageMarker({ side }: { side: StageSide }) {
  const vertical = side === "left" || side === "right";
  const description = "แถว A ใกล้เวทีที่สุด";

  return (
    <div
      className={
        vertical
          ? "flex w-12 shrink-0 flex-col items-center justify-center rounded-lg border border-spot-400/30 bg-spot-400/10 px-2 py-3 text-spot-300"
          : `${side === "top" ? "mb-2" : "mt-2"} flex min-h-10 items-center justify-center gap-2 rounded-lg border border-spot-400/30 bg-spot-400/10 px-3 py-2 text-center text-spot-300`
      }
      role="note"
      aria-label={`เวที ${description}`}
      title={description}
    >
      <span
        className={
          vertical
            ? "font-display text-sm font-semibold [writing-mode:vertical-rl]"
            : "font-display text-sm font-semibold"
        }
        aria-hidden
      >
        เวที
      </span>
      {vertical ? (
        <span className="sr-only">{description}</span>
      ) : (
        <span className="text-xs text-fg-faint">{description}</span>
      )}
    </div>
  );
}

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
  const [standingSelection, setStandingSelection] =
    useState<StandingSelection | null>(null);
  const [bestAvailableSelection, setBestAvailableSelection] =
    useState<BestAvailableSelection | null>(null);
  const [seatedMode, setSeatedMode] = useState<SeatedMode>("best");
  const [seatsByZone, setSeatsByZone] = useState<Map<string, SvgSeat[]>>(
    new Map(),
  );
  const [loadingZoneId, setLoadingZoneId] = useState<string | null>(null);
  const [seatLoadError, setSeatLoadError] = useState<{
    zoneId: string;
    message: string;
  } | null>(null);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
        available: zoneAvailable(zone),
        distance: zone.polygon
          ? distanceFromStage(zone.polygon, stagePolygon)
          : Infinity,
      }))
      .sort((a, b) =>
        stagePolygon
          ? a.distance - b.distance || b.zone.price - a.zone.price
          : b.zone.price - a.zone.price ||
            a.zone.name.localeCompare(b.zone.name),
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
      {
        key: string;
        label: string;
        price: number;
        color: string;
        zoneCount: number;
        seats: number;
      }
    >();
    for (const zone of zones) {
      const key = zone.tier ?? `${zone.color}|${zone.price}`;
      const tier = map.get(key);
      if (tier) {
        tier.zoneCount += 1;
        tier.seats += zoneTotal(zone);
      } else {
        map.set(key, {
          key,
          label: zone.tier ?? formatTHB(zone.price),
          price: zone.price,
          color: zone.color,
          zoneCount: 1,
          seats: zoneTotal(zone),
        });
      }
    }
    return [...map.values()].sort(
      (a, b) => b.price - a.price || a.label.localeCompare(b.label),
    );
  }, [zones]);

  const activeZone = useMemo(
    () => zones.find((zone) => zone.id === activeZoneId) ?? null,
    [zones, activeZoneId],
  );

  /** ที่นั่งของโซนที่เปิดอยู่ จัดกลุ่มตามแถว (A, B, C…) ตามลำดับที่เจนมา */
  const activeRows = useMemo(() => {
    if (!activeZone || activeZone.isStanding) return [];
    const activeSeats = seatsByZone.get(activeZone.id);
    if (!activeSeats) return [];
    const rows = new Map<string, SvgSeat[]>();
    for (const seat of activeSeats) {
      const bucket = rows.get(seat.rowLabel);
      if (bucket) bucket.push(seat);
      else rows.set(seat.rowLabel, [seat]);
    }
    return [...rows.entries()].map(([label, seats]) => ({
      label,
      seats: [...seats].sort((a, b) => a.seatNumber - b.seatNumber),
    }));
  }, [activeZone, seatsByZone]);
  const effectiveStageSide = useMemo(
    () =>
      activeZone?.stageSide ??
      (activeZone?.polygon
        ? stageSideAuto(activeZone.polygon, stagePolygon)
        : null),
    [activeZone, stagePolygon],
  );
  const gridHints = seatGridRenderHints(effectiveStageSide);
  const displayedRows = gridHints.reverseRows
    ? [...activeRows].reverse()
    : activeRows;
  const activeStandingLimit = activeZone?.isStanding
    ? Math.min(maxSeats, availableByZone.get(activeZone.id) ?? 0)
    : 0;
  const activeSeatedLimit =
    activeZone && !activeZone.isStanding
      ? Math.min(maxSeats, availableByZone.get(activeZone.id) ?? 0)
      : 0;

  function openZone(zone: SvgZone) {
    setActiveZoneId(zone.id);
    setError(null);

    if (zone.isStanding) {
      if (selected.size > 0 || bestAvailableSelection) {
        setSelected(new Map());
        setBestAvailableSelection(null);
        setNotice("เลือกโซนยืนแล้ว จึงล้างตัวเลือกของโซนนั่งที่ค้างไว้");
      } else {
        setNotice(null);
      }
      setStandingSelection({
        zoneId: zone.id,
        zoneName: zone.name,
        price: zone.price,
        quantity: 1,
      });
      return;
    }

    // โซนนั่งเปิดด้วย best-available ทุกครั้ง และไม่ผสมกับโซนยืน/ที่นั่งรายตัวใน order เดียว
    if (standingSelection || selected.size > 0 || bestAvailableSelection) {
      setNotice("เปิดโซนนั่งแบบระบบเลือกแล้ว จึงล้างตัวเลือกเดิมที่ค้างไว้");
    } else {
      setNotice(null);
    }
    setStandingSelection(null);
    setSelected(new Map());
    setSeatedMode("best");
    setSeatLoadError(null);
    setBestAvailableSelection({
      zoneId: zone.id,
      zoneName: zone.name,
      price: zone.price,
      quantity: 1,
    });
  }

  function chooseBestAvailableMode(zone: SvgZone) {
    if (zone.isStanding) return;
    const clearedManualSeats = selected.size > 0;
    setSeatedMode("best");
    setSelected(new Map());
    setStandingSelection(null);
    setError(null);
    setBestAvailableSelection({
      zoneId: zone.id,
      zoneName: zone.name,
      price: zone.price,
      quantity: 1,
    });
    setNotice(
      clearedManualSeats
        ? "เปลี่ยนเป็นระบบเลือกให้แล้ว จึงล้างที่นั่งรายตัวที่เลือกไว้"
        : null,
    );
  }

  async function chooseManualMode(zone: SvgZone, force = false) {
    if (zone.isStanding) return;
    const clearedBestAvailable = bestAvailableSelection !== null;
    setSeatedMode("manual");
    setBestAvailableSelection(null);
    setStandingSelection(null);
    setError(null);
    setNotice(
      clearedBestAvailable
        ? "เปลี่ยนเป็นเลือกที่นั่งเองแล้ว จึงล้างจำนวนที่ระบบเลือกไว้"
        : null,
    );

    if (!force && seatsByZone.has(zone.id) && seatLoadError?.zoneId !== zone.id)
      return;

    setLoadingZoneId(zone.id);
    setSeatLoadError(null);
    try {
      const response = await fetch(
        `/api/concerts/${concertId}/zones/${zone.id}/seats?qt=${encodeURIComponent(queueToken)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        seats?: SvgSeat[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(payload.seats)) {
        throw new Error(payload.error ?? "โหลดที่นั่งไม่สำเร็จ");
      }
      setSeatsByZone((current) => {
        const next = new Map(current);
        next.set(zone.id, payload.seats!);
        return next;
      });
    } catch (cause) {
      setSeatLoadError({
        zoneId: zone.id,
        message:
          cause instanceof Error ? cause.message : "โหลดที่นั่งไม่สำเร็จ",
      });
    } finally {
      setLoadingZoneId(null);
    }
  }

  function toggleSeat(seat: SvgSeat, zonePrice: number, zoneName: string) {
    if (seat.status !== "AVAILABLE") return; // กดได้เฉพาะที่ว่าง

    if (standingSelection || bestAvailableSelection) {
      setStandingSelection(null);
      setBestAvailableSelection(null);
      setNotice("เลือกที่นั่งแบบระบุเลขแล้ว จึงล้างตัวเลือกแบบจำนวนที่ค้างไว้");
    }

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
          label: formatSeatLabel({
            zoneName,
            isStanding: false,
            rowLabel: seat.rowLabel,
            seatNumber: seat.seatNumber,
          }),
        });
      }
      return next;
    });
  }

  const seatedTotal = useMemo(
    () =>
      Array.from(selected.values()).reduce((sum, item) => sum + item.price, 0),
    [selected],
  );
  const total = standingSelection
    ? standingSelection.price * standingSelection.quantity
    : bestAvailableSelection
      ? bestAvailableSelection.price * bestAvailableSelection.quantity
      : seatedTotal;
  const selectedCount =
    standingSelection?.quantity ??
    bestAvailableSelection?.quantity ??
    selected.size;
  const hasSelection =
    standingSelection !== null ||
    bestAvailableSelection !== null ||
    selected.size > 0;

  // hold ที่นั่ง + สร้าง order → ไป checkout (ทางเดินเดียวกับผังแบบเดิมทุกประการ)
  async function handleSubmit() {
    if (!hasSelection) return;
    setSubmitting(true);
    setError(null);
    const result = standingSelection
      ? await holdStandingZone({
          concertId,
          zoneId: standingSelection.zoneId,
          quantity: standingSelection.quantity,
          queueToken,
        })
      : bestAvailableSelection
        ? await holdBestAvailable({
            concertId,
            zoneId: bestAvailableSelection.zoneId,
            quantity: bestAvailableSelection.quantity,
            queueToken,
          })
        : await holdAndCreateOrder({
            concertId,
            seatIds: Array.from(selected.keys()),
            queueToken,
          });
    if (result.ok) {
      router.push(`/checkout/${result.orderId}`);
    } else {
      setError(result.error);
      setSubmitting(false);
      if (
        !standingSelection &&
        !bestAvailableSelection &&
        activeZone &&
        !activeZone.isStanding
      ) {
        // hold รายที่นั่งล้มเหลวแปลว่า cache อาจเก่า ล้างให้ปุ่มเลือกเอง/ลองใหม่ fetch สถานะสดได้
        setSelected(new Map());
        setSeatsByZone((current) => {
          const next = new Map(current);
          next.delete(activeZone.id);
          return next;
        });
        setSeatLoadError({
          zoneId: activeZone.id,
          message: "ข้อมูลที่นั่งเปลี่ยนไป กรุณาลองโหลดใหม่",
        });
      }
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
            <span className="w-10 text-center font-display text-xs text-fg-faint">
              {zoom}×
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="ขยายผัง"
              disabled={zoomIndex === ZOOM_STEPS.length - 1}
              onClick={() =>
                setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))
              }
            >
              <ZoomIn className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        {/* ซูมแล้วเลื่อนดูได้ — ไม่ให้ผังล้นออกนอกหน้าจอ */}
        <div className="overflow-auto rounded-xl border border-fg/10 bg-ink-950">
          <div className="relative" style={{ width: `${zoom * 100}%` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={layout.base64}
              alt="ผังสถานที่จัดงาน"
              className="block w-full"
            />
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
                    points={stagePolygon
                      .map(([x, y]) => `${x * viewW},${y * viewH}`)
                      .join(" ")}
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
                    onClick={() => {
                      if (!soldOut) openZone(zone);
                    }}
                    className={
                      soldOut ? "cursor-not-allowed" : "cursor-pointer"
                    }
                  >
                    <title>
                      {`${zone.name} · ${formatTHB(zone.price)} · ${soldOut ? "เต็มแล้ว" : `ว่าง ${available} ${zone.isStanding ? "ใบ" : "ที่"}`}`}
                    </title>
                    <polygon
                      points={zone.polygon
                        .map(([x, y]) => `${x * viewW},${y * viewH}`)
                        .join(" ")}
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
                      style={{
                        paintOrder: "stroke",
                        stroke: "#00000099",
                        strokeWidth: labelSize / 6,
                      }}
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
                style={{
                  backgroundColor: tier.color,
                  boxShadow: `0 0 8px ${tier.color}90`,
                }}
                aria-hidden
              />
              <span className="w-24 shrink-0 font-display text-fg-dim">
                {tier.label}
              </span>
              <span className="text-led w-20 shrink-0 text-spot-400">
                {formatTHB(tier.price)}
              </span>
              <span className="min-w-0">
                {tier.zoneCount} โซน · {tier.seats.toLocaleString()} ที่นั่ง
              </span>
            </div>
          ))}
        </div>

        {/* ---------- รายการโซน (เรียงตามระยะจากเวที) ---------- */}
        <div>
          <h3 className="mb-2 font-display text-sm font-semibold text-fg">
            {stagePolygon
              ? "โซนทั้งหมด — เรียงจากใกล้เวทีที่สุด"
              : "โซนทั้งหมด"}
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
                  onClick={() => openZone(zone)}
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
                    style={{
                      backgroundColor: soldOut ? SOLD_OUT_COLOR : zone.color,
                    }}
                    aria-hidden
                  />
                  <span className="font-display font-semibold">
                    {zone.name}
                  </span>
                  <span className="text-led text-spot-400">
                    {formatTHB(zone.price)}
                  </span>
                  <span className="text-fg-faint">
                    {soldOut ? "เต็ม" : `ว่าง ${available}`}
                  </span>
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
                style={{
                  backgroundColor: activeZone.color,
                  boxShadow: `0 0 10px ${activeZone.color}90`,
                }}
                aria-hidden
              />
              <h3 className="font-display font-semibold text-fg">
                โซน {activeZone.name}
              </h3>
              {activeZone.tier && (
                <span className="text-xs text-fg-faint">
                  ({activeZone.tier})
                </span>
              )}
              <span className="text-led text-sm text-spot-400">
                {formatTHB(activeZone.price)}
              </span>
              <span className="text-xs text-fg-faint">
                ว่าง {availableByZone.get(activeZone.id) ?? 0} /{" "}
                {zoneTotal(activeZone)} {activeZone.isStanding ? "ใบ" : "ที่"}
              </span>
              <button
                type="button"
                onClick={() => setActiveZoneId(null)}
                className="ml-auto rounded-md px-2 py-1 text-xs text-fg-faint transition-colors hover:bg-fg/10 hover:text-fg"
              >
                ปิดโซนนี้
              </button>
            </div>

            {!activeZone.isStanding && (
              <div
                className="mb-4 grid gap-2 sm:grid-cols-2"
                role="group"
                aria-label="โหมดเลือกที่นั่ง"
              >
                <button
                  type="button"
                  aria-pressed={seatedMode === "best"}
                  onClick={() => chooseBestAvailableMode(activeZone)}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                    seatedMode === "best"
                      ? "border-brand-500 bg-brand-500/15 text-brand-200"
                      : "border-fg/15 bg-ink-950 text-fg-dim hover:border-brand-400 hover:text-fg"
                  }`}
                >
                  ⚡ ให้ระบบเลือกที่ดีที่สุดให้
                </button>
                <button
                  type="button"
                  aria-pressed={seatedMode === "manual"}
                  onClick={() =>
                    chooseManualMode(
                      activeZone,
                      seatLoadError?.zoneId === activeZone.id,
                    )
                  }
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                    seatedMode === "manual"
                      ? "border-brand-500 bg-brand-500/15 text-brand-200"
                      : "border-fg/15 bg-ink-950 text-fg-dim hover:border-brand-400 hover:text-fg"
                  }`}
                >
                  🪑 เลือกที่นั่งเอง
                </button>
              </div>
            )}

            {activeZone.isStanding ? (
              <div className="rounded-xl border border-brand-500/20 bg-brand-500/10 p-4">
                <p className="text-sm text-fg-dim">เลือกจำนวนบัตรโซนยืน</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center rounded-lg border border-fg/15 bg-ink-950">
                    <button
                      type="button"
                      aria-label="ลดจำนวนบัตรโซนยืน"
                      disabled={(standingSelection?.quantity ?? 1) <= 1}
                      onClick={() =>
                        setStandingSelection((current) =>
                          current
                            ? {
                                ...current,
                                quantity: Math.max(1, current.quantity - 1),
                              }
                            : current,
                        )
                      }
                      className="grid size-10 place-items-center rounded-l-lg text-lg text-fg transition-colors hover:bg-fg/10 disabled:cursor-not-allowed disabled:text-fg/20"
                    >
                      −
                    </button>
                    <span className="text-led min-w-12 px-3 text-center text-lg font-bold text-fg">
                      {standingSelection?.quantity ?? 1}
                    </span>
                    <button
                      type="button"
                      aria-label="เพิ่มจำนวนบัตรโซนยืน"
                      disabled={
                        (standingSelection?.quantity ?? 1) >=
                        activeStandingLimit
                      }
                      onClick={() =>
                        setStandingSelection((current) =>
                          current
                            ? {
                                ...current,
                                quantity: Math.min(
                                  activeStandingLimit,
                                  current.quantity + 1,
                                ),
                              }
                            : current,
                        )
                      }
                      className="grid size-10 place-items-center rounded-r-lg text-lg text-fg transition-colors hover:bg-fg/10 disabled:cursor-not-allowed disabled:text-fg/20"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-sm text-fg-faint">
                    ว่าง {activeZone.availability.available.toLocaleString()} ใบ
                  </span>
                  <span className="text-led ml-auto text-sm font-semibold text-spot-300">
                    {formatTHB(activeZone.price)} ×{" "}
                    {standingSelection?.quantity ?? 1} ={" "}
                    {formatTHB(
                      activeZone.price * (standingSelection?.quantity ?? 1),
                    )}
                  </span>
                </div>
              </div>
            ) : seatedMode === "best" ? (
              <div className="rounded-xl border border-brand-500/20 bg-brand-500/10 p-4">
                <p className="text-sm text-fg-dim">
                  เลือกจำนวนที่นั่งให้ระบบจัดที่ดีที่สุดให้
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center rounded-lg border border-fg/15 bg-ink-950">
                    <button
                      type="button"
                      aria-label="ลดจำนวนที่นั่งที่ระบบเลือกให้"
                      disabled={(bestAvailableSelection?.quantity ?? 1) <= 1}
                      onClick={() =>
                        setBestAvailableSelection((current) =>
                          current
                            ? {
                                ...current,
                                quantity: Math.max(1, current.quantity - 1),
                              }
                            : current,
                        )
                      }
                      className="grid size-10 place-items-center rounded-l-lg text-lg text-fg transition-colors hover:bg-fg/10 disabled:cursor-not-allowed disabled:text-fg/20"
                    >
                      −
                    </button>
                    <span className="text-led min-w-12 px-3 text-center text-lg font-bold text-fg">
                      {bestAvailableSelection?.quantity ?? 1}
                    </span>
                    <button
                      type="button"
                      aria-label="เพิ่มจำนวนที่นั่งที่ระบบเลือกให้"
                      disabled={
                        (bestAvailableSelection?.quantity ?? 1) >=
                        activeSeatedLimit
                      }
                      onClick={() =>
                        setBestAvailableSelection((current) =>
                          current
                            ? {
                                ...current,
                                quantity: Math.min(
                                  activeSeatedLimit,
                                  current.quantity + 1,
                                ),
                              }
                            : current,
                        )
                      }
                      className="grid size-10 place-items-center rounded-r-lg text-lg text-fg transition-colors hover:bg-fg/10 disabled:cursor-not-allowed disabled:text-fg/20"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-sm text-fg-faint">
                    ว่าง {activeZone.availability.available.toLocaleString()}{" "}
                    ที่
                  </span>
                  <span className="text-led ml-auto text-sm font-semibold text-spot-300">
                    {formatTHB(activeZone.price)} ×{" "}
                    {bestAvailableSelection?.quantity ?? 1} ={" "}
                    {formatTHB(
                      activeZone.price *
                        (bestAvailableSelection?.quantity ?? 1),
                    )}
                  </span>
                </div>
              </div>
            ) : loadingZoneId === activeZone.id ? (
              <div className="rounded-xl border border-fg/10 bg-ink-950 p-6 text-center text-sm text-fg-faint">
                กำลังโหลดที่นั่งของโซนนี้…
              </div>
            ) : seatLoadError?.zoneId === activeZone.id ? (
              <div className="rounded-xl border border-danger/25 bg-danger/10 p-4 text-sm text-danger">
                <p>{seatLoadError.message}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => chooseManualMode(activeZone, true)}
                >
                  ลองใหม่
                </Button>
              </div>
            ) : seatsByZone.has(activeZone.id) ? (
              <div className="flex items-stretch gap-2">
                {gridHints.stageSide === "left" && <StageMarker side="left" />}
                <div className="min-w-0 flex-1">
                  {gridHints.stageSide === "top" && <StageMarker side="top" />}
                  {/* กล่องเดียวเลื่อนได้ทั้งสองแกน แต่แต่ละแถวข้อมูลต้องอยู่บรรทัดเดียวเสมอ */}
                  <div className="max-h-96 overflow-auto overflow-x-auto rounded-lg bg-ink-900 pr-1">
                    <div className="w-max min-w-full space-y-1.5 py-1">
                      {displayedRows.map((row) => (
                        <div
                          key={row.label}
                          className="flex flex-nowrap items-start"
                        >
                          <span className="sticky left-0 z-10 w-8 shrink-0 bg-ink-900 py-1.5 pl-1 font-display text-xs text-fg-faint">
                            {row.label}
                          </span>
                          <div className="flex shrink-0 flex-nowrap gap-1.5">
                            {/* aria-label ใช้รูปยาว "แถว A เลข 1" (ไม่ผ่าน formatSeatLabel) — โปรแกรมอ่านหน้าจออ่านเข้าใจกว่ารูปย่อ "A1" */}
                            {row.seats.map((seat) => (
                              <button
                                key={seat.id}
                                type="button"
                                onClick={() =>
                                  toggleSeat(
                                    seat,
                                    activeZone.price,
                                    activeZone.name,
                                  )
                                }
                                disabled={seat.status !== "AVAILABLE"}
                                title={formatSeatLabel({
                                  zoneName: activeZone.name,
                                  isStanding: false,
                                  rowLabel: seat.rowLabel,
                                  seatNumber: seat.seatNumber,
                                })}
                                aria-label={`ที่นั่ง ${activeZone.name} แถว ${seat.rowLabel} เลข ${seat.seatNumber}`}
                                aria-pressed={selected.has(seat.id)}
                                data-seat-number={seat.seatNumber}
                                className={seatClass(
                                  seat.status,
                                  selected.has(seat.id),
                                )}
                              >
                                {seat.seatNumber}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {gridHints.stageSide === "bottom" && (
                    <StageMarker side="bottom" />
                  )}
                </div>
                {gridHints.stageSide === "right" && (
                  <StageMarker side="right" />
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-fg/10 bg-ink-950 p-6 text-center text-sm text-fg-faint">
                กด “เลือกที่นั่งเอง” เพื่อโหลดกริดของโซนนี้
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-fg/15 p-4 text-center text-sm text-fg-faint">
            ยังไม่ได้เลือกโซน — แตะโซนบนผัง หรือเลือกจากรายการโซนด้านบน
          </p>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-fg/10 pt-3 text-xs text-fg-faint">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-4 rounded-md border border-fg/20 bg-ink-800" />{" "}
            ว่าง
          </span>
          <span className="flex items-center gap-1.5">
            <span className="shadow-glow-brand inline-block size-4 rounded-md bg-brand-600" />{" "}
            เลือกอยู่
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-4 rounded-md bg-ink-900" />{" "}
            ขายแล้ว / มีคนกำลังจอง
          </span>
        </div>
      </div>

      {/* ---------- ฝั่งขวา: สรุป (พฤติกรรมเดียวกับผังแบบเดิม) ---------- */}
      <div className="h-fit rounded-xl border border-fg/10 bg-ink-850 p-4 shadow-md lg:sticky lg:top-24">
        <h3 className="mb-3 font-display font-semibold text-fg">
          รายการที่เลือก
        </h3>

        {!hasSelection ? (
          <p className="text-sm text-fg-faint">
            ยังไม่ได้เลือกบัตร — เลือกโซนเพื่อเริ่ม
          </p>
        ) : standingSelection ? (
          <span className="text-led inline-flex items-center gap-1 rounded-md border border-brand-500/30 bg-brand-500/15 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-brand-300">
            โซนยืน × {standingSelection.quantity} ใบ
            <button
              type="button"
              aria-label="เอาบัตรโซนยืนออก"
              onClick={() => {
                setStandingSelection(null);
                setActiveZoneId(null);
              }}
              className="rounded p-0.5 transition-colors hover:bg-brand-500/25 hover:text-fg"
            >
              <X className="size-3" />
            </button>
          </span>
        ) : bestAvailableSelection ? (
          <span className="text-led inline-flex items-center gap-1 rounded-md border border-brand-500/30 bg-brand-500/15 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-brand-300">
            {bestAvailableSelection.zoneName} ×{" "}
            {bestAvailableSelection.quantity} ที่ (ระบบเลือกให้)
            <button
              type="button"
              aria-label="เอาที่นั่งที่ระบบเลือกให้ออก"
              onClick={() => {
                setBestAvailableSelection(null);
                setActiveZoneId(null);
              }}
              className="rounded p-0.5 transition-colors hover:bg-brand-500/25 hover:text-fg"
            >
              <X className="size-3" />
            </button>
          </span>
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
            รวม
            {selectedCount > 0
              ? ` ${selectedCount} ${standingSelection ? "ใบ" : "ที่นั่ง"}`
              : ""}
          </span>
          <span className="text-led text-xl font-bold text-spot-300">
            {formatTHB(total)}
          </span>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-danger/25 bg-danger/10 p-2.5 text-sm text-danger">
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-3 rounded-md border border-brand-400/25 bg-brand-500/10 p-2.5 text-sm text-brand-200">
            {notice}
          </div>
        )}

        <Button
          className="mt-4 w-full"
          disabled={!hasSelection || submitting}
          loading={submitting}
          onClick={handleSubmit}
        >
          {submitting ? "กำลังจองบัตร…" : "ดำเนินการชำระเงิน →"}
        </Button>
        <p className="mt-2.5 text-center text-xs text-fg-faint">
          บัตรจะถูกล็อกให้คุณ 5 นาทีเพื่อชำระเงิน
        </p>
      </div>
    </div>
  );
}

// className ของปุ่มที่นั่ง — ชุดเดียวกับผังแบบเดิม (components/seat-map.tsx) ให้หน้าตาเหมือนกันทั้งระบบ
function seatClass(status: string, isSelected: boolean): string {
  const base =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-display text-xs transition-all duration-150";
  if (status === "SOLD" || status === "HELD")
    return `${base} cursor-not-allowed border-transparent bg-ink-900 text-fg/20`;
  if (status === "BLOCKED")
    return `${base} cursor-not-allowed border-transparent bg-ink-900/50 text-fg/10`;
  if (isSelected)
    return `${base} animate-glow-pulse border-brand-500 bg-brand-600 font-semibold text-white`;
  return `${base} border-fg/15 bg-ink-800 text-fg-dim hover:-translate-y-0.5 hover:border-brand-400 hover:text-fg hover:shadow-glow-brand`;
}
