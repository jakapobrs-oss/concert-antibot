"use client";

// แผงควบคุมสิทธิ์สมาชิกในหน้า /admin/memberships
//   - GrantMembershipForm: ให้สิทธิ์ด้วยอีเมล (แอดมินมักได้อีเมลมาจากผู้ใช้ ไม่ใช่ id)
//   - MembershipRowActions: ปุ่มต่ออายุ/เพิกถอน/คืนสิทธิ์ ในแต่ละแถว
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  grantMembershipByEmail,
  grantMembershipById,
  revokeMembershipAction,
  setMembershipTier,
} from "@/app/actions/admin-membership";

const DAY_OPTIONS = [
  { value: 30, label: "30 วัน" },
  { value: 90, label: "90 วัน" },
  { value: 365, label: "1 ปี" },
  { value: 0, label: "ไม่มีวันหมดอายุ" },
];

export function GrantMembershipForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [days, setDays] = useState(365);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await grantMembershipByEmail({ email, days });
    if (res.ok) {
      // ไม่เรียก router.refresh() ซ้ำ — server action เรียก revalidatePath("/admin/memberships") อยู่แล้ว
      //   refresh ซ้อนกัน 2 รอบติด ๆ ทำให้ฟอร์มถูก re-render จนข้อความผลลัพธ์หาย/ช่องว่างเปล่า (user-test 2026-08-26 #35)
      setMsg({ ok: true, text: res.message });
      setEmail("");
    } else {
      setMsg({ ok: false, text: res.error });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="อีเมลผู้ใช้"
          className="min-w-56 flex-1"
          aria-label="อีเมลผู้ใช้ที่จะให้สิทธิ์"
        />
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="ระยะเวลาสิทธิ์"
          className="h-11 rounded-lg border border-fg/15 bg-ink-950/60 px-3 text-sm text-fg
            outline-none transition-colors hover:border-fg/30 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        >
          {DAY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Button type="submit" loading={busy} leftIcon={<UserPlus className="size-4" />}>
          ให้สิทธิ์
        </Button>
      </div>
      {msg && (
        <p role="status" className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}

export function MembershipRowActions({
  userId,
  revoked,
  tier,
}: {
  userId: string;
  revoked: boolean;
  tier: "STANDARD" | "PREMIUM";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    if (res.ok) router.refresh();
    else setError(res.error ?? "ทำรายการไม่สำเร็จ");
    setBusy(false);
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => grantMembershipById({ userId, days: 365 }))}
        className="rounded-md border border-brand-500/40 bg-brand-500/10 px-2.5 py-1 text-xs font-medium
          text-brand-300 hover:bg-brand-500/20 disabled:opacity-50"
      >
        {revoked ? "คืนสิทธิ์ 1 ปี" : "ต่อ 1 ปี"}
      </button>
      {/* ระดับสมาชิก — PREMIUM คือสิทธิ์เข้ารอบแฟนคลับ (docs/21) ไม่ใช่ส่วนลด */}
      {!revoked && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(() =>
              setMembershipTier({ userId, tier: tier === "PREMIUM" ? "STANDARD" : "PREMIUM" })
            )
          }
          className="rounded-md border border-spot-400/40 bg-spot-400/10 px-2.5 py-1 text-xs font-medium
            text-spot-300 hover:bg-spot-400/20 disabled:opacity-50"
        >
          {tier === "PREMIUM" ? "ลดเป็นมาตรฐาน" : "ให้พรีเมียม"}
        </button>
      )}
      {!revoked && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => revokeMembershipAction({ userId }))}
          className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1 text-xs font-medium
            text-danger hover:bg-danger/20 disabled:opacity-50"
        >
          เพิกถอน
        </button>
      )}
    </div>
  );
}
