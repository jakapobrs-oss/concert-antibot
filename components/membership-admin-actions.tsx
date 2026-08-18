"use client";

// ปุ่มฝั่งแอดมิน: ให้สิทธิ์ / เพิกถอนสิทธิ์สมาชิก
// เลือกจำนวนวันได้ตอนให้สิทธิ์ — 0 วัน = ไม่มีกำหนดหมดอายุ (ตรงกับที่ lib/membership.ts ตีความ)
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CircleSlash, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { grantMembership, revokeMembership } from "@/app/actions/membership";

// ตัวเลือกอายุสิทธิ์ — ครอบกรณีสาธิต (30 วัน) จนถึงให้ถาวร
const DURATION_OPTIONS = [
  { days: 30, label: "30 วัน" },
  { days: 365, label: "1 ปี" },
  { days: 0, label: "ไม่มีกำหนด" },
] as const;

export function MembershipAdminActions({
  userId,
  isActive,
}: {
  userId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(365);

  async function run(fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    setBusy(true);
    setError(null);
    const result = await fn();
    if (result.ok) router.refresh();
    else setError(result.error);
    setBusy(false);
  }

  return (
    <div className="text-right">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!isActive && (
          <select
            aria-label="อายุสิทธิ์"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            disabled={busy}
            className="rounded-md border border-fg/15 bg-transparent px-2 py-1 text-xs text-fg disabled:opacity-50"
          >
            {DURATION_OPTIONS.map((o) => (
              <option key={o.days} value={o.days} className="bg-ink-900">
                {o.label}
              </option>
            ))}
          </select>
        )}

        {isActive ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            leftIcon={<CircleSlash className="size-3.5" />}
            onClick={() => run(() => revokeMembership({ userId }))}
          >
            เพิกถอนสิทธิ์
          </Button>
        ) : (
          <Button
            size="sm"
            variant="subtle"
            disabled={busy}
            leftIcon={<Sparkles className="size-3.5" />}
            onClick={() => run(() => grantMembership({ userId, durationDays: days }))}
          >
            ให้สิทธิ์
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 flex items-center justify-end gap-1 text-xs text-danger">
          <AlertCircle className="size-3" /> {error}
        </p>
      )}
    </div>
  );
}
