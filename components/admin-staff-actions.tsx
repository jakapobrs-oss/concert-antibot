"use client";

// แผงควบคุมเจ้าหน้าที่หน้างานในหน้า /admin/staff (rev 42)
//   - GrantStaffForm: แต่งตั้งด้วยอีเมลของบัญชีที่สมัครไว้แล้ว
//   - StaffRowActions: ถอนสิทธิ์รายแถว — ยืนยัน 2 ขั้นในปุ่มเดียว (ไม่ใช้ window.confirm ตามคอนเวนชันโปรเจกต์)
import { useState } from "react";
import { UserPlus, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { grantStaffByEmail, revokeStaffById } from "@/app/actions/admin-staff";

export function GrantStaffForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await grantStaffByEmail({ email });
    // ไม่เรียก router.refresh() — server action revalidatePath("/admin/staff") ให้แล้ว
    //   (refresh ซ้อนทำให้ข้อความผลลัพธ์หาย — บทเรียน user-test 2026-08-26 #35)
    if (res.ok) {
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
          placeholder="อีเมลของเจ้าหน้าที่ (ต้องสมัครบัญชีไว้แล้ว)"
          className="min-w-64 flex-1"
          aria-label="อีเมลเจ้าหน้าที่ที่จะแต่งตั้ง"
        />
        <Button type="submit" loading={busy} disabled={busy} leftIcon={<UserPlus className="size-4" />}>
          แต่งตั้งเป็นเจ้าหน้าที่
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

export function StaffRowActions({ userId, email }: { userId: string; email: string }) {
  const [arming, setArming] = useState(false); // กดครั้งแรก = ขอยืนยัน, ครั้งที่สอง = ถอนจริง
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await revokeStaffById({ userId });
    if (!res.ok) setError(res.error);
    setBusy(false);
    setArming(false);
  }

  if (!arming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setArming(true)}
          leftIcon={<UserMinus className="size-4" />}
          aria-label={`ถอนสิทธิ์เจ้าหน้าที่ของ ${email}`}
        >
          ถอนสิทธิ์
        </Button>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-fg-faint">ถอนสิทธิ์ {email}?</span>
      <Button variant="danger" size="sm" onClick={revoke} loading={busy} disabled={busy}>
        ยืนยันถอน
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setArming(false)} disabled={busy}>
        ยกเลิก
      </Button>
    </div>
  );
}
