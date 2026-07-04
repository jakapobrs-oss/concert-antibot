"use client";

// ปุ่มปิดงานคืนเงินในหน้า admin/refunds — กดหลัง "โอนเงินคืนแล้วจริง" เท่านั้น
import { useState } from "react";
import { useRouter } from "next/navigation";
import { markPaymentRefunded, markTicketReturnRefunded } from "@/app/actions/tickets";

export function MarkRefundedButton({
  kind,
  id,
}: {
  kind: "payment" | "return";
  id: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    const res =
      kind === "payment"
        ? await markPaymentRefunded({ paymentId: id })
        : await markTicketReturnRefunded({ returnId: id });
    if (res.ok) router.refresh();
    else setBusy(false);
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="shrink-0 rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-medium text-success hover:bg-success/20 disabled:opacity-50"
    >
      {busy ? "กำลังบันทึก…" : "โอนคืนแล้ว ✓"}
    </button>
  );
}
