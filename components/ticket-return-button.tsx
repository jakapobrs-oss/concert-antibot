"use client";

// ปุ่มคืนบัตรเข้าระบบ — สิทธิ์ของ "ผู้ซื้อ" เท่านั้น (เงินคืนราคาหน้าบัตรไปหาผู้ซื้อ)
// เลือกผู้รับไม่ได้ — ที่นั่งกลับเข้า pool ให้คิวปกติ (กัน resale อำพราง ตามกฎเหล็ก docs/19)
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2, AlertCircle } from "lucide-react";
import { returnTicket } from "@/app/actions/tickets";

export function TicketReturnButton({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReturn() {
    setBusy(true);
    setError(null);
    const res = await returnTicket({ ticketId });
    if (res.ok) {
      router.refresh();
    } else {
      setError(res.error);
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="text-right">
      {confirming ? (
        <span className="inline-flex items-center gap-2 text-xs">
          <span className="text-fg-faint">คืนบัตร? ที่นั่งกลับเข้าระบบทันที รับเงินคืนราคาหน้าบัตร</span>
          <button
            onClick={handleReturn}
            disabled={busy}
            className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 font-medium text-danger hover:bg-danger/20 disabled:opacity-50"
          >
            {busy ? "กำลังคืน…" : "ยืนยันคืน"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="rounded-md border border-fg/15 px-2 py-1 text-fg-faint hover:bg-fg/5"
          >
            ยกเลิก
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1 text-xs text-fg-faint underline-offset-2 hover:text-danger hover:underline"
        >
          <Undo2 className="size-3" /> คืนบัตร
        </button>
      )}
      {error && (
        <p className="mt-1 flex items-center justify-end gap-1 text-xs text-danger">
          <AlertCircle className="size-3" /> {error}
        </p>
      )}
    </div>
  );
}
