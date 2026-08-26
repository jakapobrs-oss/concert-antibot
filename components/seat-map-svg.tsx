"use client";

// ============================================================
// Seat Map (SVG) — ผังระดับ "โซน" วางทับรูปสถานที่จริง (drill-down 2 ชั้น)
// ============================================================
// ⚠️ ตั้งใจ "ไม่แก้" components/seat-map.tsx ตัวเดิม แต่สร้างไฟล์ใหม่แยก
//    เพราะตัวเดิมคือทางเดินเงินที่ผ่านเทสมาแล้ว คอนเสิร์ตเก่าที่ยังไม่มีกรอบโซน
//    จะใช้ตัวเดิมต่อไปเหมือนเดิมเป๊ะ -> ไม่มีทางพังจากงานนี้
//
// 📌 โครงหน้าเป็น 2 ชั้น (ผลจากการ user-test ผังจริง 69 โซน: รายการโซนแบบปุ่ม 69 อัน
//    + ตารางราคา ทำให้หน้ารกจนอ่านไม่ออก):
//    ชั้น 1 "ผังรวม"  — รูปผังอย่างเดียว กดเลือกโซนบนรูปโดยตรง + legend ราคาแบบย่อ 1 แถว
//    ชั้น 2 "ผังโซน"  — กดโซนแล้วสลับทั้งมุมมองเป็นหน้าที่นั่งของโซนนั้น (มีปุ่มกลับ)
//    โหลดกริดที่นั่งทันทีที่เข้าโซน และ "เลือกที่นั่งเอง" เป็นค่าเริ่มต้น
//
// ♿ ทางเลือกที่ไม่ใช้เมาส์: กรอบโซนบนรูปเป็นปุ่มจริง (tabIndex + role=button)
//    กด Tab ไล่ทีละโซน / Enter หรือ Space เพื่อเปิด — แทนรายการปุ่มโซนแบบเดิมที่ถูกถอดออก
//    ส่วนที่นั่งในชั้น 2 เป็น <button> จริงใน HTML อยู่แล้ว
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, X, ZoomIn, ZoomOut } from "lucide-react";

import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  holdAndCreateOrder,
  holdBestAvailable,
  holdStandingZone,
} from "@/app/actions/booking";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { formatSeatLabel } from "@/lib/seatmap/seat-rows";
import {
  distanceFromStage,
  distanceToPolygonEdges,
  polygonPoleOfInaccessibility,
  stageSideAuto,
  type Polygon,
  type StageSide,
} from "@/lib/seatmap/polygon";
import {
  rowInsetFractions,
  seatGridRenderHints,
  zoneLabelFontSize,
} from "@/lib/seatmap/render-hints";

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
// เพดานขนาดตัวอักษรชื่อโซนบนผัง = สัดส่วนของความกว้างรูป (ไม่ fix พิกเซล เพราะรูปคนละขนาดกัน)
// โซนที่เล็กกว่านี้จะได้ฟอนต์ย่อลงตามที่ว่างจริงในกรอบ (zoneLabelFontSize)
const ZONE_LABEL_RATIO = 1 / 46;
// เกณฑ์ต่ำสุดที่ยังอ่านชื่อโซนออกที่ซูม 1× — เล็กกว่านี้ไม่วาดชื่อ ปล่อยให้เห็นรูปผังแทน
// หารด้วยระดับซูม: ซูมเข้าไปดูโซนเล็ก ชื่อจะทยอยโผล่ (นี่คือเหตุผลที่ปุ่มซูมมีอยู่)
const ZONE_LABEL_MIN_RATIO = 1 / 110;
// ความทึบของแผ่นสีทับโซน (เลขฐาน 16 ต่อท้ายรหัสสี) — ต้องเห็นสีชัดแต่ยังเห็นรูปผังข้างใต้
const ZONE_FILL_ALPHA = "59"; // ~35%
const ZONE_FILL_ALPHA_ACTIVE = "b3"; // ~70% สำหรับโซนที่กำลังชี้/โฟกัสอยู่
// โซนที่ขายหมดแล้ววาดเป็นสีเทา ไม่ใช่สีเรท — กันคนเสียเวลากดเข้าไปแล้วพบว่าไม่เหลือที่
const SOLD_OUT_COLOR = "#52525b";
// ขนาดจริงของปุ่มที่นั่งในกริด (w-7 = 28px) กับช่องไฟ (gap-1.5 = 6px)
// ใช้คำนวณความกว้างแถว/ระยะร่นเป็นพิกเซล ให้กริดวางแถวตามรูปทรงโซนจริงได้
const SEAT_BUTTON_PX = 28;
const SEAT_GAP_PX = 6;

/** ความกว้างจริง (px) ของแถวที่นั่ง n ที่ — ปุ่ม + ช่องไฟระหว่างปุ่ม */
function seatRowWidthPx(seatCount: number): number {
  return seatCount > 0
    ? seatCount * SEAT_BUTTON_PX + (seatCount - 1) * SEAT_GAP_PX
    : 0;
}

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
  slug,
  maxSeats,
  remainingQuota,
  concertId,
  queueToken,
  turnstileSiteKey,
}: {
  zones: SvgZone[];
  layout: { base64: string; width: number; height: number };
  stagePolygon: Polygon | null;
  /** slug ของคอนเสิร์ต — ใช้พากลับไปหน้าคิวเมื่อสิทธิ์เลือกที่นั่งหมดเวลา */
  slug: string;
  maxSeats: number;
  /** โควตาที่ user คนนี้ยังจองได้ (maxSeats หักที่จอง/ค้างชำระแล้ว) — ค่า ณ ตอนโหลดหน้า */
  remainingQuota: number;
  concertId: string;
  queueToken: string;
  turnstileSiteKey: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Map<string, Selected>>(new Map());
  const [standingSelection, setStandingSelection] =
    useState<StandingSelection | null>(null);
  const [bestAvailableSelection, setBestAvailableSelection] =
    useState<BestAvailableSelection | null>(null);
  // ค่าเริ่มต้น = เลือกที่นั่งเอง (ผลจาก user-test: คนกดโซนเพราะอยากเห็น/เลือกที่นั่งจริง)
  const [seatedMode, setSeatedMode] = useState<SeatedMode>("manual");
  // ด่าน anti-bot ตอนกดซื้อเด้ง CHALLENGE → โชว์ Turnstile แล้วยิงคำสั่งเดิมซ้ำพร้อม token
  const [needChallenge, setNeedChallenge] = useState(false);
  const [seatsByZone, setSeatsByZone] = useState<Map<string, SvgSeat[]>>(
    new Map(),
  );
  const [loadingZoneId, setLoadingZoneId] = useState<string | null>(null);
  const [seatLoadError, setSeatLoadError] = useState<{
    zoneId: string;
    message: string;
  } | null>(null);
  // สิทธิ์หลังผ่านคิวหมดเวลา (server ตอบ 403) — ทางออกเดียวคือเข้าคิวใหม่
  // แยกจาก seatLoadError เพราะ "ลองใหม่" ไม่มีวันสำเร็จ ต้องไม่หลอกให้ผู้ใช้กดฟรี
  const [admitExpired, setAdmitExpired] = useState(false);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  // โซนที่กำลังชี้เมาส์/โฟกัสคีย์บอร์ดบนผังรวม — ให้กรอบเด่นขึ้นก่อนตัดสินใจกด
  const [highlightZoneId, setHighlightZoneId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // server บอกว่ามี order ค้างชำระ → โชว์ปุ่มพาไปจ่ายต่อ แทนปล่อยให้จมกับ error
  const [pendingOrder, setPendingOrder] = useState<{ orderId: string } | null>(
    null,
  );
  const [zoomIndex, setZoomIndex] = useState(0);

  // ---- ลากผังด้วยคลิกขวาค้าง (แทนการไล่แถบเลื่อน) ----
  // ทำไมปุ่มขวา: ปุ่มซ้ายถูกจองไว้ให้ "กดเลือกโซน" แล้ว ถ้าเอาปุ่มซ้ายมาลากด้วย
  // ต้องเดาใจว่าคนตั้งใจลากหรือตั้งใจกดโซน ซึ่งเดาพลาดแล้วเปิดโซนผิดโดยไม่ได้ตั้งใจ
  // แถบเลื่อนเดิมยังอยู่ครบ — อันนี้เป็นทางลัดเพิ่ม ไม่ใช่ของแทน
  const panBoxRef = useRef<HTMLDivElement | null>(null);
  const panStart = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 2) return; // เฉพาะปุ่มขวา
    const box = panBoxRef.current;
    if (!box) return;
    panStart.current = {
      x: event.clientX,
      y: event.clientY,
      left: box.scrollLeft,
      top: box.scrollTop,
    };
    setIsPanning(true);
    // จับ pointer ไว้กับกรอบผัง เพื่อให้ลากเลยขอบกรอบออกไปแล้วยังลากต่อได้
    // ถ้าจับไม่ได้ (เบราว์เซอร์ปล่อย pointer ไปแล้ว) ก็ยังลากในกรอบได้ตามปกติ ไม่ต้องล้ม
    try {
      box.setPointerCapture(event.pointerId);
    } catch {
      // ไม่ต้องทำอะไร — เสียแค่ความสามารถลากเลยขอบกรอบ
    }
    event.preventDefault();
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const start = panStart.current;
    const box = panBoxRef.current;
    if (!start || !box) return;
    // ลากไปทางไหน ผังต้องตามมือไปทางนั้น -> เลื่อนสวนทางกับระยะที่เมาส์ขยับ
    box.scrollLeft = start.left - (event.clientX - start.x);
    box.scrollTop = start.top - (event.clientY - start.y);
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!panStart.current) return;
    panStart.current = null;
    setIsPanning(false);
    const box = panBoxRef.current;
    if (box?.hasPointerCapture(event.pointerId)) {
      box.releasePointerCapture(event.pointerId);
    }
  }

  // เพดานเลือกจริงของ user คนนี้ = ลิมิตต่อบัญชี หักโควตาที่ใช้ไปแล้ว
  const effectiveMax = Math.min(maxSeats, remainingQuota);

  const viewW = layout.width;
  const viewH = layout.height;
  const zoom = ZOOM_STEPS[zoomIndex];

  /**
   * เรียงโซน "ใกล้เวทีก่อน" — ใช้กำหนดลำดับ Tab ของคีย์บอร์ดบนผังรวม
   * (คนใช้คีย์บอร์ดไล่จากโซนใกล้เวที/แพงสุดก่อน ตรงกับลำดับที่ผังขายบัตรจริงใช้)
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
   * ป้ายชื่อโซนบนผังรวม — จุดวาง + ขนาดฟอนต์ที่ "พอดีกับที่ว่างในกรอบโซนจริง"
   *
   * ทำไมต้องคำนวณ ไม่ใช้ขนาดเดียวทั้งผัง: ผังจริงมี 69 โซน ขนาดต่างกันหลายเท่า
   * ขนาดเดียวเท่ากันหมด = โซนเล็กชื่อล้นไปทับโซนข้าง ๆ จนอ่านผังไม่ออกทั้งใบ
   * โซนที่เล็กจนชื่ออ่านไม่ออก (font = null) จะไม่วาดชื่อ — ยังกดได้ ยังมีชื่อใน tooltip/aria-label
   */
  const zoneLabels = useMemo(() => {
    const maxFont = viewW * ZONE_LABEL_RATIO;
    const minFont = (viewW * ZONE_LABEL_MIN_RATIO) / zoom;
    return orderedZones.flatMap(({ zone, available }) => {
      if (!zone.polygon || zone.polygon.length < 3) return [];
      // วัดในหน่วยของ viewBox (คูณขนาดรูปก่อน) เพราะรูปไม่ได้จัตุรัส —
      // ถ้าวัดในสัดส่วน 0-1 ตรง ๆ ระยะแนวตั้งกับแนวนอนจะคนละมาตราส่วน
      const scaled = zone.polygon.map(
        ([x, y]) => [x * viewW, y * viewH] as [number, number],
      );
      const point = polygonPoleOfInaccessibility(scaled);
      const font = zoneLabelFontSize({
        inradius: distanceToPolygonEdges(scaled, point),
        nameLength: zone.name.length,
        maxFont,
        minFont,
      });
      return [
        {
          id: zone.id,
          name: zone.name,
          x: point[0],
          y: point[1],
          font,
          soldOut: available === 0,
          // ป้ายของโซนที่กำลังชี้อยู่ต้องอ่านออกเสมอ แม้โซนจะเล็กกว่าเกณฑ์
          highlightFont: Math.max(font ?? 0, minFont),
        },
      ];
    });
  }, [orderedZones, viewW, viewH, zoom]);

  /**
   * คำอธิบายสี (legend) — ยุบโซนที่อยู่เรทเดียวกันเหลือจุดสี + ราคา
   *
   * ที่มา: ผังสนามจริง (อิมแพ็ค อารีน่า) มี 69 โซน แต่มีแค่ 7 เรทราคา
   * แสดงเป็นแถวเดียวพอ — รูปผังจริงส่วนใหญ่มีแถบราคาฝังในรูปอยู่แล้ว
   * แถวนี้มีไว้เผื่อรูปที่ไม่มี legend ในตัว และเป็นตัวยืนยันว่าสีไหนราคาเท่าไร
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
    // เรียงแถวตามลำดับกายภาพ A..Z แล้วค่อย AA.. (กติกาเดียวกับ compareSeatOrder)
    // ⚠️ ห้ามเรียงแบบ string ล้วน — AA จะแทรกระหว่าง A กับ B ทำผังบนจอไม่ตรงกับผังจริง
    return [...rows.entries()]
      .sort(
        ([a], [b]) => a.length - b.length || a.localeCompare(b),
      )
      .map(([label, seats]) => ({
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
  // ไม่รู้ทิศเวที (แอดมินไม่ได้วาดกรอบเวที/ไม่ได้ตั้ง stageSide) → ใช้ convention ของระบบ:
  // แถวเรียง A ก่อนเสมอ และแถว A คือแถวหน้าสุด → วางแถบเวทีไว้บนหัวกริดได้อย่างถูกต้อง
  // (ดีกว่าไม่แสดงอะไรเลย ซึ่งทำให้ผู้ซื้อไม่รู้ว่าฝั่งไหนใกล้เวที — บั๊กจริงจาก user-test)
  const markerSide = gridHints.stageSide ?? "top";
  const displayedRows = gridHints.reverseRows
    ? [...activeRows].reverse()
    : activeRows;
  // ระยะร่นซ้ายของแต่ละแถว (สัดส่วน 0–1 ของความกว้างโซน) อ่านจากหน้าตัดกรอบโซนจริงทีละแถว
  // (บั๊กจาก user-test: V3 เป็นรูปตัว L ช่วงกลางคอดชิดขวา — จัดชิดข้างเดียวทั้งโซนยังไงก็ไม่ตรงรูป)
  const maxSeatsPerRow = activeRows.reduce(
    (max, row) => Math.max(max, row.seats.length),
    0,
  );
  // ความกว้างฐาน = แถวที่กว้างสุด; ระยะร่นรายแถว (px) คิดเทียบฐานนี้
  const baseStripWidth =
    maxSeatsPerRow > 0 ? seatRowWidthPx(maxSeatsPerRow) : 0;
  const rowInsetPx = rowInsetFractions(
    activeZone?.polygon ?? null,
    gridHints.stageSide,
    activeRows.map((row) => row.seats.length),
  ).map((fraction) => Math.round(fraction * baseStripWidth));
  // กริดกว้างเท่าที่แถวที่ยื่นไปไกลสุดต้องการ — โซนวางเอียงจะได้เป็นสี่เหลี่ยมด้านขนานเต็มตัว
  // (เลื่อนดูแนวนอนได้ในกล่อง) แทนการถูกตัดให้ทุกแถวไปกองชิดขวา
  const seatStripWidth =
    activeRows.length > 0
      ? Math.max(
          ...activeRows.map(
            (row, index) =>
              (rowInsetPx[index] ?? 0) + seatRowWidthPx(row.seats.length),
          ),
        )
      : undefined;
  // displayedRows อาจถูกกลับลำดับ (เวทีอยู่ล่าง) — ระยะร่นต้องกลับตามแถวของมันด้วย
  const displayedInsetPx = gridHints.reverseRows
    ? [...rowInsetPx].reverse()
    : rowInsetPx;
  const activeStandingLimit = activeZone?.isStanding
    ? Math.min(effectiveMax, availableByZone.get(activeZone.id) ?? 0)
    : 0;
  const activeSeatedLimit =
    activeZone && !activeZone.isStanding
      ? Math.min(effectiveMax, availableByZone.get(activeZone.id) ?? 0)
      : 0;

  /** โหลดที่นั่งรายโซนจาก server — 403 = สิทธิ์คิวหมด (ทางออกเดียวคือเข้าคิวใหม่ ไม่ใช่ retry) */
  async function loadZoneSeats(zone: SvgZone, force = false) {
    if (admitExpired) return; // สิทธิ์หมดไปแล้ว ยิงซ้ำก็ 403 เหมือนเดิม
    if (!force && seatsByZone.has(zone.id) && seatLoadError?.zoneId !== zone.id)
      return;

    setLoadingZoneId(zone.id);
    setSeatLoadError(null);
    try {
      const response = await fetch(
        `/api/concerts/${concertId}/zones/${zone.id}/seats?qt=${encodeURIComponent(queueToken)}`,
        { cache: "no-store" },
      );
      if (response.status === 403) {
        // สิทธิ์หลังผ่านคิวหมดเวลา — ต้องบอกตรง ๆ พร้อมทางไปต่อ ไม่ใช่ปุ่มลองใหม่ที่ไม่มีวันผ่าน
        setAdmitExpired(true);
        return;
      }
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

  /** เปิดโซน (ชั้น 2) — โซนนั่งเริ่มที่ "เลือกที่นั่งเอง" และโหลดกริดทันที ไม่ต้องกดเพิ่ม */
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

    // เปิดโซนนั่งโซนใหม่ = เริ่มเลือกใหม่ (ไม่ผสมโซนยืน/โซนอื่นใน order เดียว)
    const hadSomething =
      standingSelection !== null ||
      bestAvailableSelection !== null ||
      selected.size > 0;
    const keepSameZoneSeats =
      selected.size > 0 &&
      seatsByZone.get(zone.id)?.some((seat) => selected.has(seat.id));
    if (hadSomething && !keepSameZoneSeats) {
      setNotice("เปิดโซนใหม่แล้ว จึงล้างตัวเลือกเดิมที่ค้างไว้");
      setSelected(new Map());
    } else {
      setNotice(null);
    }
    setStandingSelection(null);
    setBestAvailableSelection(null);
    setSeatedMode("manual");
    void loadZoneSeats(zone);
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

  function chooseManualMode(zone: SvgZone, force = false) {
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
    void loadZoneSeats(zone, force);
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
        if (next.size >= effectiveMax) {
          setError(
            remainingQuota < maxSeats
              ? `เลือกได้อีกสูงสุด ${effectiveMax} ที่นั่ง — จองไปแล้ว ${maxSeats - remainingQuota} จากโควตา ${maxSeats} ที่นั่ง/บัญชี`
              : `เลือกได้สูงสุด ${maxSeats} ที่นั่งต่อบัญชี`,
          );
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
  // เกินโควตา = ปุ่มจ่ายต้องจางพร้อมเหตุผล ไม่ใช่ปล่อยกดแล้วเด้ง error จาก server
  const overQuota = remainingQuota === 0 || selectedCount > remainingQuota;

  // hold ที่นั่ง + สร้าง order → ไป checkout (ทางเดินเดียวกับผังแบบเดิมทุกประการ)
  async function handleSubmit(turnstileToken?: string) {
    if (!hasSelection) return;
    setSubmitting(true);
    setError(null);
    setPendingOrder(null);
    const result = standingSelection
      ? await holdStandingZone({
          concertId,
          zoneId: standingSelection.zoneId,
          quantity: standingSelection.quantity,
          queueToken,
          turnstileToken,
        })
      : bestAvailableSelection
        ? await holdBestAvailable({
            concertId,
            zoneId: bestAvailableSelection.zoneId,
            quantity: bestAvailableSelection.quantity,
            queueToken,
            turnstileToken,
          })
        : await holdAndCreateOrder({
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
      // ยังไม่ปฏิเสธถาวร — ขอให้ยืนยันว่าไม่ใช่บอทแล้วระบบยิงซ้ำให้เอง
      setNeedChallenge(result.challenge === true);
      // โดนด่านบอทเด้ง = ที่นั่งยังไม่ถูกแตะ ห้ามล้างตัวเลือกทิ้งเหมือน hold ล้มเหลว
      if (result.challenge) return;
      if (
        !standingSelection &&
        !bestAvailableSelection &&
        activeZone &&
        !activeZone.isStanding
      ) {
        // hold รายที่นั่งล้มเหลวแปลว่า cache อาจเก่า ล้างให้ปุ่มลองโหลดใหม่ fetch สถานะสดได้
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
      {/* ---------- ฝั่งซ้าย: ชั้น 1 ผังรวม / ชั้น 2 ผังโซน ---------- */}
      {activeZone === null ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-sm text-fg-faint">
              แตะโซนบนผังเพื่อเลือกที่นั่ง
              {/* บอกทางลัดเฉพาะตอนซูมเข้า — ตอนผังพอดีจอไม่มีอะไรให้เลื่อน จะบอกไปก็สับสน */}
              {zoom > 1 && (
                <span className="hidden sm:inline">
                  {" "}
                  · คลิกขวาค้างแล้วลากเพื่อเลื่อนผัง
                </span>
              )}
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

          {/* ซูมแล้วเลื่อนดูได้ — ไม่ให้ผังล้นออกนอกหน้าจอ (แถบเลื่อน หรือคลิกขวาลาก) */}
          <div
            ref={panBoxRef}
            className={`overflow-auto rounded-xl border border-fg/10 bg-ink-950 ${
              isPanning ? "cursor-grabbing select-none" : ""
            }`}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            // ปิดเมนูคลิกขวาบนผัง ไม่งั้นเมนูเด้งทุกครั้งที่ปล่อยมือหลังลากเสร็จ
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="relative" style={{ width: `${zoom * 100}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={layout.base64}
                alt="ผังสถานที่จัดงาน"
                className="block w-full"
              />
              {/* คำแนะนำคีย์บอร์ดแยกออกจากชื่อผัง — ชื่อสั้นคงที่ให้โปรแกรมอ่านหน้าจอ/เทสอ้างถึงได้ */}
              <p id="seat-map-keyboard-hint" className="sr-only">
                กด Tab เพื่อไล่ดูโซน กด Enter เพื่อเปิดโซน
              </p>
              <svg
                viewBox={`0 0 ${viewW} ${viewH}`}
                className="absolute inset-0 h-full w-full"
                role="group"
                aria-label="ผังโซนที่นั่ง"
                aria-describedby="seat-map-keyboard-hint"
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

                {/* ---- โซน (กดบนรูปโดยตรง — เมาส์/นิ้ว/คีย์บอร์ด) ---- */}
                {orderedZones.map(({ zone, available }) => {
                  if (!zone.polygon || zone.polygon.length < 3) return null;
                  const soldOut = available === 0;
                  const isHighlighted = zone.id === highlightZoneId;
                  const baseColor = soldOut ? SOLD_OUT_COLOR : zone.color;
                  return (
                    <g
                      key={zone.id}
                      data-zone-name={zone.name}
                      role="button"
                      tabIndex={soldOut ? -1 : 0}
                      aria-disabled={soldOut || undefined}
                      aria-label={`โซน ${zone.name} ราคา ${formatTHB(zone.price)} ${soldOut ? "เต็มแล้ว" : `ว่าง ${available} ${zone.isStanding ? "ใบ" : "ที่"}`}`}
                      onClick={() => {
                        if (!soldOut) openZone(zone);
                      }}
                      onKeyDown={(event) => {
                        if (soldOut) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openZone(zone);
                        }
                      }}
                      onMouseEnter={() => setHighlightZoneId(zone.id)}
                      onMouseLeave={() =>
                        setHighlightZoneId((id) =>
                          id === zone.id ? null : id,
                        )
                      }
                      onFocus={() => setHighlightZoneId(zone.id)}
                      onBlur={() =>
                        setHighlightZoneId((id) =>
                          id === zone.id ? null : id,
                        )
                      }
                      className={
                        soldOut ? "cursor-not-allowed" : "cursor-pointer"
                      }
                      // การเด่นขึ้นของกรอบทำหน้าที่เป็น focus indicator แทน outline เดิมของเบราว์เซอร์
                      style={{ outline: "none" }}
                    >
                      <title>
                        {`${zone.name} · ${formatTHB(zone.price)} · ${soldOut ? "เต็มแล้ว" : `ว่าง ${available} ${zone.isStanding ? "ใบ" : "ที่"}`}`}
                      </title>
                      <polygon
                        points={zone.polygon
                          .map(([x, y]) => `${x * viewW},${y * viewH}`)
                          .join(" ")}
                        fill={`${baseColor}${isHighlighted ? ZONE_FILL_ALPHA_ACTIVE : ZONE_FILL_ALPHA}`}
                        stroke={isHighlighted ? "#ffffff" : baseColor}
                        strokeWidth={(viewW / 500) * (isHighlighted ? 2.5 : 1)}
                      />
                    </g>
                  );
                })}

                {/* ---- ชื่อโซน: วาดรวบทีเดียวหลังกรอบทุกโซน ----
                    เดิมชื่ออยู่ในกลุ่มของโซนตัวเอง โซนที่วาดทีหลังจึงทับชื่อโซนก่อนหน้าได้
                    แยกมาวาดชั้นบนสุด = ชื่อที่ตัดสินใจแล้วว่าจะวาด ต้องอ่านออกจริงเสมอ */}
                {zoneLabels.map((label) => {
                  const isHighlighted = label.id === highlightZoneId;
                  const font = isHighlighted ? label.highlightFont : label.font;
                  if (!font) return null;
                  return (
                    <text
                      key={label.id}
                      x={label.x}
                      y={label.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={font}
                      fill="#ffffff"
                      opacity={label.soldOut ? 0.5 : 1}
                      className="pointer-events-none select-none font-display font-semibold"
                      // ขอบดำจาง ๆ รอบตัวอักษร — กันชื่อโซนกลืนกับสีพื้นที่แอดมินตั้งให้ตรงกับรูป
                      style={{
                        paintOrder: "stroke",
                        stroke: "#00000099",
                        strokeWidth: font / 6,
                      }}
                    >
                      {label.name}
                    </text>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* ---------- legend ราคาแบบย่อ 1 แถว (เผื่อรูปผังไม่มีแถบราคาในตัว) ---------- */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-faint">
            {priceTiers.map((tier) => (
              <span
                key={tier.key}
                className="inline-flex items-center gap-1.5"
                title={`${tier.label} · ${tier.zoneCount} โซน · ${tier.seats.toLocaleString()} ที่นั่ง`}
              >
                <span
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: tier.color }}
                  aria-hidden
                />
                <span className="text-led text-spot-400">
                  {formatTHB(tier.price)}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ---------- ชั้น 2: หัวโซน + ปุ่มกลับผังรวม ---------- */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveZoneId(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-fg/15 bg-ink-900 px-3 py-1.5 text-sm text-fg-dim transition-colors hover:border-brand-400 hover:text-fg"
            >
              <ArrowLeft className="size-4" aria-hidden />
              ผังรวม
            </button>
            <span
              className="ml-1 size-3 rounded-full"
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
              <span className="text-xs text-fg-faint">({activeZone.tier})</span>
            )}
            <span className="text-led text-sm text-spot-400">
              {formatTHB(activeZone.price)}
            </span>
            <span className="text-xs text-fg-faint">
              ว่าง {availableByZone.get(activeZone.id) ?? 0} /{" "}
              {zoneTotal(activeZone)} {activeZone.isStanding ? "ใบ" : "ที่"}
            </span>
          </div>

          {/* มินิแมพ — ตอบ "โซนนี้อยู่ตรงไหนของฮอลล์" โดยไม่ต้องกดกลับไปผังรวม
              ใช้รูปผังจริงทั้งใบ หรี่ส่วนอื่นลง แล้วเจาะสปอตไลท์เฉพาะโซนที่เปิดอยู่
              (ผลจาก user-test: กริดเปล่า ๆ ไม่บอกอะไรเลยว่าที่นั่งอยู่มุมไหนเทียบกับผังจริง) */}
          {activeZone.polygon && activeZone.polygon.length >= 3 && (
            <div className="overflow-hidden rounded-lg border border-fg/10 bg-ink-950">
              <svg
                viewBox={`0 0 ${viewW} ${viewH}`}
                className="block max-h-44 w-full"
                role="img"
                aria-label={`ตำแหน่งโซน ${activeZone.name} บนผังรวม`}
              >
                <image href={layout.base64} width={viewW} height={viewH} />
                <mask id={`zone-spot-${activeZone.id}`}>
                  <rect width={viewW} height={viewH} fill="#ffffff" />
                  <polygon
                    points={activeZone.polygon
                      .map(([x, y]) => `${x * viewW},${y * viewH}`)
                      .join(" ")}
                    fill="#000000"
                  />
                </mask>
                <rect
                  width={viewW}
                  height={viewH}
                  fill="#09090b"
                  opacity={0.55}
                  mask={`url(#zone-spot-${activeZone.id})`}
                />
                <polygon
                  points={activeZone.polygon
                    .map(([x, y]) => `${x * viewW},${y * viewH}`)
                    .join(" ")}
                  fill={`${activeZone.color}${ZONE_FILL_ALPHA}`}
                  stroke="#ffffff"
                  strokeWidth={viewW / 300}
                />
              </svg>
            </div>
          )}

          {/* สิทธิ์หลังผ่านคิวหมดเวลา — บอกทางออกจริง (เข้าคิวใหม่) ไม่ใช่ปุ่มลองใหม่ที่ไม่มีวันผ่าน */}
          {admitExpired ? (
            <div className="rounded-xl border border-warning/25 bg-warning/10 p-5">
              <p className="text-sm font-semibold text-warning">
                สิทธิ์เลือกที่นั่งหมดเวลาแล้ว
              </p>
              <p className="mt-1 text-sm text-fg-faint">
                เพื่อความเป็นธรรมกับคิวถัดไป
                ระบบให้เวลาเลือกที่นั่งจำกัดหลังผ่านคิว —
                เข้าคิวใหม่แล้วกลับมาเลือกต่อได้เลย
                (ถ้ามีคำสั่งซื้อค้างชำระอยู่ หน้าคิวจะมีทางลัดไปจ่ายต่อ)
              </p>
              <Button
                type="button"
                className="mt-3"
                onClick={() => router.push(`/concerts/${slug}/queue`)}
              >
                เข้าคิวใหม่ →
              </Button>
            </div>
          ) : activeZone.isStanding ? (
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
                      (standingSelection?.quantity ?? 1) >= activeStandingLimit
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
          ) : (
            <>
              <div
                className="grid gap-2 sm:grid-cols-2"
                role="group"
                aria-label="โหมดเลือกที่นั่ง"
              >
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
              </div>

              {seatedMode === "best" ? (
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
                <>
                  <div className="flex items-stretch gap-2">
                    {markerSide === "left" && <StageMarker side="left" />}
                    <div className="min-w-0 flex-1">
                      {markerSide === "top" && <StageMarker side="top" />}
                      {/* กล่องเดียวเลื่อนได้ทั้งสองแกน แต่แต่ละแถวข้อมูลต้องอยู่บรรทัดเดียวเสมอ */}
                      <div className="max-h-96 overflow-auto overflow-x-auto rounded-lg bg-ink-900 pr-1">
                        <div className="w-max min-w-full space-y-1.5 py-1">
                          {displayedRows.map((row, rowIndex) => (
                            <div
                              key={row.label}
                              className="flex flex-nowrap items-start"
                            >
                              <span className="sticky left-0 z-10 w-8 shrink-0 bg-ink-900 py-1.5 pl-1 font-display text-xs text-fg-faint">
                                {row.label}
                              </span>
                              <div
                                className="flex shrink-0 flex-nowrap gap-1.5"
                                style={{
                                  width: seatStripWidth,
                                  // ร่นซ้ายตามหน้าตัดกรอบโซนจริงของแถวนี้
                                  paddingLeft: displayedInsetPx[rowIndex] ?? 0,
                                }}
                              >
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
                      {markerSide === "bottom" && (
                        <StageMarker side="bottom" />
                      )}
                    </div>
                    {markerSide === "right" && <StageMarker side="right" />}
                  </div>
                  {/* คำอธิบายสถานะที่นั่ง — โชว์คู่กับกริดเท่านั้น (ผังรวมไม่มีที่นั่งรายตัวให้ตีความ) */}
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
                </>
              ) : (
                <div className="rounded-xl border border-fg/10 bg-ink-950 p-6 text-center text-sm text-fg-faint">
                  กำลังเตรียมผังที่นั่งของโซนนี้…
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------- ฝั่งขวา: สรุป (พฤติกรรมเดียวกับผังแบบเดิม) ---------- */}
      <div className="h-fit rounded-xl border border-fg/10 bg-ink-850 p-4 shadow-md lg:sticky lg:top-24">
        <h3 className="mb-3 font-display font-semibold text-fg">
          รายการที่เลือก
        </h3>

        {!hasSelection ? (
          <p className="text-sm text-fg-faint">
            ยังไม่ได้เลือกบัตร — แตะโซนบนผังเพื่อเริ่ม
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
            {bestAvailableSelection.zoneName} × {bestAvailableSelection.quantity}{" "}
            ที่ (ระบบเลือกให้)
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
              ยืนยันว่าคุณไม่ใช่บอท แล้วระบบจะจองบัตรให้ต่ออัตโนมัติ
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
          disabled={!hasSelection || submitting || overQuota}
          loading={submitting}
          onClick={() => handleSubmit()}
        >
          {submitting ? "กำลังจองบัตร…" : "ดำเนินการชำระเงิน →"}
        </Button>
        {remainingQuota === 0 ? (
          <p className="mt-2.5 text-center text-xs text-warning">
            คุณจองครบโควตา {maxSeats} ที่นั่ง/บัญชีของคอนเสิร์ตนี้แล้ว
          </p>
        ) : (
          <p className="mt-2.5 text-center text-xs text-fg-faint">
            {remainingQuota < maxSeats
              ? `จองได้อีก ${remainingQuota} ที่นั่ง · บัตรจะถูกล็อกให้คุณ 5 นาทีเพื่อชำระเงิน`
              : "บัตรจะถูกล็อกให้คุณ 5 นาทีเพื่อชำระเงิน"}
          </p>
        )}
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
