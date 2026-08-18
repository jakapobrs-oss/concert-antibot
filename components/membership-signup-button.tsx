"use client";

// ปุ่มรับสิทธิ์สมาชิก — ฟรี ไม่มีการเก็บเงิน (ขอบเขตที่ตกลงไว้ใน Phase 2)
// สิทธิ์ที่ได้มีอย่างเดียวคือ "เข้ารอบกดบัตรก่อน" ไม่ได้ซื้อได้เยอะกว่าคนอื่น
//
// ⚠️ คำที่ใช้ต้องเป็น "สิทธิ์สมาชิก" ไม่ใช่ "สมัครสมาชิก" เพราะปุ่มบนหัวเว็บใช้คำว่า
//    "สมัครสมาชิก" สำหรับการสร้างบัญชีอยู่แล้ว — ใช้คำซ้ำกันคนจะแยกสองอย่างนี้ไม่ออก
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signUpForMembership } from "@/app/actions/membership";

export function MembershipSignupButton({ label = "รับสิทธิ์สมาชิก" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignup() {
    setBusy(true);
    setError(null);
    const result = await signUpForMembership();
    if (result.ok) {
      router.refresh();
      setBusy(false);
    } else {
      setError(result.error);
      setBusy(false);
    }
  }

  return (
    <div>
      <Button onClick={handleSignup} disabled={busy} leftIcon={<Sparkles className="size-4" />}>
        {busy ? "กำลังสมัคร…" : label}
      </Button>
      {error && (
        <p role="alert" className="mt-2 flex items-center gap-1 text-sm text-danger">
          <AlertCircle className="size-3.5" /> {error}
        </p>
      )}
    </div>
  );
}
