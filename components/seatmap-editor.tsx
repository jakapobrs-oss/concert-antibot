"use client";

// ============================================================
// Seat Map Editor (แอดมิน) — วาดกรอบเวทีและกรอบโซนทับรูปผังจริง
// ============================================================
// ทำไมไม่ให้เครื่องอ่านรูปเอง: ผังจริงมีตัวหนังสือ/เส้น/สีซ้ำ computer vision พลาดง่าย
//   -> ใช้คนวาดกรอบ (แม่นยำ 100%) แล้วให้เครื่องทำส่วนที่คนทำช้า
//
// 📌 งานของหน้านี้คือ "ผังบอกตำแหน่ง" ไม่ใช่ผังที่นั่งรายตัว
//    จำนวนที่นั่งไม่ผูกกับขนาดกรอบ -> วาดกรอบเล็กแต่สั่ง 500 ที่ก็ได้
//    ข้อมูลตัวเลข (ชื่อ/เรท/ราคา/สี/จำนวนที่นั่ง) มาจากไฟล์ Excel ทีเดียวทั้งงาน
//    เหลือแค่งานที่แทนกันไม่ได้จริง ๆ บนหน้านี้คือ "ลากกรอบให้ตรงกับรูป"
//
// 🔑 พิกัดทุกจุดเก็บเป็นสัดส่วน 0-1 ของขนาดรูป ไม่ใช่พิกเซลบนจอ
//    คลิกจากจอไหน ขนาดเท่าไร ก็ได้ค่าเดียวกัน
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ImageUp,
  Undo2,
  Trash2,
  MousePointerClick,
  Frame,
  ZoomIn,
  ZoomOut,
  FileSpreadsheet,
  Download,
  Theater,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  appendPointWithinCap,
  insertMidpointWithinCap,
  movePolygonPoint,
  polygonPoleOfInaccessibility,
  translatePolygonWithinBounds,
  type Point,
  type Polygon,
} from "@/lib/seatmap/polygon";
import {
  selectImageFitPlan,
  type ImageFitPlan,
} from "@/lib/seatmap/image-fit";
import {
  saveLayoutImage,
  saveZoneWithSeats,
  deleteZone,
  assignZoneFrame,
  saveStagePolygon,
  importZonesFromSheet,
} from "@/app/actions/seatmap";

interface ZoneView {
  id: string;
  name: string;
  tier: string | null;
  price: string;
  color: string;
  totalSeats: number;
  polygon: Point[] | null;
  soldCount: number;
  heldCount: number;
}

interface Props {
  concertId: string;
  layout: { base64: string | null; width: number | null; height: number | null };
  stagePolygon: Polygon | null;
  zones: ZoneView[];
}

/** กำลังวาดอะไรอยู่ — กรอบโซน หรือกรอบเวที */
type DrawMode = "zone" | "stage";

// ระดับซูมของผัง — ผังสนามจริงมีโซนย่อยหลายสิบโซน บางโซนกว้างไม่ถึง 20 พิกเซลบนจอ
// ถ้าวาดมุมกรอบบนรูปย่ออย่างเดียวจะกะขอบโซนไม่ได้เลย (ใช้ระดับเดียวกับฝั่งคนซื้อเพื่อให้คุ้นมือ)
const ZOOM_STEPS = [1, 1.75, 2.5] as const;
// ขนาดตัวอักษรชื่อโซนบนผัง = สัดส่วนความกว้างรูป (ค่าเดียวกับฝั่งคนซื้อ ผังสองฝั่งจะได้ตรงกัน)
const LABEL_RATIO = 1 / 46;
// สีกรอบเวที — ขาวนวลให้ต่างจากสีเรทของโซนทุกสีอย่างชัดเจน
const STAGE_COLOR = "#e4e4e7";
// เพดาน base64 ของไฟล์ Excel ที่ยอมส่ง — ตรงกับ MAX_SHEET_BASE64_LEN ฝั่ง server action
const MAX_SHEET_BASE64_LEN = 1_400_000;
// ต้องตรงกับ polygonSchema ฝั่ง server เพื่อไม่ให้แอดมินวาดเกินแล้วรู้ตัวตอนกดบันทึกทีหลัง
const MAX_POLYGON_POINTS = 60;
const DRAG_THRESHOLD_PX = 3;
const IMAGE_TOO_LARGE_MESSAGE =
  "รูปยังใหญ่เกินไปแม้ย่ออัตโนมัติแล้ว กรุณาย่อขนาดรูปมาก่อนอัปโหลด";

interface PolygonDragState {
  kind: "point" | "polygon";
  pointIndex?: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  canvasRect: DOMRect;
  startPoints: Point[];
  moved: boolean;
}

async function shrinkImage(file: File): Promise<{ base64: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("เบราว์เซอร์นี้วาดรูปลง canvas ไม่ได้");

    const encoded = new Map<string, string>();
    const encode = (plan: ImageFitPlan) => {
      const key = `${plan.width}x${plan.height}@${plan.quality}`;
      const cached = encoded.get(key);
      if (cached) return cached;

      canvas.width = plan.width;
      canvas.height = plan.height;
      ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);

      // WebP เล็กกว่า แต่บางเบราว์เซอร์คืนชนิดอื่นมาเงียบ ๆ จึงต้องตรวจ prefix ทุก candidate
      let base64 = canvas.toDataURL("image/webp", plan.quality);
      if (!base64.startsWith("data:image/webp")) {
        base64 = canvas.toDataURL("image/jpeg", plan.quality);
      }
      encoded.set(key, base64);
      return base64;
    };

    const plan = selectImageFitPlan(bitmap.width, bitmap.height, (candidate) =>
      encode(candidate).length,
    );
    if (!plan) throw new Error(IMAGE_TOO_LARGE_MESSAGE);

    return { base64: encode(plan), width: plan.width, height: plan.height };
  } finally {
    bitmap.close();
  }
}

/** อ่านไฟล์เป็น base64 — ใช้ส่งไฟล์ Excel ให้ server action (ไม่มี multipart ใน server action) */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function SeatmapEditor({ concertId, layout, stagePolygon, zones }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLInputElement>(null);
  const uploadInProgressRef = useRef(false);
  const dragDepthRef = useRef(0);
  const polygonDragRef = useRef<PolygonDragState | null>(null);
  const suppressCanvasClickRef = useRef(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    text: string;
    details?: string[];
    warning?: boolean;
  } | null>(null);

  // กรอบที่กำลังวาด (สัดส่วน 0-1)
  const [points, setPoints] = useState<Point[]>([]);
  const pointsRef = useRef<Point[]>([]);
  const [mode, setMode] = useState<DrawMode>("zone");
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [tier, setTier] = useState("");
  const [price, setPrice] = useState("1500");
  const [color, setColor] = useState("#ef4444");
  const [seatCount, setSeatCount] = useState("100");
  const [zoomIndex, setZoomIndex] = useState(0);

  // ขนาด viewBox ของ SVG — ใช้ขนาดรูปจริงเพื่อให้อัตราส่วนตรงกับพื้นหลังเป๊ะ
  const viewW = layout.width ?? 1600;
  const viewH = layout.height ?? 900;
  const zoom = ZOOM_STEPS[zoomIndex];
  const labelSize = viewW * LABEL_RATIO;
  const drawColor = mode === "stage" ? STAGE_COLOR : color;

  function commitPoints(nextPoints: Point[]) {
    // event ที่ยิงติดกันก่อน render ต้องเห็นค่าที่เพิ่ง commit ไม่ใช่ closure เก่าของ React
    pointsRef.current = nextPoints;
    setPoints(nextPoints);
  }

  function resetForm() {
    commitPoints([]);
    setEditingZoneId(null);
    setName("");
    setTier("");
    setPrice("1500");
    setColor("#ef4444");
    setSeatCount("100");
  }

  function loadZoneForEdit(zone: ZoneView) {
    setMode("zone");
    setEditingZoneId(zone.id);
    commitPoints(zone.polygon ?? []);
    setName(zone.name);
    setTier(zone.tier ?? "");
    setPrice(String(Math.round(Number(zone.price))));
    setColor(zone.color);
    setSeatCount(String(zone.totalSeats));
    setFeedback(null);
  }

  // คลิกพื้นที่ว่างบนรูป = เพิ่มจุดเหมือนเดิม ส่วนกรอบ/ตัวจับจะหยุด event ของตัวเอง
  function handleCanvasClick(event: React.MouseEvent<SVGSVGElement>) {
    if (suppressCanvasClickRef.current) return;
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    const result = appendPointWithinCap(pointsRef.current, [x, y], MAX_POLYGON_POINTS);
    if (!result.added) {
      setFeedback({
        ok: false,
        text: `กรอบหนึ่งมีได้ไม่เกิน ${MAX_POLYGON_POINTS} จุด — ลบจุดที่ไม่จำเป็นก่อนเพิ่มใหม่`,
      });
      return;
    }
    commitPoints(result.points);
  }

  function removePoint(index: number) {
    if (pointsRef.current.length <= 3) {
      setFeedback({ ok: false, text: "กรอบต้องเหลืออย่างน้อย 3 จุด จึงลบจุดนี้ไม่ได้" });
      return;
    }
    commitPoints(pointsRef.current.filter((_, currentIndex) => currentIndex !== index));
  }

  function insertMidpoint(afterIndex: number) {
    const result = insertMidpointWithinCap(
      pointsRef.current,
      afterIndex,
      MAX_POLYGON_POINTS,
    );
    if (!result.added) {
      setFeedback({
        ok: false,
        text: `กรอบหนึ่งมีได้ไม่เกิน ${MAX_POLYGON_POINTS} จุด — ลบจุดที่ไม่จำเป็นก่อนแทรกจุดใหม่`,
      });
      return;
    }
    commitPoints(result.points);
  }

  function startPolygonDrag(
    event: React.PointerEvent<SVGElement>,
    kind: "point" | "polygon",
    pointIndex?: number,
  ) {
    event.stopPropagation();
    if (event.button !== 0) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;

    polygonDragRef.current = {
      kind,
      pointIndex,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      canvasRect: svg.getBoundingClientRect(),
      startPoints: pointsRef.current,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePolygonPointerMove(event: React.PointerEvent<SVGElement>) {
    const drag = polygonDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    const movedPx = Math.hypot(
      event.clientX - drag.startClientX,
      event.clientY - drag.startClientY,
    );
    if (!drag.moved && movedPx <= DRAG_THRESHOLD_PX) return;
    drag.moved = true;

    if (drag.kind === "point" && drag.pointIndex !== undefined) {
      const point: Point = [
        (event.clientX - drag.canvasRect.left) / drag.canvasRect.width,
        (event.clientY - drag.canvasRect.top) / drag.canvasRect.height,
      ];
      commitPoints(movePolygonPoint(drag.startPoints, drag.pointIndex, point));
      return;
    }

    const deltaX = (event.clientX - drag.startClientX) / drag.canvasRect.width;
    const deltaY = (event.clientY - drag.startClientY) / drag.canvasRect.height;
    commitPoints(translatePolygonWithinBounds(drag.startPoints, deltaX, deltaY));
  }

  function finishPolygonDrag(event: React.PointerEvent<SVGElement>) {
    const drag = polygonDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    polygonDragRef.current = null;

    if (!drag.moved && drag.kind === "polygon" && event.type === "pointerup") {
      // คลิกบนกรอบต้องเพิ่มจุดตรงนี้ เพราะกรอบดัก event ไว้เอง ไม่งั้นวาดโซนวงแหวนแล้วจุดจะหายเงียบ ๆ
      const point: Point = [
        clamp01((event.clientX - drag.canvasRect.left) / drag.canvasRect.width),
        clamp01((event.clientY - drag.canvasRect.top) / drag.canvasRect.height),
      ];
      const result = appendPointWithinCap(pointsRef.current, point, MAX_POLYGON_POINTS);
      if (!result.added) {
        setFeedback({
          ok: false,
          text: `กรอบหนึ่งมีได้ไม่เกิน ${MAX_POLYGON_POINTS} จุด — ลบจุดที่ไม่จำเป็นก่อนเพิ่มใหม่`,
        });
      } else {
        commitPoints(result.points);
      }

      // กลืน click ที่เบราว์เซอร์ยิงต่อจาก pointerup เพื่อไม่ให้คลิกเดียวเพิ่มสองจุด
      suppressCanvasClickRef.current = true;
      window.setTimeout(() => {
        suppressCanvasClickRef.current = false;
      }, 0);
      return;
    }

    if (drag.moved) {
      // Pointer Events จะยิง click ต่อท้าย pointerup ต้องกลืนเฉพาะ click รอบนี้ ไม่งั้นได้จุดเกินมา 1 จุด
      suppressCanvasClickRef.current = true;
      window.setTimeout(() => {
        suppressCanvasClickRef.current = false;
      }, 0);
    }
  }

  function handlePointClick(event: React.MouseEvent<SVGCircleElement>, index: number) {
    event.stopPropagation();
    if (suppressCanvasClickRef.current) return;
    if (event.altKey) removePoint(index);
  }

  function handlePointKeyDown(event: React.KeyboardEvent<SVGCircleElement>, index: number) {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removePoint(index);
      return;
    }

    const directions: Record<string, Point> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.01 : 0.002;
    const latestPoints = pointsRef.current;
    const current = latestPoints[index];
    commitPoints(
      movePolygonPoint(latestPoints, index, [
        current[0] + direction[0] * step,
        current[1] + direction[1] * step,
      ]),
    );
  }

  const processLayoutFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setFeedback({ ok: false, text: "รับเฉพาะไฟล์รูปภาพเท่านั้น" });
        return;
      }
      if (uploadInProgressRef.current) return;

      uploadInProgressRef.current = true;
      setBusy(true);
      setFeedback(null);
      try {
        const shrunk = await shrinkImage(file);
        const result = await saveLayoutImage({ concertId, ...shrunk });
        setFeedback({
          ok: result.ok,
          text: result.ok ? result.message : result.error,
          details: result.ok && result.warning ? [result.warning] : undefined,
          warning: result.ok && Boolean(result.warning),
        });
        if (result.ok) startTransition(() => router.refresh());
      } catch (error) {
        const knownMessage =
          error instanceof Error &&
          (error.message === IMAGE_TOO_LARGE_MESSAGE ||
            error.message === "เบราว์เซอร์นี้วาดรูปลง canvas ไม่ได้")
            ? error.message
            : "อ่านไฟล์รูปไม่สำเร็จ";
        setFeedback({ ok: false, text: knownMessage });
      } finally {
        uploadInProgressRef.current = false;
        setBusy(false);
      }
    },
    [concertId, router, startTransition],
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const imageItem = Array.from(event.clipboardData?.items ?? []).find(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
      const file = imageItem?.getAsFile();
      if (!file) return;

      // ไม่เช็กชนิด element ที่ focus เพราะเรากลืน paste เฉพาะเมื่อมีรูปจริงเท่านั้น
      // การวางข้อความใน input/textarea/contenteditable จึงยังเดินทางเดิมทุกกรณี
      event.preventDefault();
      void processLayoutFile(file);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [processLayoutFile]);

  function handleImageDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingImage(true);
  }

  function handleImageDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleImageDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingImage(false);
  }

  async function handleImageDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingImage(false);

    const image = Array.from(event.dataTransfer.files).find((file) =>
      file.type.startsWith("image/"),
    );
    if (!image) {
      setFeedback({ ok: false, text: "รับเฉพาะไฟล์รูปภาพเท่านั้น" });
      return;
    }
    await processLayoutFile(image);
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await processLayoutFile(file);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /** นำเข้าข้อมูลโซนทั้งงานจากไฟล์ Excel — สร้างโซนให้ครบ เหลือแค่มาวาดกรอบทีหลัง */
  async function handleImportSheet(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setFeedback(null);
    try {
      const dataUrl = await readAsBase64(file);
      if (dataUrl.length > MAX_SHEET_BASE64_LEN) {
        setFeedback({ ok: false, text: "ไฟล์ใหญ่เกินไป" });
        return;
      }
      const result = await importZonesFromSheet({ concertId, fileBase64: dataUrl });
      if (!result.ok) {
        setFeedback({ ok: false, text: result.error, details: result.issues });
        return;
      }
      // โซนที่ถูกข้าม/โซนที่ไม่มีในไฟล์ ต้องบอกให้ครบ ไม่งั้นแอดมินเข้าใจว่าไฟล์ลงครบแล้ว
      const details = [
        ...result.skipped,
        ...(result.notInFile.length > 0
          ? [`โซนที่มีในระบบแต่ไม่มีในไฟล์ (ไม่ได้ลบให้): ${result.notInFile.join(", ")}`]
          : []),
      ];
      setFeedback({ ok: true, text: result.message, details });
      startTransition(() => router.refresh());
    } catch {
      setFeedback({ ok: false, text: "อ่านไฟล์ Excel ไม่สำเร็จ" });
    } finally {
      setBusy(false);
      if (sheetRef.current) sheetRef.current.value = "";
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
      tier: tier.trim() === "" ? undefined : tier.trim(),
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

  /** บันทึกกรอบเวที — ส่ง null เพื่อลบเวทีออกจากผัง */
  async function handleSaveStage(polygon: Polygon | null) {
    if (polygon && polygon.length < 3) {
      setFeedback({ ok: false, text: "คลิกบนรูปอย่างน้อย 3 จุดเพื่อวาดกรอบเวทีก่อน" });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await saveStagePolygon({ concertId, polygon });
    setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
    setBusy(false);
    if (result.ok) {
      commitPoints([]);
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
   * ปุ่ม "ตั้งกรอบให้โซนนี้" ต้องเรียกทางนี้เมื่อแก้เฉพาะกรอบ เพราะไม่แตะที่นั่งเลย
   * ส่วน "บันทึก + เจนที่นั่งใหม่" ลบที่นั่งเดิมก่อนสร้างใหม่ จึงถูกด่านปฏิเสธเมื่อขายแล้ว
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
  const zonesWithoutFrame = zones.filter((zone) => !zone.polygon).length;
  const editingZone = editingZoneId
    ? zones.find((zone) => zone.id === editingZoneId) ?? null
    : null;
  const stageLabelPoint = stagePolygon && stagePolygon.length >= 3
    ? polygonPoleOfInaccessibility(stagePolygon)
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ---------- ผัง ---------- */}
      <div>
        {layout.base64 ? (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              {/* เลือกว่ากำลังวาดอะไรอยู่ — กรอบเดียวกัน คนละความหมาย ต้องเห็นชัดตลอดเวลา */}
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant={mode === "zone" ? "subtle" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setMode("zone");
                    commitPoints([]);
                  }}
                >
                  <Frame className="size-4" aria-hidden />
                  วาดกรอบโซน
                </Button>
                <Button
                  type="button"
                  variant={mode === "stage" ? "subtle" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setMode("stage");
                    // ถ้ามีเวทีเดิม ให้เข้าหน้าแก้ด้วยกรอบเดิมทันที ไม่บังคับวาดใหม่ทั้งชิ้น
                    commitPoints(stagePolygon ?? []);
                  }}
                >
                  <Theater className="size-4" aria-hidden />
                  วาดกรอบเวที
                </Button>
              </div>
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

            {/* ซูมแล้วต้องเลื่อนดูได้ ไม่งั้นขยายไปก็เห็นแค่มุมซ้ายบน */}
            <div
              className={`relative overflow-auto rounded-xl border bg-ink-950 transition-colors ${
                isDraggingImage
                  ? "border-brand-300 ring-2 ring-brand-400/30"
                  : "border-fg/10"
              }`}
              onDragEnter={handleImageDragEnter}
              onDragOver={handleImageDragOver}
              onDragLeave={handleImageDragLeave}
              onDrop={handleImageDrop}
            >
              <div className="relative" style={{ width: `${zoom * 100}%` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={layout.base64} alt="ผังสถานที่จัดงาน" className="block w-full" />
                <svg
                  viewBox={`0 0 ${viewW} ${viewH}`}
                  className="absolute inset-0 h-full w-full cursor-crosshair"
                  onClick={handleCanvasClick}
                  role="presentation"
                >
                  {/* เวทีที่บันทึกไว้ */}
                  {stagePolygon && stageLabelPoint && stagePolygon.length >= 3 && mode !== "stage" && (
                    <g data-stage="true" className="pointer-events-none">
                      <polygon
                        points={stagePolygon.map(([x, y]) => `${x * viewW},${y * viewH}`).join(" ")}
                        fill={`${STAGE_COLOR}cc`}
                        stroke="#fafafa"
                        strokeWidth={viewW / 400 / zoom}
                      />
                      <text
                        x={stageLabelPoint[0] * viewW}
                        y={stageLabelPoint[1] * viewH}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={labelSize}
                        fill="#18181b"
                        className="pointer-events-none select-none font-display font-semibold"
                      >
                        เวที
                      </text>
                    </g>
                  )}

                  {/* โซนที่บันทึกแล้ว — วาดเป็นแผ่นสีระดับโซน ไม่มีจุดที่นั่งรายตัวอีกแล้ว */}
                  {zones.map((zone) => {
                    if (!zone.polygon || zone.polygon.length < 3) return null;
                    const labelPoint = polygonPoleOfInaccessibility(zone.polygon);
                    return (
                      <g
                        key={zone.id}
                        opacity={editingZoneId === zone.id ? 0.25 : 1}
                        className="pointer-events-none"
                      >
                        <polygon
                          points={zone.polygon.map(([x, y]) => `${x * viewW},${y * viewH}`).join(" ")}
                          fill={`${zone.color}59`}
                          stroke={zone.color}
                          strokeWidth={viewW / 400 / zoom}
                        />
                        <text
                          x={labelPoint[0] * viewW}
                          y={labelPoint[1] * viewH}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={labelSize}
                          fill="#ffffff"
                          className="pointer-events-none select-none font-display font-semibold"
                          // ขอบดำจาง ๆ รอบตัวอักษร กันชื่อโซนกลืนกับสีพื้นที่ตั้งให้ตรงกับรูป
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

                  {/* กรอบที่กำลังวาดอยู่ — เส้นและหมุดหารด้วยระดับซูม ให้คงขนาดเท่าเดิมบนจอ
                      (จุดประสงค์ของการซูมคือวางมุมให้ละเอียดขึ้น หมุดโตตามซูมจะบังตำแหน่งที่จะกด) */}
                  {points.length >= 2 && (
                    <polygon
                      points={points.map(([x, y]) => `${x * viewW},${y * viewH}`).join(" ")}
                      fill={`${drawColor}33`}
                      stroke={drawColor}
                      strokeWidth={viewW / 300 / zoom}
                      strokeDasharray={`${viewW / 100 / zoom} ${viewW / 160 / zoom}`}
                      className={points.length >= 3 ? "cursor-move touch-none" : undefined}
                      onPointerDown={(event) => {
                        if (points.length >= 3) startPolygonDrag(event, "polygon");
                      }}
                      onPointerMove={handlePolygonPointerMove}
                      onPointerUp={finishPolygonDrag}
                      onPointerCancel={finishPolygonDrag}
                      onClick={(event) => event.stopPropagation()}
                    />
                  )}
                  {/* จุดกึ่งกลางด้านเป็นทางลัดสำหรับไล่ขอบโค้ง โดยไม่ต้องลบแล้ววาดใหม่ทั้งกรอบ */}
                  {points.length >= 3 &&
                    points.map(([x, y], i) => {
                      const [nextX, nextY] = points[(i + 1) % points.length];
                      return (
                        <circle
                          key={`midpoint-${i}`}
                          cx={((x + nextX) / 2) * viewW}
                          cy={((y + nextY) / 2) * viewH}
                          r={viewW / 300 / zoom}
                          fill="var(--color-ink-950)"
                          stroke={drawColor}
                          strokeWidth={viewW / 800 / zoom}
                          className="cursor-copy touch-none"
                          aria-label={`แทรกจุดระหว่างจุดที่ ${i + 1} กับ ${((i + 1) % points.length) + 1}`}
                          role="button"
                          tabIndex={0}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            insertMidpoint(i);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            insertMidpoint(i);
                          }}
                        />
                      );
                    })}
                  {points.map(([x, y], i) => (
                    <circle
                      key={i}
                      cx={x * viewW}
                      cy={y * viewH}
                      r={viewW / 180 / zoom}
                      fill={drawColor}
                      stroke="#fff"
                      strokeWidth={viewW / 700 / zoom}
                      className="cursor-grab touch-none focus:outline-none focus:stroke-warning"
                      role="button"
                      tabIndex={0}
                      aria-label={`จุดที่ ${i + 1} ของกรอบ ใช้ปุ่มลูกศรเพื่อขยับ กด Delete เพื่อลบ`}
                      onPointerDown={(event) => startPolygonDrag(event, "point", i)}
                      onPointerMove={handlePolygonPointerMove}
                      onPointerUp={finishPolygonDrag}
                      onPointerCancel={finishPolygonDrag}
                      onClick={(event) => handlePointClick(event, i)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        removePoint(i);
                      }}
                      onKeyDown={(event) => handlePointKeyDown(event, i)}
                    />
                  ))}
                </svg>
                {mode === "zone" && editingZone && (
                  // Button ฮาร์ดโค้ด relative ไว้ จึงต้องใช้ div ครอบเพื่อจัดตำแหน่ง absolute
                  <div className="absolute right-3 top-3 z-10">
                    <Button
                      type="button"
                      size="sm"
                      className="shadow-lg"
                      loading={working}
                      disabled={working || points.length < 3}
                      title={points.length < 3 ? "วาดกรอบบนรูปอย่างน้อย 3 จุดก่อน" : undefined}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleAssignFrame(editingZone);
                      }}
                    >
                      <Frame className="size-3.5" aria-hidden />
                      ตั้งกรอบให้โซนนี้
                    </Button>
                  </div>
                )}
              </div>
              {isDraggingImage && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-ink-950/75">
                  <span className="rounded-lg border border-brand-300/60 bg-ink-850 px-4 py-2 font-display text-sm font-semibold text-brand-200">
                    วางรูปที่นี่
                  </span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div
            className={`flex flex-col items-center gap-3 rounded-xl border border-dashed bg-ink-900/60 p-10 text-center transition-colors ${
              isDraggingImage
                ? "border-brand-300 bg-brand-500/10 ring-2 ring-brand-400/30"
                : "border-fg/15"
            }`}
            onDragEnter={handleImageDragEnter}
            onDragOver={handleImageDragOver}
            onDragLeave={handleImageDragLeave}
            onDrop={handleImageDrop}
          >
            <ImageUp className="size-8 text-fg-faint" aria-hidden />
            <p className="text-sm text-fg-faint">
              {isDraggingImage
                ? "วางรูปที่นี่"
                : "ยังไม่มีรูปผังสถานที่ — อัปโหลดรูปก่อนถึงจะวาดกรอบได้"}
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
                onClick={() => commitPoints(pointsRef.current.slice(0, -1))}
              >
                <Undo2 className="size-4" aria-hidden />
                ถอย 1 จุด
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={working || points.length === 0}
                onClick={() => commitPoints([])}
              >
                ล้างกรอบ
              </Button>
              <span className="inline-flex items-center gap-1.5 text-xs text-fg-faint">
                <MousePointerClick className="size-3.5" aria-hidden />
                คลิกวางมุม{mode === "stage" ? "กรอบเวที" : "กรอบโซน"} ({points.length} จุด)
              </span>
              {points.length >= 3 && (
                <span className="text-xs text-fg-faint">
                  ลากจุดหรือลากในกรอบเพื่อขยับ · Alt+คลิก/คลิกขวาที่จุดเพื่อลบ ·
                  คลิกจุดกึ่งกลางด้านเพื่อแทรก
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* ---------- แผงควบคุม ---------- */}
      <div className="space-y-4">
        {/* ---- นำเข้าข้อมูลโซนจาก Excel ---- */}
        <div className="rounded-xl border border-fg/10 bg-ink-850 p-4">
          <h3 className="mb-1 font-display text-sm font-semibold text-fg">ข้อมูลโซนจาก Excel</h3>
          <p className="mb-3 text-xs leading-relaxed text-fg-faint">
            ไฟล์เดียวได้ทุกโซน (ชื่อโซน · เรทราคา · ราคา · สี · จำนวนที่นั่ง) แล้วค่อยมาวาดกรอบทีละโซน
          </p>
          <input
            ref={sheetRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleImportSheet}
            className="hidden"
            id="zone-sheet-upload"
          />
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={working}
              onClick={() => sheetRef.current?.click()}
            >
              <FileSpreadsheet className="size-4" aria-hidden />
              นำเข้าไฟล์ Excel
            </Button>
            {/* ใช้ <a> ตรง ๆ ไม่ใช่ <Button> เพราะการดาวน์โหลดต้องให้เบราว์เซอร์จัดการเอง
                (Button ของระบบไม่มี asChild) — จัด class ให้หน้าตาเท่ากับ ghost/sm */}
            <a
              href="/api/admin/seatmap/template"
              download
              className="inline-flex h-9 select-none items-center gap-1.5 rounded-md bg-transparent px-3.5 font-display text-sm font-medium text-fg-dim transition-colors hover:bg-fg/10 hover:text-fg"
            >
              <Download className="size-4" aria-hidden />
              ไฟล์ตัวอย่าง
            </a>
          </div>
        </div>

        {/* ---- เวที ---- */}
        <div className="rounded-xl border border-fg/10 bg-ink-850 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Theater className="size-4 text-fg-faint" aria-hidden />
            <h3 className="font-display text-sm font-semibold text-fg">เวที</h3>
            {stagePolygon ? (
              <Badge tone="success">ระบุแล้ว</Badge>
            ) : (
              <Badge tone="warning">ยังไม่ระบุ</Badge>
            )}
          </div>
          <p className="mb-3 text-xs leading-relaxed text-fg-faint">
            ระบุเวทีแล้วระบบจะปักป้ายเวทีบนผัง และเรียงโซนให้คนซื้อจาก &ldquo;ใกล้เวทีที่สุด&rdquo;
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              disabled={working || mode !== "stage" || points.length < 3}
              title={mode !== "stage" ? "กดปุ่ม “วาดกรอบเวที” เหนือผังก่อน" : undefined}
              onClick={() => handleSaveStage(points)}
            >
              บันทึกกรอบเวที
            </Button>
            {stagePolygon && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={working}
                onClick={() => handleSaveStage(null)}
              >
                <Trash2 className="size-3.5" aria-hidden />
                ลบเวที
              </Button>
            )}
          </div>
        </div>

        {/* ---- ฟอร์มโซน ---- */}
        <div className="rounded-xl border border-fg/10 bg-ink-850 p-4">
          <h3 className="mb-3 font-display text-sm font-semibold text-fg">
            {editingZoneId ? "แก้ไขโซน" : "โซนใหม่ (กรอกมือ)"}
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
            <div>
              <Label htmlFor="zone-tier">เรทราคา</Label>
              <Input
                id="zone-tier"
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                placeholder="เรท 1 (เว้นว่างได้)"
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
              disabled={working || mode !== "zone" || points.length < 3 || name.trim() === ""}
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
          <div
            className={`rounded-lg border px-3 py-2 text-sm leading-relaxed ${
              feedback.warning
                ? "border-warning/30 bg-warning/10 text-warning"
                : feedback.ok
                ? "border-success/30 bg-success/10 text-success"
                : "border-danger/30 bg-danger/10 text-danger"
            }`}
            role="status"
          >
            <p>{feedback.text}</p>
            {feedback.details && feedback.details.length > 0 && (
              // จำกัดความสูง — ไฟล์ที่ผิดหลายสิบแถวจะดันแผงยาวจนหาปุ่มอื่นไม่เจอ
              <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-auto pl-4 text-xs">
                {feedback.details.map((detail, i) => (
                  <li key={i}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="rounded-xl border border-fg/10 bg-ink-850 p-4">
          <h3 className="mb-1 font-display text-sm font-semibold text-fg">
            โซนทั้งหมด ({zones.length})
          </h3>
          {zonesWithoutFrame > 0 && (
            <p className="mb-3 text-xs text-warning">
              ยังไม่ได้วาดกรอบ {zonesWithoutFrame} โซน — ผังฝั่งคนซื้อจะยังไม่ใช้รูปนี้จนกว่าจะครบทุกโซน
            </p>
          )}
          {zones.length === 0 ? (
            <p className="text-sm text-fg-faint">ยังไม่มีโซน — นำเข้าจากไฟล์ Excel ได้เลย</p>
          ) : (
            <ul className="space-y-2">
              {zones.map((zone) => (
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
                      {zone.tier && (
                        <span className="shrink-0 text-xs text-fg-faint">{zone.tier}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-fg-faint">{zone.totalSeats} ที่</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {!zone.polygon && <Badge tone="warning">ยังไม่มีกรอบ</Badge>}
                    {zone.soldCount > 0 && <Badge tone="danger">ขายแล้ว {zone.soldCount}</Badge>}
                    {zone.heldCount > 0 && <Badge tone="warning">จองค้าง {zone.heldCount}</Badge>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
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
                      disabled={working || mode !== "zone" || points.length < 3}
                      title={
                        points.length < 3
                          ? "วาดกรอบบนรูปอย่างน้อย 3 จุดก่อน"
                          : "ตั้งกรอบให้โซนนี้ โดยไม่แตะที่นั่งเดิม"
                      }
                      onClick={() => handleAssignFrame(zone)}
                    >
                      <Frame className="size-3.5" aria-hidden />
                      ตั้งกรอบให้โซนนี้
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
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
