"use client";

// Dynamic QR เข้างาน (docs/19 Phase 3) — หมุนทุก ~30 วิ กันแชร์ภาพหน้าจอ
// client รู้แค่ "ภาพ QR ของรอบปัจจุบัน" — secret อยู่ฝั่ง server เท่านั้น
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getEntryCode } from "@/app/actions/tickets";

export function TicketEntryQr({ ticketId, alt }: { ticketId: string; alt: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      const res = await getEntryCode({ ticketId });
      if (!alive) return;
      if (res.ok) {
        setQr(res.qrDataUrl);
        setError(null);
        // ต่อรอบถัดไปตามเวลาที่เหลือของ window (+เผื่อ 300ms ให้ข้ามรอยต่อ)
        timer.current = setTimeout(refresh, Math.max(1_000, res.msLeft + 300));
      } else {
        setError(res.error);
        timer.current = setTimeout(refresh, 10_000); // พลาดแล้วลองใหม่ห่างๆ
      }
    }
    refresh();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [ticketId]);

  if (error) {
    return (
      <div className="grid size-28 place-items-center rounded-md bg-white p-1 text-center text-[10px] leading-tight text-red-600">
        {error}
      </div>
    );
  }
  if (!qr) {
    return (
      <div className="grid size-28 animate-pulse place-items-center rounded-md bg-white">
        <RefreshCw className="size-5 animate-spin text-gray-300" />
      </div>
    );
  }
  return (
    <div className="text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt={alt} className="size-28" />
      <p className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-gray-500">
        <RefreshCw className="size-2.5" /> QR หมุนอัตโนมัติ
      </p>
    </div>
  );
}
