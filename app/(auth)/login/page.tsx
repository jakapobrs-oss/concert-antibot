// Login page — Credentials + Google (ถ้าเปิด)
import Link from "next/link";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { signIn } from "@/lib/auth";
import { isGoogleEnabled } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthTabs } from "@/components/auth-tabs";

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

      {isGoogleEnabled && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-neutral-400">
            <span className="h-px flex-1 bg-neutral-200" />
            หรือ
            <span className="h-px flex-1 bg-neutral-200" />
          </div>
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <Button type="submit" variant="outline" size="lg" className="w-full">
              <GoogleIcon />
              เข้าสู่ระบบด้วย Google
            </Button>
          </form>
        </>
      )}

      <p className="mt-6 text-center text-sm text-neutral-600">
        ยังไม่มีบัญชี?{" "}
        <Link href="/register" className="font-semibold text-brand-600 hover:underline">
          สมัครสมาชิก
        </Link>
      </p>
    </div>
  );
}

// โลโก้ Google สำหรับปุ่ม sign-in
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
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
