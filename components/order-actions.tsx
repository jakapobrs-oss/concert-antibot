"use client";

// ปุ่มในหน้า "คำสั่งซื้อของฉัน" (Phase 2.4, docs/24)
//   - จ่ายเงินต่อ: กลับเข้าหน้า checkout เดิมได้ก่อนหมดเวลา (ที่นั่งยัง HELD อยู่)
//   - ยกเลิก: คืนที่นั่งเข้าระบบทันที ไม่ต้องรอหมดเวลา 5 นาที (คนอื่นได้จองต่อเร็วขึ้น)
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CreditCard, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/countdown";
import { cancelOrder } from "@/app/actions/booking";

export function PendingOrderActions({
  orderId,
  expiresAt,
}: {
  orderId: string;
  expiresAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleCancel() {
    setBusy(true);
    await cancelOrder(orderId);
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-warning">
        <Countdown
          targetAt={expiresAt}
          prefix="เหลือเวลาชำระ"
          onReach={() => router.refresh()}
        />
      </span>
      <Link href={`/checkout/${orderId}`}>
        <Button size="sm" leftIcon={<CreditCard className="size-4" />}>
          จ่ายเงินต่อ
        </Button>
      </Link>
      <button
        type="button"
        disabled={busy}
        onClick={handleCancel}
        className="inline-flex items-center gap-1 rounded-md border border-fg/15 px-2.5 py-1 text-xs
          font-medium text-fg-faint hover:border-danger/40 hover:text-danger disabled:opacity-50"
      >
        <XCircle className="size-3.5" />
        ยกเลิก
      </button>
    </div>
  );
}
