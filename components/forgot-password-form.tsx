"use client";

// ฟอร์มขอลิงก์ตั้งรหัสผ่านใหม่ — สำเร็จแล้วโชว์ข้อความกลาง (ไม่บอกว่ามีบัญชีไหม) แทนฟอร์ม
import { useActionState } from "react";
import { AlertCircle, MailCheck } from "lucide-react";
import { requestPasswordResetAction } from "@/app/actions/password";
import { RESET_REQUESTED_MESSAGE } from "@/lib/password-reset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(requestPasswordResetAction, null);

  if (state?.ok) {
    return (
      <div role="status" className="flex items-start gap-2.5 rounded-lg border border-success/25 bg-success/10 p-3 text-sm text-success">
        <MailCheck className="mt-0.5 size-4 shrink-0" />
        <span>{RESET_REQUESTED_MESSAGE}</span>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="email">อีเมลที่ใช้สมัคร</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@email.com"
          error={!!state?.fieldErrors?.email}
        />
      </div>
      <Button type="submit" size="lg" className="w-full" loading={isPending}>
        {isPending ? "กำลังส่ง…" : "ส่งลิงก์ตั้งรหัสผ่านใหม่"}
      </Button>
    </form>
  );
}
