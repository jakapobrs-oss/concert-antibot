"use client";

// จุดสแกนเช็คอินหน้างาน (docs/19 Phase 2 · rev 42 ย้ายมา /staff/checkin + เพิ่มกล้อง + ผูกกับงาน)
//   ทาง 1: กล้องมือถือ (components/checkin-camera.tsx) — อ่าน QR แล้วเช็คอินให้ทันที
//   ทาง 2: ช่องข้อความ — ปืนสแกนพิมพ์ + Enter ให้เอง หรือวางข้อความแล้ว Enter
// ทั้งสองทางลงที่ submit(text) → checkInTicket({ qrText, concertId }) ตัวเดียวกัน
// ผลสแกนโชว์ "ชื่อผู้ถือ" ตัวใหญ่ ให้ จนท. เทียบบัตรประชาชน · ตั๋วคนละงาน/นอกเวลา = กล่องเหลืองแยกจากแดง (audit rev 42)
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ScanLine, CheckCircle2, XCircle, UserRound, AlertTriangle, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkInTicket, type CheckInResult } from "@/app/actions/tickets";
import type { GateConcertOption } from "@/components/checkin-concert-picker";

// กล้องใช้ API ของเบราว์เซอร์ล้วน — ไม่ render ฝั่ง server
const CheckinCamera = dynamic(() => import("@/components/checkin-camera").then((m) => m.CheckinCamera), {
  ssr: false,
});

// สั่นบอกผลบนมือถือ (จนท. ไม่ต้องก้มดูจอทุกใบ): ผ่าน = สั้นครั้งเดียว · ไม่ผ่าน = 5 จังหวะ · ผิดงาน/ผิดเวลา = ยาว 3 ครั้ง
function vibrateFor(res: CheckInResult) {
  try {
    if (res.ok) navigator.vibrate?.(80);
    else if (res.kind === "wrong_concert" || res.kind === "too_early" || res.kind === "too_late")
      navigator.vibrate?.([250, 120, 250, 120, 250]);
    else navigator.vibrate?.([60, 60, 60, 60, 60]);
  } catch {
    /* บางเบราว์เซอร์ไม่รองรับ — ข้าม */
  }
}

export function CheckinClient({ concert }: { concert: GateConcertOption | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [scanCount, setScanCount] = useState(0);

  // จุดเดียวที่ยิง checkInTicket — ทั้งกล้องและช่องพิมพ์เรียกตัวนี้
  async function submit(text: string) {
    const qrText = text.trim();
    if (!qrText || busy || !concert) return;
    setBusy(true);
    const res = await checkInTicket({ qrText, concertId: concert.id });
    setResult(res);
    setScanCount((c) => c + 1);
    setValue("");
    setBusy(false);
    vibrateFor(res);
    inputRef.current?.focus(); // พร้อมรับสแกนถัดไปทันที
  }

  if (!concert) {
    return (
      <div className="rounded-xl border border-dashed border-fg/20 bg-ink-850 p-5 text-sm text-fg-dim" role="status">
        เลือกคอนเสิร์ตด้านบนก่อน — ระบบจะรับเฉพาะตั๋วของงานนั้น ตั๋วงานอื่นจะถูกปฏิเสธที่ประตูนี้
      </div>
    );
  }

  const scopeMiss =
    result && !result.ok && (result.kind === "wrong_concert" || result.kind === "too_early" || result.kind === "too_late");

  return (
    <div className="space-y-4">
      {/* แถบบอกงานของประตูนี้ — ตัวใหญ่ให้เห็นตลอดว่ากำลังสแกนงานไหน */}
      <div className="flex items-center gap-2 rounded-lg bg-ink-850 px-4 py-2 text-sm text-fg-dim">
        <Ticket className="size-4 text-brand-400" />
        <span>
          กำลังสแกนงาน <span className="font-display text-base font-semibold text-fg">{concert.title}</span>
          <span className="text-fg-faint"> · {concert.label}</span>
        </span>
      </div>

      <CheckinCamera onScan={submit} paused={busy} />

      {/* ช่องสแกน — autofocus ให้เครื่องยิงบาร์โค้ดพิมพ์เข้าได้เลย */}
      <div className="rounded-xl border border-fg/10 bg-ink-850 p-5">
        <label className="flex items-center gap-1.5 text-sm font-medium text-fg">
          <ScanLine className="size-4 text-brand-400" />
          หรือใช้ปืนสแกน / วางข้อความ QR
        </label>
        <div className="mt-2 flex gap-2">
          <input
            ref={inputRef}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit(value);
            }}
            placeholder="ยิงสแกนเนอร์ที่ช่องนี้ หรือวางข้อความ QR แล้วกด Enter"
            className="min-w-0 flex-1 rounded-lg border border-fg/15 bg-ink-950 px-3 py-2 font-mono text-sm text-fg placeholder:font-sans placeholder:text-fg-faint focus:border-brand-400 focus:outline-none"
          />
          <Button onClick={() => submit(value)} loading={busy} disabled={busy || !value.trim()}>
            เช็คอิน
          </Button>
        </div>
        <p className="mt-2 text-xs text-fg-faint">
          QR หมุนทุก ~30 วินาที — ถ้าแจ้งรหัสหมดอายุ ให้ผู้ถือรีเฟรชหน้าตั๋วแล้วสแกนใหม่
        </p>
      </div>

      {/* ผลสแกนล่าสุด */}
      {result &&
        (result.ok ? (
          <div
            key={scanCount}
            role="status"
            className="animate-fade-in-up rounded-xl border border-success/30 bg-success/10 p-5"
          >
            <p className="flex items-center gap-2 font-display text-lg font-bold text-success">
              <CheckCircle2 className="size-6" /> เช็คอินสำเร็จ — ให้เข้างานได้
            </p>
            <div className="mt-3 rounded-lg bg-ink-950/60 p-4">
              <p className="text-xs text-fg-faint">ตรวจชื่อกับบัตรประชาชน</p>
              <p className="mt-1 flex items-center gap-2 font-display text-2xl font-bold text-fg">
                <UserRound className="size-6 text-brand-300" /> {result.holderName}
              </p>
              <p className="mt-2 font-display text-base font-semibold text-fg">{result.concertTitle}</p>
              <p className="text-sm text-fg-dim">{result.seat}</p>
            </div>
          </div>
        ) : scopeMiss ? (
          <div
            key={scanCount}
            role="alert"
            className="animate-fade-in-up rounded-xl border border-warning/40 bg-warning/10 p-5"
          >
            <p className="flex items-center gap-2 font-display text-lg font-bold text-warning">
              <AlertTriangle className="size-6" />{" "}
              {result.kind === "wrong_concert" ? "ตั๋วคนละงาน — ไม่ให้เข้า" : "ไม่ให้เข้า — นอกเวลาสแกนของงานนี้"}
            </p>
            <p className="mt-2 text-base text-fg">{result.error}</p>
            <p className="mt-1 text-xs text-fg-faint">ตั๋วใบนี้ยังไม่ถูกใช้ — ถ้าผู้ถือมาผิดประตู ให้ไปสแกนที่งานของตั๋ว</p>
          </div>
        ) : (
          <div
            key={scanCount}
            role="alert"
            className="animate-fade-in-up rounded-xl border border-danger/30 bg-danger/10 p-5"
          >
            <p className="flex items-center gap-2 font-display text-lg font-bold text-danger">
              <XCircle className="size-6" /> ไม่ให้เข้า
            </p>
            <p className="mt-2 text-sm text-fg-dim">{result.error}</p>
          </div>
        ))}
    </div>
  );
}
