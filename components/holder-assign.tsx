"use client";

// Named ticket (docs/19) — ระบุ "ผู้ถือบัตร" ต่อที่นั่ง ตอน checkout (ก่อนจ่าย)
// ค่าเริ่มต้น = ผู้ซื้อถือเอง; ใส่อีเมล/เบอร์ของบัญชีเพื่อนเพื่อยกให้เพื่อนถือ
// ⚠️ จ่ายเงินแล้วแก้ไม่ได้ — เป็นหัวใจของมาตรการกัน scalper (commit ผู้ถือตอนซื้อ)
import { useState } from "react";
import { UserRound, CheckCircle2, AlertCircle, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assignHolder, clearHolder } from "@/app/actions/booking";

export interface HolderItem {
  itemId: string;
  seatLabel: string;
  holderName: string | null; // null = ผู้ซื้อถือเอง
}

export function HolderAssign({ orderId, items }: { orderId: string; items: HolderItem[] }) {
  const [rows, setRows] = useState(
    items.map((i) => ({ ...i, contact: "", busy: false, error: null as string | null }))
  );

  function patch(idx: number, p: Partial<(typeof rows)[number]>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...p } : r)));
  }

  async function handleAssign(idx: number) {
    const row = rows[idx];
    if (!row.contact.trim()) {
      patch(idx, { error: "กรอกอีเมลหรือเบอร์โทรของบัญชีผู้ถือ" });
      return;
    }
    patch(idx, { busy: true, error: null });
    const res = await assignHolder({ orderId, itemId: row.itemId, contact: row.contact.trim() });
    if (res.ok) {
      patch(idx, { busy: false, holderName: res.holderName, contact: "" });
    } else {
      patch(idx, { busy: false, error: res.error });
    }
  }

  async function handleClear(idx: number) {
    patch(idx, { busy: true, error: null });
    const res = await clearHolder({ orderId, itemId: rows[idx].itemId });
    patch(idx, { busy: false, holderName: res.ok ? null : rows[idx].holderName });
  }

  return (
    <div className="space-y-3 rounded-xl border border-fg/10 bg-ink-850 p-5">
      <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
        <UserRound className="size-4 text-brand-400" />
        ผู้ถือบัตรแต่ละที่นั่ง
      </p>
      <p className="text-xs text-fg-faint">
        บัตรผูกชื่อผู้ถือถาวรหลังชำระเงิน ใช้เทียบบัตรประชาชนตอนเข้างาน — ไม่ระบุ = คุณถือเอง
        (ผู้ถือคนอื่นต้องมีบัญชีในระบบที่ยืนยันแล้ว)
      </p>

      <div className="space-y-3">
        {rows.map((row, idx) => (
          <div key={row.itemId} className="rounded-lg border border-fg/10 bg-ink-950/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-led rounded-md border border-brand-500/25 bg-brand-500/12 px-2 py-0.5 text-xs font-semibold text-brand-300">
                {row.seatLabel}
              </span>
              {row.holderName ? (
                <span className="flex items-center gap-1 text-xs font-medium text-success">
                  <CheckCircle2 className="size-3.5" /> ผู้ถือ: {row.holderName}
                </span>
              ) : (
                <span className="text-xs text-fg-faint">ผู้ถือ: คุณ (ผู้ซื้อ)</span>
              )}
            </div>

            {row.holderName ? (
              <Button
                variant="ghost"
                className="mt-2 h-8 w-full text-xs"
                onClick={() => handleClear(idx)}
                disabled={row.busy}
                leftIcon={<Undo2 className="size-3.5" />}
              >
                เปลี่ยนกลับเป็นฉันถือเอง
              </Button>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={row.contact}
                  onChange={(e) => patch(idx, { contact: e.target.value, error: null })}
                  placeholder="อีเมล หรือเบอร์โทร บัญชีเพื่อน"
                  className="min-w-0 flex-1 rounded-lg border border-fg/15 bg-ink-950 px-3 py-1.5 text-sm text-fg placeholder:text-fg-faint focus:border-brand-400 focus:outline-none"
                />
                <Button
                  variant="outline"
                  className="h-auto shrink-0 px-3 py-1.5 text-xs"
                  onClick={() => handleAssign(idx)}
                  loading={row.busy}
                  disabled={row.busy}
                >
                  ตั้งเป็นผู้ถือ
                </Button>
              </div>
            )}

            {row.error && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {row.error}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
