"use client";

// ฟอร์มตั้งรหัสผ่านใหม่ — token อยู่ใน hidden input (มาจาก ?token= ที่หน้า /reset ตรวจแล้วว่าใช้ได้)
// สำเร็จ = server action redirect ไป /login?reset=1 เอง
import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { resetPasswordAction } from "@/app/actions/password";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-reset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(resetPasswordAction, null);
  const pwError = state?.fieldErrors?.password?.[0];

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state?.error && !pwError && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="password">รหัสผ่านใหม่</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          placeholder="••••••••"
          error={!!pwError}
        />
        {pwError ? (
          <p className="text-xs text-danger">{pwError}</p>
        ) : (
          <p className="text-xs text-fg-faint">อย่างน้อย {PASSWORD_MIN_LENGTH} ตัวอักษร</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">ยืนยันรหัสผ่านใหม่</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          placeholder="••••••••"
        />
      </div>
      <Button type="submit" size="lg" className="w-full" loading={isPending}>
        {isPending ? "กำลังบันทึก…" : "ตั้งรหัสผ่านใหม่"}
      </Button>
    </form>
  );
}
