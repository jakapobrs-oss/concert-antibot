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
//
// rev 42 hotfix (เทส `scripts/test-rev42-gaps.ts` ของ session เทส): ของเดิมตอนออฟไลน์ fetch ล้ม → .then(tick) → tick ยิง fetch ทันทีอีก
//   = วนไม่มีดีเลย์ 59,153 คำขอใน 3 นาทีจากแท็บเดียว (เริ่มตั้งแต่เหลือภาพ ≤3 ช่วง ≈ นาที 3.5) และกินโควต้า getEntryCodes จนฟื้นไม่ได้
//   กติกาใหม่: **fetch ที่ล้มจะไม่เรียก tick** · ยิงซ้ำได้เมื่อถึง `nextRetryAt` เท่านั้น (ถอยหลังทวีคูณ 10→20→40→…→120 วิ)
//   · timer ตัวเดียว ตื่นที่ min(ขอบช่วงถัดไป, เวลา retry) · เน็ตกลับ (`online`) รีเซ็ต backoff แล้วขอทันที
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { getEntryCodes } from "@/app/actions/tickets";

const LOW_FRAMES = 3; // เหลือภาพน้อยกว่านี้ → ขอชุดใหม่ล่วงหน้า
const RETRY_BASE_MS = 10_000; // ขอไม่สำเร็จครั้งแรก → รอ 10 วิ
const RETRY_MAX_MS = 120_000; // ถอยหลังทวีคูณจนสุดที่ 2 นาที

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
  const alive = useRef(true); // false หลัง unmount — กัน promise chain ตั้ง timer ต่อ (audit rev 42)
  const lastIdx = useRef(0);
  const nextRetryAt = useRef(0); // ห้ามยิง server ก่อนเวลานี้ (0 = ยิงได้)
  const backoff = useRef(RETRY_BASE_MS);
  const batchRef = useRef<Batch | null>(null);
  batchRef.current = batch;

  // ขอชุดภาพ — คืน true เมื่อได้ชุดใหม่ · ล้ม = ตั้งเวลา retry แบบถอยหลัง และ "ไม่" ปลุก tick เอง
  const fetchBatch = useCallback(async (): Promise<boolean> => {
    if (fetching.current || !alive.current) return false;
    fetching.current = true;
    let ok = false;
    try {
      const res = await getEntryCodes({ ticketId });
      if (!alive.current) return false;
      if (res.ok) {
        const next: Batch = { frames: res.frames, windowMs: res.windowMs, firstExpiresAt: Date.now() + res.msLeft };
        batchRef.current = next; // อัปเดต ref ทันที — tick ที่ตามมารันก่อน React commit
        setBatch(next);
        setPos(0);
        setStale(false);
        setError(null);
        ok = true;
      } else {
        if (!batchRef.current) setError(res.error); // ตั๋วไม่รองรับ/ไม่ใช่ของเรา — ไม่มีภาพให้โชว์เลย
        setStale(true);
      }
    } catch {
      setStale(true); // ออฟไลน์/ล้ม — ถ้ามีชุดเดิมอยู่ก็หมุนต่อ แค่ติดป้าย
    } finally {
      fetching.current = false;
    }
    if (ok) {
      backoff.current = RETRY_BASE_MS;
      nextRetryAt.current = 0;
    } else {
      nextRetryAt.current = Date.now() + backoff.current;
      backoff.current = Math.min(backoff.current * 2, RETRY_MAX_MS);
    }
    return ok;
  }, [ticketId]);

  // จังหวะหมุน: ทุกครั้งที่ตื่น คิดตำแหน่งจากเวลา แล้วตั้งนาฬิกาปลุกครั้งเดียวที่ min(ขอบช่วงถัดไป, เวลา retry)
  const tick = useCallback(() => {
    if (!alive.current) return;
    if (timer.current) clearTimeout(timer.current);
    const now = Date.now();
    const b = batchRef.current;
    const canFetch = !fetching.current && now >= nextRetryAt.current;
    // ขอชุดใหม่ — สำเร็จค่อยปลุก tick (ล้มแล้วปล่อยให้ timer ตามเวลา retry เป็นคนปลุก ไม่วนทันที)
    const refill = () => {
      if (canFetch) void fetchBatch().then((got) => got && tick());
    };
    const wakeForRetry = () => Math.max(1_000, nextRetryAt.current - now, fetching.current ? 1_000 : 0);

    if (!b) {
      refill();
      timer.current = setTimeout(tick, wakeForRetry());
      return;
    }

    const idx = frameIndexAt(b, now);
    // นาฬิกาเครื่องถอยหลัง (ตั้งเวลาใหม่/ซิงก์) → ขอชุดใหม่ให้ตรงกับเวลา server แทนที่จะโชว์ภาพเก่า
    if (idx < lastIdx.current) refill();
    lastIdx.current = idx;

    if (idx >= b.frames.length) {
      // ชุดนี้ใช้หมดแล้ว — โชว์ภาพสุดท้ายไว้ก่อน (อาจยังผ่านได้ด้วยกติกา ±1 ช่วง) แล้วขอใหม่ตามจังหวะ retry
      setPos(b.frames.length - 1);
      setStale(true);
      refill();
      timer.current = setTimeout(tick, wakeForRetry());
      return;
    }

    setPos(idx);
    const low = b.frames.length - idx <= LOW_FRAMES;
    if (low) refill(); // เติมล่วงหน้าเงียบ ๆ (ถ้ายังอยู่ในช่วง backoff จะไม่ยิง)
    const nextBoundary = b.firstExpiresAt + idx * b.windowMs;
    let wait = nextBoundary - now + 200; // +200ms ข้ามรอยต่อ
    if (low && nextRetryAt.current > now) wait = Math.min(wait, nextRetryAt.current - now); // ตื่นมาลอง retry ด้วย
    timer.current = setTimeout(tick, Math.max(250, wait));
  }, [fetchBatch]);

  useEffect(() => {
    alive.current = true;
    lastIdx.current = 0;
    nextRetryAt.current = 0;
    backoff.current = RETRY_BASE_MS;
    tick();
    // กลับมาที่หน้า → คิดตำแหน่งใหม่ทันที (เคารพ backoff) · เน็ตกลับมา → ล้าง backoff แล้วขอทันที
    const wake = () => {
      if (document.visibilityState === "visible") tick();
    };
    const online = () => {
      nextRetryAt.current = 0;
      backoff.current = RETRY_BASE_MS;
      tick();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", online);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", online);
    };
  }, [tick]);

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
