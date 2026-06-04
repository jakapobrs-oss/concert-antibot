"use client";

// Checkout client (Phase 7) — QR + countdown + upload สลิป → verify
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, CheckCircle2, AlertCircle } from "lucide-react";
import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { submitSlip, cancelOrder } from "@/app/actions/booking";

export function CheckoutClient({
  orderId,
  amount,
  qrDataUrl,
  seatLabels,
  expiresAt,
  concertSlug,
}: {
  orderId: string;
  amount: number;
  qrDataUrl: string;
  seatLabels: string[];
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
      <div className="rounded-lg bg-danger-bg p-4 text-center text-sm text-danger">
        หมดเวลาชำระเงิน — ที่นั่งถูกปล่อยคืนแล้ว
        <Button variant="outline" className="mt-3 w-full" onClick={() => router.push(`/concerts/${concertSlug}`)}>
          กลับไปเลือกใหม่
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* countdown */}
      <div className="text-center">
        <span className="text-sm text-neutral-500">เหลือเวลาชำระเงิน</span>
        <div className="text-3xl font-bold text-brand-600 tabular-nums">
          {mm}:{ss}
        </div>
      </div>

      {/* สรุปที่นั่ง */}
      <Card>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500">ที่นั่ง</span>
            <span className="font-medium text-right">{seatLabels.join(", ")}</span>
          </div>
          <div className="flex justify-between border-t border-neutral-100 pt-2">
            <span className="font-semibold">ยอดชำระ</span>
            <span className="font-bold text-brand-600">{formatTHB(amount)}</span>
          </div>
        </CardContent>
      </Card>

      {/* QR PromptPay */}
      <Card>
        <CardContent className="text-center space-y-2">
          <p className="text-sm font-medium">สแกน QR เพื่อโอนเงิน (PromptPay)</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="PromptPay QR" className="mx-auto w-56 h-56" />
          <p className="text-xs text-neutral-500">
            เปิดแอปธนาคาร → สแกน → ยอดจะขึ้น {formatTHB(amount)} อัตโนมัติ
          </p>
        </CardContent>
      </Card>

      {/* upload สลิป */}
      <Card>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium">
            อัปโหลดสลิปการโอน <span className="text-danger">*</span>
          </p>
          <input
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="block w-full text-sm text-neutral-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand-700 file:text-sm hover:file:bg-brand-100"
          />

          {/* สถานะไฟล์ที่แนบ */}
          {slipBase64 ? (
            <p className="flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 className="size-3.5" />
              แนบแล้ว: <span className="font-medium">{slipName}</span>
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-neutral-400">
              <Paperclip className="size-3.5" />
              ต้องแนบสลิปก่อนจึงจะยืนยันได้ — ระบบตรวจยอดและบัญชีปลายทางอัตโนมัติ
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-danger-bg p-2.5 text-sm text-danger">
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
            ยกเลิก
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
