"use client";

// กล้องสแกน QR เข้างาน (rev 42) — ใช้ในหน้า /staff/checkin คู่กับช่องพิมพ์/ปืนสแกน
// ใช้ไลบรารี qr-scanner (nimiq): ถอดรหัสใน Web Worker, เลือกกล้องหลังให้เอง, ใช้ BarcodeDetector ของเบราว์เซอร์ถ้ามี
//   - โหลดไลบรารีตอนกด "เปิดกล้อง" เท่านั้น (dynamic import) — หน้าอื่นไม่แบกน้ำหนัก
//   - ต้อง https (prod มี) หรือ localhost — ไม่งั้นเบราว์เซอร์ไม่ให้ใช้กล้อง
//   - อ่านได้แล้วส่งข้อความดิบให้ผู้เรียก (CheckinClient) เป็นคนยิง checkInTicket — คอมโพเนนต์นี้ไม่รู้จักตั๋ว
//   - กันยิงซ้ำ: QR ใบเดิมที่ยังค้างหน้ากล้องภายใน 3 วิ ไม่ส่งซ้ำ + ระหว่างผู้เรียกกำลังตรวจ (paused) ไม่ส่ง
import { useEffect, useRef, useState } from "react";
import type QrScanner from "qr-scanner";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";

// กันยิงซ้ำ 2 ชั้น (audit rev 42): QR ของตั๋วใบเดิมค้างหน้ากล้อง — ข้อความหมุนทุก 30 วิ จึง key ด้วย "เลขบัตร" ไม่ใช่ข้อความ
//   ไม่งั้นพอข้ามช่วง ข้อความใหม่ถูกส่งซ้ำ → ใบที่เพิ่งผ่านพลิกเป็นแดง "เช็คอินไปแล้ว" ตรงหน้าคน
const SAME_TICKET_WINDOW_MS = 20_000; // ใบเดิมไม่ส่งซ้ำภายใน 20 วิ (ผู้ถือมีเวลาเอามือถือออกจากกล้อง)
const ANY_SCAN_COOLDOWN_MS = 1_500; // หลังอ่านได้ 1 ใบ พัก 1.5 วิ ก่อนรับใบถัดไป (กันสองใบซ้อนเฟรมเดียว)

// ดึงเลขบัตรจากข้อความ QR ของระบบ (ENT:<เลขบัตร>:<โค้ด>) — ข้อความอื่นใช้ทั้งก้อนเป็น key
function scanKey(text: string): string {
  const m = /^ENT:(\d+):/.exec(text);
  return m ? `ticket:${m[1]}` : `raw:${text}`;
}

type CameraState = "idle" | "starting" | "on" | "error";

interface Props {
  onScan: (text: string) => void | Promise<void>;
  paused?: boolean; // ผู้เรียกกำลังตรวจใบก่อนหน้า — ไม่รับสแกนใหม่ชั่วคราว
}

// แปลง error ของ getUserMedia/qr-scanner เป็นข้อความที่ จนท. ทำตามได้
function describeCameraError(err: unknown): string {
  const name = typeof err === "object" && err && "name" in err ? String((err as { name?: string }).name) : "";
  const text = typeof err === "string" ? err : err instanceof Error ? err.message : "";
  if (name === "NotAllowedError" || /permission|denied/i.test(text)) {
    return "ไม่ได้รับอนุญาตให้ใช้กล้อง — กดอนุญาตกล้องให้เว็บนี้ในเบราว์เซอร์ แล้วกดเปิดกล้องใหม่";
  }
  if (name === "NotFoundError" || /no camera|camera not found/i.test(text)) {
    return "ไม่พบกล้องบนอุปกรณ์นี้ — ใช้ช่องพิมพ์หรือปืนสแกนแทน";
  }
  if (name === "NotReadableError" || /in use|could not start/i.test(text)) {
    return "กล้องถูกแอปอื่นใช้อยู่ — ปิดแอปนั้นแล้วลองใหม่";
  }
  if (/secure|https/i.test(text)) {
    return "เบราว์เซอร์อนุญาตกล้องเฉพาะเว็บ https — เปิดจากลิงก์ https ของระบบ";
  }
  return "เปิดกล้องไม่สำเร็จ — ลองใหม่ หรือใช้ช่องพิมพ์/ปืนสแกนแทน";
}

export function CheckinCamera({ onScan, paused = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const seenRef = useRef<Map<string, number>>(new Map()); // key → เวลาที่ส่งล่าสุด
  const lastAnyRef = useRef(0);
  // อ้าง props ล่าสุดผ่าน ref — callback ของ scanner ถูกสร้างครั้งเดียวตอน start
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [state, setState] = useState<CameraState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seeking, setSeeking] = useState(false); // กล้องเปิดอยู่แต่ยังไม่เจอ QR สักพัก → โชว์คำแนะนำเล็ง
  const lastDecodeAt = useRef(0);
  const libRef = useRef<typeof import("qr-scanner") | null>(null);

  // โหลดไลบรารีล่วงหน้าตั้งแต่เปิดหน้า (~16 KB) — ตอนกด "เปิดกล้อง" จะได้ไม่มี await ยาวคั่นก่อน scanner.start()
  //   (iOS เข้มเรื่อง user gesture: play()/getUserMedia หลัง async boundary ยาว ๆ เสี่ยงถูกปฏิเสธ)
  useEffect(() => {
    let cancelled = false;
    import("qr-scanner").then((m) => {
      if (!cancelled) libRef.current = m;
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function start() {
    if (!videoRef.current || scannerRef.current) return;
    setState("starting");
    setError(null);
    setSeeking(false);
    try {
      // ให้ React วาดกล่อง video ให้เห็นก่อน (ของเดิมซ่อนด้วย display:none ระหว่างเริ่ม — iOS ไม่เล่น video ใต้ display:none)
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const { default: QrScannerLib } = libRef.current ?? (await import("qr-scanner"));
      // ไม่เรียก hasCamera() ก่อน — บน iOS Safari enumerateDevices() ก่อนได้รับอนุญาตอาจไม่คืนกล้อง
      //   ทำให้ตัดจบว่า "ไม่พบกล้อง" โดยไม่เคยขอสิทธิ์เลย → ให้ start() ขอสิทธิ์จริง แล้ว describeCameraError จัดการ NotFoundError
      const scanner = new QrScannerLib(
        videoRef.current,
        (result) => {
          const text = result.data.trim();
          if (!text || pausedRef.current) return;
          const now = Date.now();
          if (now - lastAnyRef.current < ANY_SCAN_COOLDOWN_MS) return;
          const key = scanKey(text);
          const seenAt = seenRef.current.get(key) ?? 0;
          if (now - seenAt < SAME_TICKET_WINDOW_MS) return;
          seenRef.current.set(key, now);
          lastAnyRef.current = now;
          lastDecodeAt.current = now;
          setSeeking(false);
          // ตัดรายการเก่าทิ้ง กัน map โตตลอดคืนงาน
          if (seenRef.current.size > 500) {
            for (const [k, at] of seenRef.current) if (now - at > SAME_TICKET_WINDOW_MS) seenRef.current.delete(k);
          }
          void onScanRef.current(text);
        },
        {
          returnDetailedScanResult: true,
          preferredCamera: "environment", // กล้องหลัง — จ่อจอมือถือของผู้ถือบัตร
          highlightScanRegion: true,
          highlightCodeOutline: true,
          maxScansPerSecond: 6, // ทั้งเฟรม 800px × 6 ครั้ง/วิ — สมดุลระหว่างอ่าน QR เล็กได้กับไม่ให้มือถือร้อน (รีวิว session เทส)
          // สแกนทั้งเฟรม (ค่าเริ่มต้นของไลบรารีคือสี่เหลี่ยมกลางภาพ 2/3 ย่อเหลือ 400px — QR บนจอมือถืออีกเครื่องเล็กมาก
          //   ย่อแล้วโมดูลเหลือไม่ถึง 2px อ่านไม่ออก) ย่อไม่เกิน 800px ด้านยาว
          calculateScanRegion: (video) => {
            const w = video.videoWidth || 1280;
            const h = video.videoHeight || 720;
            const ratio = Math.min(1, 800 / Math.max(w, h));
            return { x: 0, y: 0, width: w, height: h, downScaledWidth: Math.round(w * ratio), downScaledHeight: Math.round(h * ratio) };
          },
          // ยังไม่เจอ QR ต่อเนื่อง ~3 วิ → โชว์คำแนะนำเล็ง (ไลบรารีเรียกทุกเฟรมที่ถอดรหัสไม่ได้)
          onDecodeError: () => {
            const now = Date.now();
            if (now - lastDecodeAt.current > 3_000 && !pausedRef.current) setSeeking(true);
          },
        },
      );
      lastDecodeAt.current = Date.now();
      scannerRef.current = scanner;
      await scanner.start();
      setState("on");
    } catch (err) {
      scannerRef.current?.destroy();
      scannerRef.current = null;
      setState("error");
      setError(describeCameraError(err));
    }
  }

  function stop() {
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
    setState("idle");
  }

  // ปิดกล้องเมื่อออกจากหน้า — ไม่งั้นไฟกล้องค้าง
  useEffect(() => {
    return () => {
      scannerRef.current?.stop();
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, []);

  const showVideo = state === "on" || state === "starting";

  return (
    <div className="rounded-xl border border-fg/10 bg-ink-850 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
          <Camera className="size-4 text-brand-400" /> สแกนด้วยกล้อง
        </p>
        {state === "on" ? (
          <Button variant="ghost" size="sm" onClick={stop} leftIcon={<CameraOff className="size-4" />}>
            ปิดกล้อง
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={start}
            loading={state === "starting"}
            disabled={state === "starting"}
            leftIcon={<Camera className="size-4" />}
          >
            เปิดกล้อง
          </Button>
        )}
      </div>

      {/* video ต้องอยู่ใน DOM ตลอด (scanner ผูกกับ element) — ตอนยังไม่เปิดใช้ความสูง 0 ไม่ใช่ display:none (iOS ไม่เล่น video ใต้ display:none) */}
      <div className={showVideo ? "relative mt-3" : "relative h-0 overflow-hidden"} aria-hidden={!showVideo}>
        {/* object-contain ให้ภาพที่ จนท. เห็น = พื้นที่ที่สแกนจริงทั้งเฟรม (object-cover จะครอปแล้วเล็งเพี้ยน) */}
        <video
          ref={videoRef}
          muted
          playsInline
          className="max-h-[70vh] w-full rounded-lg bg-black object-contain"
          aria-label="ภาพจากกล้องสำหรับสแกน QR"
        />
        <p className="mt-2 text-xs text-fg-faint" aria-live="polite">
          {paused
            ? "กำลังตรวจบัตร…"
            : seeking
              ? "ยังไม่เจอ QR — ให้ผู้ถือเร่งความสว่างจอ แล้วถือห่าง ~15–20 ซม. ให้ QR ชัดเต็มกรอบ"
              : "จ่อกล้องที่ QR บนหน้า \"ตั๋วของฉัน\" ของผู้ถือ — อ่านได้แล้วจะเช็คอินให้ทันที"}
        </p>
      </div>

      {state === "error" && error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      {state === "idle" && (
        <p className="mt-2 text-xs text-fg-faint">ใช้บนมือถือ/แท็บเล็ตที่มีกล้องหลัง — เปิดครั้งแรกเบราว์เซอร์จะขออนุญาตกล้อง</p>
      )}
    </div>
  );
}
