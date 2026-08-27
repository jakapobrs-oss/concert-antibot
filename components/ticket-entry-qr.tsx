"use client";

// Dynamic QR เข้างาน (docs/19 Phase 3) — หมุนทุก ~30 วิ กันแชร์ภาพหน้าจอ
// client รู้แค่ "ภาพ QR" — secret อยู่ฝั่ง server เท่านั้น
//
// rev 42 — ทนเน็ตหาย + ทนจอล็อก:
//   - ขอภาพ QR ล่วงหน้าเป็นชุด (ENTRY_PREFETCH_WINDOWS ช่วง ≈ 5 นาที) แล้วหมุนเองตามเวลา
//     → เน็ตหน้างานหายชั่วคราว QR ยังหมุนต่อได้ ไม่ตายใน 1 นาทีเหมือนเดิม
//   - ตำแหน่งภาพคิดจาก "เวลา" ไม่ใช่นับครั้งที่ timer ยิง → จอล็อก/สลับแอปแล้วกลับมา ได้ภาพที่ถูกทันที
//     (เบราว์เซอร์หน่วง setTimeout ตอนอยู่เบื้องหลัง — ของเดิมค้างภาพเก่าจนโดน "รหัสหมดอายุ")
//   - ขอชุดใหม่เมื่อเหลือน้อย / กลับมาที่หน้า / เน็ตกลับมา · ขอไม่ได้ → โชว์ภาพสุดท้าย + ป้ายเตือน
//   - ใช้นาฬิกาเครื่องแค่วัด "ผ่านไปกี่ ms" จากตอนได้ชุดมา (ไม่ใช่เวลาสัมบูรณ์) — เครื่องเพี้ยนก็ไม่กระทบ
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { getEntryCodes } from "@/app/actions/tickets";

const LOW_FRAMES = 3; // เหลือภาพน้อยกว่านี้ → ขอชุดใหม่ล่วงหน้า
const RETRY_MS = 10_000; // ขอไม่สำเร็จ → ลองใหม่ห่าง ๆ

interface Batch {
  frames: string[]; // data URL ของ QR แต่ละช่วง (index 0 = ช่วงที่ได้มา)
  windowMs: number;
  firstExpiresAt: number; // เวลาเครื่อง (ms) ที่ภาพ index 0 หมดช่วง
}

// ตำแหน่งภาพที่ควรโชว์ ณ เวลา now — คิดจากเวลาล้วน ๆ
function frameIndexAt(batch: Batch, now: number): number {
  if (now < batch.firstExpiresAt) return 0;
  return 1 + Math.floor((now - batch.firstExpiresAt) / batch.windowMs);
}

export function TicketEntryQr({ ticketId, alt }: { ticketId: string; alt: string }) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [pos, setPos] = useState(0);
  const [stale, setStale] = useState(false); // ภาพที่โชว์อาจหมดอายุ (ขอชุดใหม่ไม่ได้)
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetching = useRef(false);
  const alive = useRef(true); // false หลัง unmount — กัน promise chain (fetch→tick) ตั้ง timer ต่อจนกลายเป็น loop ผี (audit rev 42)
  const lastIdx = useRef(0);
  const batchRef = useRef<Batch | null>(null);
  batchRef.current = batch;

  const fetchBatch = useCallback(async () => {
    if (fetching.current || !alive.current) return;
    fetching.current = true;
    try {
      const res = await getEntryCodes({ ticketId });
      if (!alive.current) return;
      if (res.ok) {
        const next: Batch = { frames: res.frames, windowMs: res.windowMs, firstExpiresAt: Date.now() + res.msLeft };
        // อัปเดต ref ทันที — tick() ที่ต่อท้าย fetch จะรันก่อน React commit state ใหม่
        //   ถ้ารอ ref จาก render จะเห็น batch เก่า/null แล้วหลงไปตั้งรอบ retry + ยิง server ซ้ำ (เจอใน test:staff-checkin 5d)
        batchRef.current = next;
        setBatch(next);
        setPos(0);
        setStale(false);
        setError(null);
      } else {
        // ตั๋วไม่รองรับ/ไม่ใช่ของเรา — ไม่มีภาพให้โชว์เลย
        if (!batchRef.current) setError(res.error);
        setStale(true);
      }
    } catch {
      // ออฟไลน์/ล้ม — ถ้ามีชุดเดิมอยู่ก็หมุนต่อ แค่ติดป้าย
      setStale(true);
    } finally {
      fetching.current = false;
    }
  }, [ticketId]);

  // จังหวะหมุน: ทุกครั้งที่ตื่น คิดตำแหน่งจากเวลา แล้วตั้งนาฬิกาปลุกที่ขอบช่วงถัดไป
  const tick = useCallback(() => {
    if (!alive.current) return;
    const b = batchRef.current;
    if (timer.current) clearTimeout(timer.current);
    if (!b) {
      timer.current = setTimeout(() => void fetchBatch().then(tick), RETRY_MS);
      return;
    }
    const now = Date.now();
    const idx = frameIndexAt(b, now);
    // นาฬิกาเครื่องถอยหลัง (ตั้งเวลาใหม่/ซิงก์) → ตำแหน่งที่คิดได้ย้อนกลับ — ขอชุดใหม่ให้ตรงกับเวลา server แทนที่จะโชว์ภาพเก่า
    if (idx < lastIdx.current) {
      lastIdx.current = idx;
      void fetchBatch().then(tick);
      return;
    }
    lastIdx.current = idx;
    if (idx >= b.frames.length) {
      // ชุดนี้ใช้หมดแล้ว — โชว์ภาพสุดท้ายไว้ก่อน (อาจยังผ่านได้ด้วยกติกา ±1 ช่วง) แล้วขอชุดใหม่
      setPos(b.frames.length - 1);
      setStale(true);
      timer.current = setTimeout(() => void fetchBatch().then(tick), RETRY_MS);
      void fetchBatch().then(tick);
      return;
    }
    setPos(idx);
    if (b.frames.length - idx <= LOW_FRAMES) void fetchBatch().then(tick); // เติมล่วงหน้าเงียบ ๆ
    const nextBoundary = b.firstExpiresAt + idx * b.windowMs;
    timer.current = setTimeout(tick, Math.max(250, nextBoundary - now + 200)); // +200ms ข้ามรอยต่อ
  }, [fetchBatch]);

  useEffect(() => {
    alive.current = true;
    lastIdx.current = 0;
    void fetchBatch().then(tick);
    // กลับมาที่หน้า / เน็ตกลับมา → คิดตำแหน่งใหม่ทันที (และเติมชุดถ้าจำเป็น)
    const wake = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [fetchBatch, tick]);

  if (error && !batch) {
    return (
      <div className="grid size-28 place-items-center rounded-md bg-white p-1 text-center text-[10px] leading-tight text-red-600">
        {error}
      </div>
    );
  }
  if (!batch) {
    return (
      <div className="grid size-28 animate-pulse place-items-center rounded-md bg-white">
        <RefreshCw className="size-5 animate-spin text-gray-300" />
      </div>
    );
  }
  const src = batch.frames[Math.min(pos, batch.frames.length - 1)];
  return (
    <div className="text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="size-28" />
      {stale ? (
        <p className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-amber-600">
          <WifiOff className="size-2.5" /> ออฟไลน์ — QR อาจหมดอายุ
        </p>
      ) : (
        <p className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-gray-500">
          <RefreshCw className="size-2.5" /> QR หมุนอัตโนมัติ
        </p>
      )}
    </div>
  );
}
