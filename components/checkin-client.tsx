"use client";

// จุดสแกนเช็คอินหน้างาน (docs/19 Phase 2) — ช่องรับข้อความ QR (เครื่องสแกนพิมพ์ + Enter ให้เอง)
// ผลสแกนโชว์ "ชื่อผู้ถือ" ตัวใหญ่ ให้ จนท. เทียบบัตรประชาชนทันที
import { useRef, useState } from "react";
import { ScanLine, CheckCircle2, XCircle, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkInTicket, type CheckInResult } from "@/app/actions/tickets";

export function CheckinClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [scanCount, setScanCount] = useState(0);

  async function handleScan() {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    const res = await checkInTicket({ qrText: text });
    setResult(res);
    setScanCount((c) => c + 1);
    setValue("");
    setBusy(false);
    inputRef.current?.focus(); // พร้อมรับสแกนถัดไปทันที
  }

  return (
    <div className="space-y-4">
      {/* ช่องสแกน — autofocus ให้เครื่องยิงบาร์โค้ดพิมพ์เข้าได้เลย */}
      <div className="rounded-xl border border-fg/10 bg-ink-850 p-5">
        <label className="flex items-center gap-1.5 text-sm font-medium text-fg">
          <ScanLine className="size-4 text-brand-400" />
          สแกน QR จากหน้า &quot;ตั๋วของฉัน&quot; ของผู้ถือ
        </label>
        <div className="mt-2 flex gap-2">
          <input
            ref={inputRef}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleScan();
            }}
            placeholder="ยิงสแกนเนอร์ที่ช่องนี้ หรือวางข้อความ QR แล้วกด Enter"
            className="min-w-0 flex-1 rounded-lg border border-fg/15 bg-ink-950 px-3 py-2 font-mono text-sm text-fg placeholder:font-sans placeholder:text-fg-faint focus:border-brand-400 focus:outline-none"
          />
          <Button onClick={handleScan} loading={busy} disabled={busy || !value.trim()}>
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
              <p className="mt-2 text-sm text-fg-dim">
                {result.concertTitle} · โซน {result.zoneName} · ที่นั่ง {result.seat}
              </p>
            </div>
          </div>
        ) : (
          <div
            key={scanCount}
            className="animate-fade-in-up rounded-xl border border-danger/30 bg-danger/10 p-5"
          >
            <p className="flex items-center gap-2 font-display text-lg font-bold text-danger">
              <XCircle className="size-6" /> ไม่ให้เข้า
            </p>
            <p className="mt-2 text-sm text-danger">{result.error}</p>
          </div>
        ))}
    </div>
  );
}
