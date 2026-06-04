// Login page — Credentials + Google (ถ้าเปิด)
import Link from "next/link";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthTabs } from "@/components/auth-tabs";
import { GoogleSignInButton } from "@/components/google-signin-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; registered?: string }>;
}) {
  const { callbackUrl, error, registered } = await searchParams;

  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">ยินดีต้อนรับกลับ</h1>
        <p className="mt-1 text-sm text-neutral-500">เข้าสู่ระบบเพื่อจองและดูตั๋วของคุณ</p>
      </div>

      <AuthTabs active="login" />

      {registered && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-success-bg p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>สมัครสมาชิกสำเร็จ — เข้าสู่ระบบได้เลย</span>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-danger-bg p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>เข้าสู่ระบบไม่สำเร็จ — ตรวจสอบอีเมลหรือรหัสผ่านอีกครั้ง</span>
        </div>
      )}

      <form action={loginAction} className="space-y-4">
        <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />
        <div className="space-y-1.5">
          <Label htmlFor="email">อีเมล</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@email.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">รหัสผ่าน</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </div>
        <Button type="submit" size="lg" className="w-full">
          เข้าสู่ระบบ
        </Button>
      </form>

      <GoogleSignInButton />

      <p className="mt-6 text-center text-sm text-neutral-600">
        ยังไม่มีบัญชี?{" "}
        <Link href="/register" className="font-semibold text-brand-600 hover:underline">
          สมัครสมาชิก
        </Link>
      </p>
    </div>
  );
}

// server action สำหรับ login form — redirect callbackUrl เมื่อสำเร็จ,
// กลับมาที่ /login?error=1 เมื่อ credentials ผิด
async function loginAction(formData: FormData) {
  "use server";
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const callbackUrl = (formData.get("callbackUrl") as string) || "/";

  await signIn("credentials", { email, password, redirectTo: callbackUrl });
}
