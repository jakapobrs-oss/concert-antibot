"use client";

// ตัวเลือก "จุดสแกนนี้เป็นของงานไหน" ในหน้า /staff/checkin (rev 42 audit High)
//   เก็บไว้ใน URL (?concert=<id>) — รีเฟรช/เปิดแท็บใหม่ไม่หลุด และส่งลิงก์ให้ จนท. คนอื่นได้เลย
//   server ตัดสินซ้ำอยู่ดี (checkInTicket ปฏิเสธตั๋วคนละงาน) — ตัวเลือกนี้เป็นแค่ตัวบอกว่า "ประตูนี้ของงานไหน"
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";

export interface GateConcertOption {
  id: string;
  title: string;
  label: string; // "20 ธ.ค. 2569 19:00 · ราชมังคลากีฬาสถาน" — จัดรูปมาจาก server
}

export function CheckinConcertPicker({
  options,
  selectedId,
}: {
  options: GateConcertOption[];
  selectedId: string | null;
}) {
  const router = useRouter();
  return (
    <div className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-4">
      <label htmlFor="gate-concert" className="flex items-center gap-1.5 text-sm font-medium text-fg">
        <MapPin className="size-4 text-brand-400" /> จุดสแกนนี้เป็นของงาน
      </label>
      <select
        id="gate-concert"
        value={selectedId ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          router.replace(id ? `/staff/checkin?concert=${id}` : "/staff/checkin");
        }}
        className="mt-2 h-11 w-full rounded-lg border border-fg/15 bg-ink-950/60 px-3 text-sm text-fg
          outline-none transition-colors hover:border-fg/30 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
      >
        <option value="">— เลือกคอนเสิร์ตก่อนเริ่มสแกน —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.title} · {o.label}
          </option>
        ))}
      </select>
      {options.length === 0 && (
        <p className="mt-2 text-xs text-fg-faint">ไม่มีงานที่อยู่ในช่วงเปิดสแกน — ตรวจสถานะ/วันแสดงของคอนเสิร์ตในหน้าแอดมิน</p>
      )}
    </div>
  );
}
