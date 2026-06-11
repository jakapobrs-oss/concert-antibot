"use client";

// ฟอร์มสมัครสมาชิก — ใช้ useActionState เพื่อแสดง error/field error โดยไม่ throw
import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { registerAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RegisterForm() {
  const [state, formAction, isPending] = useActionState(registerAction, null);
  const fieldErr = state?.fieldErrors;

  return (
    <form action={formAction} className="space-y-4">
      {/* error รวม (เช่น อีเมลซ้ำ) */}
      {state?.error && !fieldErr && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="name">ชื่อ-นามสกุล</Label>
        <Input id="name" name="name" required error={!!fieldErr?.name} placeholder="สมชาย ใจดี" />
        <FieldError messages={fieldErr?.name} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">อีเมล</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          error={!!fieldErr?.email}
          placeholder="you@email.com"
        />
        <FieldError messages={fieldErr?.email} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">รหัสผ่าน</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          error={!!fieldErr?.password}
          placeholder="••••••••"
        />
        {fieldErr?.password ? (
          <FieldError messages={fieldErr.password} />
        ) : (
          <p className="text-xs text-fg-faint">อย่างน้อย 8 ตัวอักษร</p>
        )}
      </div>

      <Button type="submit" size="lg" className="w-full" loading={isPending}>
        {isPending ? "กำลังสมัคร…" : "สมัครสมาชิก"}
      </Button>
    </form>
  );
}

// ข้อความ error ใต้ช่องกรอก
function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}
