"use client";

// ============================================================
// Seat Map Editor (แอดมิน) — วาดกรอบโซนทับรูปผังจริง แล้วให้ระบบเจนที่นั่ง
// ============================================================
// ทำไมไม่ให้เครื่องอ่านรูปเอง: ผังจริงมีตัวหนังสือ/เส้น/สีซ้ำ computer vision พลาดง่าย
//   -> ใช้คนวาดกรอบ (แม่นยำ 100%) แล้วให้เครื่องทำส่วนที่คนทำช้า คือโปรยที่นั่งให้เต็มกรอบ
//
// 🔑 พิกัดทุกจุดเก็บเป็นสัดส่วน 0-1 ของขนาดรูป ไม่ใช่พิกเซลบนจอ
//    คลิกจากจอไหน ขนาดเท่าไร ก็ได้ค่าเดียวกัน
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Undo2, Trash2, MousePointerClick, Frame, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { polygonArea } from "@/lib/seatmap/generate";
import { seatOutline } from "@/lib/seatmap/render-hints";
import {
  saveLayoutImage,
  saveZoneWithSeats,
  deleteZone,
  assignZoneFrame,
} from "@/app/actions/seatmap";

type Point = [number, number];

interface ZoneView {
  id: string;
  name: string;
  price: string;
  color: string;
  totalSeats: number;
  polygon: Point[] | null;
  seats: { x: number | null; y: number | null; status: string }[];
}

interface Props {
  concertId: string;
  layout: { base64: string | null; width: number | null; height: number | null };
  zones: ZoneView[];
}

// ย่อรูปฝั่ง client ก่อนส่ง — ผังสถานที่จริงมักโดด 3-4MB ซึ่งเกิน bodySizeLimit (3mb) ของ server action
const MAX_UPLOAD_WIDTH = 1600;

// ระดับซูมของผัง — ผังสนามจริงมีโซนย่อยหลายสิบโซน บางโซนกว้างไม่ถึง 20 พิกเซลบนจอ
// ถ้าวาดมุมกรอบบนรูปย่ออย่างเดียวจะกะขอบโซนไม่ได้เลย (ใช้ระดับเดียวกับฝั่งคนซื้อเพื่อให้คุ้นมือ)
const ZOOM_STEPS = [1, 1.75, 2.5] as const;
// รัศมีจุดที่นั่ง = สัดส่วนของระยะห่างระหว่างที่นั่ง — ค่าเดียวกับฝั่งคนซื้อ ผังสองฝั่งจะได้หน้าตาตรงกัน
// เดิมฝั่งนี้ใช้ค่าคงที่ viewW/260 ซึ่งบนผังจริงจุดโตกว่าระยะห่าง -> จุดเชื่อมกันเป็นแผ่นสีทึบ
const SEAT_RADIUS_RATIO = 0.2;
// เพดานล่าง/บนของรัศมีจุด — เล็กกว่านี้มองไม่เห็น ใหญ่กว่านี้บังรูปผังข้างล่าง
const SEAT_RADIUS_MIN_DIVISOR = 900;
const SEAT_RADIUS_MAX_DIVISOR = 260;

async function shrinkImage(file: File): Promise<{ base64: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_UPLOAD_WIDTH / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("เบราว์เซอร์นี้วาดรูปลง canvas ไม่ได้");
  ctx.drawImage(bitmap, 0, 0, width, height);

  // webp เล็กกว่ามาก แต่บางเบราว์เซอร์ไม่รองรับแล้วเงียบ ๆ คืน png มาแทน -> เช็คแล้วถอยไป jpeg
  let base64 = canvas.toDataURL("image/webp", 0.8);
  if (!base64.startsWith("data:image/webp")) base64 = canvas.toDataURL("image/jpeg", 0.82);
  return { base64, width, height };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// สีจุดที่นั่งตามสถานะ — ให้แอดมินเห็นทันทีว่าโซนไหนมีของขายไปแล้ว (เจนทับไม่ได้)
function seatFill(status: string, zoneColor: string): string {
  if (status === "SOLD") return "#f43f5e";
  if (status === "HELD") return "#f59e0b";
  if (status === "BLOCKED") return "#64748b";
  return zoneColor;
}

export function SeatmapEditor({ concertId, layout, zones }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // กรอบที่กำลังวาด (สัดส่วน 0-1)
  const [points, setPoints] = useState<Point[]>([]);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("1500");
  const [color, setColor] = useState("#ef4444");
  const [seatCount, setSeatCount] = useState("100");
  const [zoomIndex, setZoomIndex] = useState(0);

  // ขนาด viewBox ของ SVG — ใช้ขนาดรูปจริงเพื่อให้อัตราส่วนตรงกับพื้นหลังเป๊ะ
  const viewW = layout.width ?? 1600;
  const viewH = layout.height ?? 900;
  const zoom = ZOOM_STEPS[zoomIndex];

  /**
   * รัศมีจุดที่นั่งของแต่ละโซน คิดจากความหนาแน่นจริง
   *
   * ประมาณระยะห่างจาก √(พื้นที่กรอบ ÷ จำนวนที่นั่ง) — ไม่ต้องไล่เทียบทุกคู่ให้หน่วง
   * และแม่นพอสำหรับเลือกขนาดจุด เพราะตัวเจนโปรยที่นั่งเป็นกริดเต็มกรอบอยู่แล้ว
   */
  const zoneDotRadius = useMemo(() => {
    const map = new Map<string, number>();
    const minRadius = viewW / SEAT_RADIUS_MIN_DIVISOR;
    const maxRadius = viewW / SEAT_RADIUS_MAX_DIVISOR;
    for (const zone of zones) {
      const placed = zone.seats.filter((seat) => seat.x !== null && seat.y !== null).length;
      const area = zone.polygon ? polygonArea(zone.polygon) * viewW * viewH : 0;
      const spacing = placed > 0 && area > 0 ? Math.sqrt(area / placed) : maxRadius / SEAT_RADIUS_RATIO;
      map.set(zone.id, Math.min(maxRadius, Math.max(minRadius, spacing * SEAT_RADIUS_RATIO)));
    }
    return map;
  }, [zones, viewW, viewH]);

  function resetForm() {
    setPoints([]);
    setEditingZoneId(null);
    setName("");
    setPrice("1500");
    setColor("#ef4444");
    setSeatCount("100");
  }

  function loadZoneForEdit(zone: ZoneView) {
    setEditingZoneId(zone.id);
    setPoints(zone.polygon ?? []);
    setName(zone.name);
    setPrice(String(Math.round(Number(zone.price))));
    setColor(zone.color);
    setSeatCount(String(zone.totalSeats));
    setFeedback(null);
  }

  // คลิกบนรูป = เพิ่มจุดมุมของกรอบ
  function handleCanvasClick(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    setPoints((prev) => [...prev, [x, y]]);
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setFeedback(null);
    try {
      const shrunk = await shrinkImage(file);
      const result = await saveLayoutImage({ concertId, ...shrunk });
      setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) startTransition(() => router.refresh());
    } catch {
      setFeedback({ ok: false, text: "อ่านไฟล์รูปไม่สำเร็จ" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSaveZone() {
    if (points.length < 3) {
      setFeedback({ ok: false, text: "คลิกบนรูปอย่างน้อย 3 จุดเพื่อวาดกรอบโซนก่อน" });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await saveZoneWithSeats({
      concertId,
      zoneId: editingZoneId ?? undefined,
      name,
      price: Number(price),
      color,
      polygon: points,
      seatCount: Number(seatCount),
    });
    setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
    setBusy(false);
    if (result.ok) {
      resetForm();
      startTransition(() => router.refresh());
    }
  }

  async function handleDeleteZone(zone: ZoneView) {
    setBusy(true);
    setFeedback(null);
    const result = await deleteZone({ concertId, zoneId: zone.id });
    setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
    setBusy(false);
    if (result.ok) {
      if (editingZoneId === zone.id) resetForm();
      startTransition(() => router.refresh());
    }
  }

  /**
   * ตั้งกรอบให้โซนเดิม โดยไม่ลบที่นั่ง — ทางออกเดียวของโซนที่ขายบัตรไปแล้ว
   * (ปุ่ม "บันทึก + เจนที่นั่งใหม่" จะถูกด่านกันเจนทับปฏิเสธตลอด เพราะเจน = ลบทิ้งสร้างใหม่)
   */
  async function handleAssignFrame(zone: ZoneView) {
    if (points.length < 3) {
      setFeedback({ ok: false, text: "คลิกบนรูปอย่างน้อย 3 จุดเพื่อวาดกรอบก่อน" });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await assignZoneFrame({ concertId, zoneId: zone.id, polygon: points });
    setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
    setBusy(false);
    if (result.ok) {
      resetForm();
      startTransition(() => router.refresh());
    }
  }

  const working = busy || pending;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ---------- ผัง ---------- */}
      <div>
        {layout.base64 ? (
          <>
            <div className="mb-2 flex items-center justify-end gap-1.5">
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
            {/* ซูมแล้วต้องเลื่อนดูได้ ไม่งั้นขยายไปก็เห็นแค่มุมซ้ายบน */}
            <div className="overflow-auto rounded-xl border border-fg/10 bg-ink-950">
              <div className="relative" style={{ width: `${zoom * 100}%` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={layout.base64} alt="ผังสถานที่จัดงาน" className="block w-full" />
                <svg
                  viewBox={`0 0 ${viewW} ${viewH}`}
                  className="absolute inset-0 h-full w-full cursor-crosshair"
                  onClick={handleCanvasClick}
                  role="presentation"
                >
                  {/* โซนที่บันทึกแล้ว + ที่นั่งที่เจนไว้ */}
                  {zones.map((zone) => {
                    const dotRadius = zoneDotRadius.get(zone.id) ?? viewW / SEAT_RADIUS_MAX_DIVISOR;
                    return (
                      <g key={zone.id} opacity={editingZoneId === zone.id ? 0.25 : 1}>
                        {zone.polygon && zone.polygon.length >= 3 && (
                          <polygon
                            points={zone.polygon
                              .map(([x, y]) => `${x * viewW},${y * viewH}`)
                              .join(" ")}
                            fill={`${zone.color}22`}
                            stroke={zone.color}
                            strokeWidth={viewW / 400 / zoom}
                          />
                        )}
                        {zone.seats.map((seat, i) => {
                          if (seat.x === null || seat.y === null) return null;
                          const fill = seatFill(seat.status, zone.color);
                          return (
                            <circle
                              key={i}
                              cx={seat.x * viewW}
                              cy={seat.y * viewH}
                              r={dotRadius}
                              fill={fill}
                              // ขอบตัดกับสีจุด — บนผังจริงที่โซนถูกระบายสีไว้แล้ว ถ้าไม่มีขอบจุดจะหายไปเลย
                              stroke={seatOutline(fill)}
                              strokeWidth={dotRadius * 0.5}
                            />
                          );
                        })}
                      </g>
                    );
                  })}

                  {/* กรอบที่กำลังวาดอยู่ — เส้นและหมุดหารด้วยระดับซูม ให้คงขนาดเท่าเดิมบนจอ
                      (จุดประสงค์ของการซูมคือวางมุมให้ละเอียดขึ้น หมุดโตตามซูมจะบังตำแหน่งที่จะกด) */}
                  {points.length >= 2 && (
                    <polygon
                      points={points.map(([x, y]) => `${x * viewW},${y * viewH}`).join(" ")}
                      fill={`${color}33`}
                      stroke={color}
                      strokeWidth={viewW / 300 / zoom}
                      strokeDasharray={`${viewW / 100 / zoom} ${viewW / 160 / zoom}`}
                    />
                  )}
                  {points.map(([x, y], i) => (
                    <circle
                      key={i}
                      cx={x * viewW}
                      cy={y * viewH}
                      r={viewW / 180 / zoom}
                      fill={color}
                      stroke="#fff"
                      strokeWidth={viewW / 700 / zoom}
                    />
                  ))}
                </svg>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-fg/15 bg-ink-900/60 p-10 text-center">
            <ImageUp className="size-8 text-fg-faint" aria-hidden />
            <p className="text-sm text-fg-faint">
              ยังไม่มีรูปผังสถานที่ — อัปโหลดรูปก่อนถึงจะวาดกรอบโซนได้
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleUpload}
            className="hidden"
            id="layout-upload"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={working}
            onClick={() => fileRef.current?.click()}
          >
            <ImageUp className="size-4" aria-hidden />
            {layout.base64 ? "เปลี่ยนรูปผัง" : "อัปโหลดรูปผัง"}
          </Button>
          {layout.base64 && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={working || points.length === 0}
                onClick={() => setPoints((p) => p.slice(0, -1))}
              >
                <Undo2 className="size-4" aria-hidden />
                ถอย 1 จุด
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={working || points.length === 0}
                onClick={() => setPoints([])}
              >
                ล้างกรอบ
              </Button>
              <span className="inline-flex items-center gap-1.5 text-xs text-fg-faint">
                <MousePointerClick className="size-3.5" aria-hidden />
                คลิกบนรูปเพื่อวางมุมกรอบ ({points.length} จุด)
              </span>
            </>
          )}
        </div>
      </div>

      {/* ---------- แผงควบคุม ---------- */}
      <div className="space-y-4">
        <div className="rounded-xl border border-fg/10 bg-ink-850 p-4">
          <h3 className="mb-3 font-display text-sm font-semibold text-fg">
            {editingZoneId ? "แก้ไขโซน" : "โซนใหม่"}
          </h3>
          <div className="space-y-3">
            <div>
              <Label htmlFor="zone-name">ชื่อโซน</Label>
              <Input
                id="zone-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VIP, R1, ยืน"
                maxLength={50}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="zone-price">ราคา (บาท)</Label>
                <Input
                  id="zone-price"
                  type="number"
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="zone-seats">จำนวนที่นั่ง</Label>
                <Input
                  id="zone-seats"
                  type="number"
                  min={1}
                  max={5000}
                  value={seatCount}
                  onChange={(e) => setSeatCount(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="zone-color">สีโซน</Label>
              <div className="flex items-center gap-2">
                <input
                  id="zone-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-11 w-14 cursor-pointer rounded-lg border border-fg/15 bg-ink-950/60"
                />
                <Input value={color} onChange={(e) => setColor(e.target.value)} maxLength={7} />
              </div>
            </div>

            <Button
              type="button"
              className="w-full"
              loading={working}
              disabled={working || points.length < 3 || name.trim() === ""}
              onClick={handleSaveZone}
            >
              {editingZoneId ? "บันทึก + เจนที่นั่งใหม่" : "สร้างโซน + เจนที่นั่ง"}
            </Button>
            {editingZoneId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={resetForm}
                disabled={working}
              >
                ยกเลิกการแก้ไข
              </Button>
            )}
          </div>
        </div>

        {feedback && (
          <p
            className={`rounded-lg border px-3 py-2 text-sm leading-relaxed ${
              feedback.ok
                ? "border-success/30 bg-success/10 text-success"
                : "border-danger/30 bg-danger/10 text-danger"
            }`}
            role="status"
          >
            {feedback.text}
          </p>
        )}

        <div className="rounded-xl border border-fg/10 bg-ink-850 p-4">
          <h3 className="mb-3 font-display text-sm font-semibold text-fg">
            โซนทั้งหมด ({zones.length})
          </h3>
          {zones.length === 0 ? (
            <p className="text-sm text-fg-faint">ยังไม่มีโซน</p>
          ) : (
            <ul className="space-y-2">
              {zones.map((zone) => {
                const sold = zone.seats.filter((s) => s.status === "SOLD").length;
                return (
                  <li
                    key={zone.id}
                    className="rounded-lg border border-fg/10 bg-ink-900/60 p-2.5 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 truncate">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: zone.color }}
                          aria-hidden
                        />
                        <span className="truncate font-medium text-fg">{zone.name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-fg-faint">
                        {zone.seats.length} ที่
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {!zone.polygon && <Badge tone="warning">ยังไม่มีกรอบ</Badge>}
                      {sold > 0 && <Badge tone="danger">ขายแล้ว {sold}</Badge>}
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <Button
                        type="button"
                        variant="subtle"
                        size="sm"
                        disabled={working}
                        onClick={() => loadZoneForEdit(zone)}
                      >
                        แก้ไข
                      </Button>
                      <Button
                        type="button"
                        variant="subtle"
                        size="sm"
                        disabled={working || points.length < 3}
                        title={
                          points.length < 3
                            ? "วาดกรอบบนรูปอย่างน้อย 3 จุดก่อน"
                            : "ย้ายที่นั่งเดิมมาลงกรอบนี้ โดยไม่ลบที่นั่ง (ใช้กับโซนที่ขายบัตรไปแล้ว)"
                        }
                        onClick={() => handleAssignFrame(zone)}
                      >
                        <Frame className="size-3.5" aria-hidden />
                        ตั้งกรอบ (คงที่นั่งเดิม)
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={working}
                        onClick={() => handleDeleteZone(zone)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        ลบ
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
