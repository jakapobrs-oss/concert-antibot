"use client";

// Checkout client (Phase 7) — QR + countdown + upload สลิป → verify (โทนเวทีมืด)
// นาฬิกานับถอยหลังสไตล์ป้าย LED — เหลือน้อยกว่า 1 นาทีเปลี่ยนเป็นสีแดง
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, CheckCircle2, AlertCircle, QrCode } from "lucide-react";
import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { submitSlip, cancelOrder } from "@/app/actions/booking";
import { HolderAssign, type HolderItem } from "@/components/holder-assign";

export function CheckoutClient({
  orderId,
  amount,
  qrDataUrl,
  seatLabels,
  holderItems,
  expiresAt,
  concertSlug,
}: {
  orderId: string;
  amount: number;
  qrDataUrl: string;
  seatLabels: string[];
  holderItems: HolderItem[];
  expiresAt: string;
  concertSlug: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slipBase64, setSlipBase64] = useState<string | null>(null);
  const [slipName, setSlipName] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  );

  // countdown timer
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const urgent = secondsLeft < 60; // นาทีสุดท้าย — เร่งด้วยสีแดง

  // อ่านไฟล์สลิปเป็น base64
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSlipName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // ตัด prefix "data:image/...;base64,"
      setSlipBase64(result.split(",")[1] ?? null);
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    // กันกดทั้งที่ยังไม่แนบสลิป (ฝั่ง server ก็เช็คซ้ำอีกชั้น)
    if (!slipBase64) {
      setError("กรุณาแนบสลิปการโอนเงินก่อนยืนยัน");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await submitSlip({ orderId, slipImageBase64: slipBase64 });
    if (result.ok) {
      router.push(`/account/tickets?order=${orderId}`);
    } else {
      setError(result.error);
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    await cancelOrder(orderId);
    router.push(`/concerts/${concertSlug}`);
  }

  if (secondsLeft <= 0) {
    return (
      <div className="rounded-xl border border-danger/25 bg-danger/10 p-5 text-center text-sm text-danger">
        หมดเวลาชำระเงิน — ที่นั่งถูกปล่อยคืนแล้ว
        <Button
          variant="outline"
          className="mt-4 w-full"
          onClick={() => router.push(`/concerts/${concertSlug}`)}
        >
          กลับไปเลือกใหม่
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* นาฬิกา LED นับถอยหลัง */}
      <div className="relative overflow-hidden rounded-xl border border-fg/10 bg-ink-deep p-5 text-center">
        <div className="bg-grain absolute inset-0" aria-hidden />
        <p className="relative font-display text-sm text-fg-faint">เหลือเวลาชำระเงิน</p>
        <div
          className={`text-led relative mt-1 text-5xl font-bold transition-colors ${
            urgent ? "text-danger" : "text-spot-300"
          }`}
          style={{
            textShadow: urgent
              ? "0 0 26px oklch(0.7 0.19 25 / 0.5)"
              : "0 0 26px oklch(0.8 0.15 78 / 0.4)",
          }}
        >
          {mm}
          <span className="animate-blink">:</span>
          {ss}
        </div>
        {urgent && (
          <p className="relative mt-1.5 text-xs font-medium text-danger">
            รีบหน่อย! ใกล้หมดเวลาแล้ว
          </p>
        )}
      </div>

      {/* สรุปที่นั่ง */}
      <div className="rounded-xl border border-fg/10 bg-ink-850 p-5">
        <div className="flex items-start justify-between gap-3 text-sm">
          <span className="text-fg-faint">ที่นั่ง</span>
          <div className="flex flex-wrap justify-end gap-1.5">
            {seatLabels.map((label) => (
              <span
                key={label}
                className="text-led rounded-md border border-brand-500/25 bg-brand-500/12 px-2 py-0.5 text-xs font-semibold text-brand-300"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-end justify-between border-t border-fg/10 pt-3">
          <span className="font-medium text-fg">ยอดชำระ</span>
          <span className="text-led text-2xl font-bold text-spot-300">{formatTHB(amount)}</span>
        </div>
      </div>

      {/* named ticket: ระบุผู้ถือบัตรต่อที่นั่ง (แก้ได้จนกว่าจะจ่าย — จ่ายแล้วล็อกถาวร) */}
      <HolderAssign orderId={orderId} items={holderItems} />

      {/* QR PromptPay — ตัว QR ต้องอยู่บนพื้นขาวเสมอเพื่อให้แอปธนาคารสแกนได้ */}
      <div className="rounded-xl border border-fg/10 bg-ink-850 p-5 text-center">
        <p className="flex items-center justify-center gap-1.5 font-display text-sm font-medium text-fg">
          <QrCode className="size-4 text-brand-400" />
          สแกน QR เพื่อโอนเงิน (PromptPay)
        </p>
        <div className="mx-auto mt-3 w-fit rounded-xl bg-white p-3 shadow-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="PromptPay QR" className="size-52" />
        </div>
        <p className="mt-3 text-xs text-fg-faint">
          เปิดแอปธนาคาร → สแกน → ยอดจะขึ้น {formatTHB(amount)} อัตโนมัติ
        </p>
      </div>

      {/* upload สลิป — dropzone แตะเพื่อเลือกไฟล์ */}
      <div className="space-y-3 rounded-xl border border-fg/10 bg-ink-850 p-5">
        <p className="text-sm font-medium text-fg">
          อัปโหลดสลิปการโอน <span className="text-danger">*</span>
        </p>

        <label
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center transition-colors ${
            slipBase64
              ? "border-success/40 bg-success/8"
              : "border-fg/20 bg-ink-950/50 hover:border-brand-400/60 hover:bg-ink-950/80"
          }`}
        >
          <input type="file" accept="image/*" onChange={handleFile} className="sr-only" />
          {slipBase64 ? (
            <>
              <CheckCircle2 className="size-7 text-success" />
              <span className="text-sm font-medium text-success">แนบแล้ว: {slipName}</span>
              <span className="text-xs text-fg-faint">แตะอีกครั้งเพื่อเปลี่ยนรูป</span>
            </>
          ) : (
            <>
              <UploadCloud className="size-7 text-fg-faint" />
              <span className="text-sm font-medium text-fg-dim">แตะเพื่อเลือกรูปสลิป</span>
              <span className="text-xs text-fg-faint">
                ระบบตรวจยอดและบัญชีปลายทางกับธนาคารอัตโนมัติ
              </span>
            </>
          )}
        </label>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/10 p-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button
          className="w-full"
          onClick={handleSubmit}
          loading={submitting}
          disabled={submitting || !slipBase64}
        >
          {submitting ? "กำลังตรวจสอบสลิป…" : "ยืนยันการชำระเงิน"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={handleCancel} disabled={submitting}>
          ยกเลิกคำสั่งซื้อ
        </Button>
      </div>
    </div>
  );
}
