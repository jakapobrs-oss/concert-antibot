// Login page — Credentials + Google (ถ้าเปิด)
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthTabs } from "@/components/auth-tabs";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { isEmailVerificationRequired } from "@/lib/env";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; registered?: string; reset?: string }>;
}) {
  const { callbackUrl, error, registered, reset } = await searchParams;

  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">ยินดีต้อนรับกลับ</h1>
        <p className="mt-1 text-sm text-fg-faint">เข้าสู่ระบบเพื่อจองและดูตั๋วของคุณ</p>
      </div>

      <AuthTabs active="login" />

      {registered && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-success/25 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          {/* บังคับยืนยันอีเมลก่อนล็อกอิน (credentials-auth.ts F1) — ห้ามบอก "เข้าสู่ระบบได้เลย" เพราะยังเข้าไม่ได้
              ยกเว้น registered=verified = โหมดข้ามยืนยัน (EMAIL_VERIFICATION=skip) ที่ถือว่ายืนยันตั้งแต่สมัคร */}
          {registered === "verified" ? (
            <span>สมัครสมาชิกสำเร็จ — เข้าสู่ระบบได้เลย</span>
          ) : (
            <span>สมัครสมาชิกสำเร็จ — เราส่งลิงก์ยืนยันไปที่อีเมลของคุณแล้ว กรุณายืนยันก่อนเข้าสู่ระบบ</span>
          )}
        </div>
      )}
      {reset && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-success/25 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>ตั้งรหัสผ่านใหม่แล้ว — เข้าสู่ระบบด้วยรหัสใหม่ได้เลย</span>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>
            เข้าสู่ระบบไม่สำเร็จ — ตรวจสอบอีเมลหรือรหัสผ่านอีกครั้ง
            {/* สาเหตุที่พบบ่อยนอกจากรหัสผิด: ยังไม่กดลิงก์ยืนยันอีเมล (เฉพาะโหมดบังคับยืนยัน) — ให้ทางไปขอลิงก์ใหม่ */}
            {isEmailVerificationRequired && (
              <>
                {" "}
                · ยังไม่ได้ยืนยันอีเมล?{" "}
                <Link href="/verify/resend" className="font-semibold underline underline-offset-2">
                  ขอลิงก์ยืนยันใหม่
                </Link>
              </>
            )}
          </span>
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
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">รหัสผ่าน</Label>
            <Link href="/forgot" className="text-xs text-fg-faint underline-offset-2 hover:text-fg hover:underline">
              ลืมรหัสผ่าน?
            </Link>
          </div>
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

      <p className="mt-6 text-center text-sm text-fg-dim">
        ยังไม่มีบัญชี?{" "}
        <Link href="/register" className="font-semibold text-brand-300 hover:underline">
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

  try {
    await signIn("credentials", { email, password, redirectTo: callbackUrl });
  } catch (error) {
    // login สำเร็จ → signIn เรียก redirect() ข้างใน (โยน NEXT_REDIRECT) — ต้องปล่อยผ่านเท่านั้น
    //   unstable_rethrow: โยนต่อเฉพาะ control-flow error ของ Next (redirect/notFound ฯลฯ) แล้ว return สำหรับที่เหลือ
    //   ⚠️ ห้ามกลับไปใช้ `error instanceof AuthError`: บน production bundle ของ Vercel มันเป็น false
    //      (class AuthError ที่ page import เป็นคนละตัวกับ base ของ CredentialsSignin ที่ @auth/core โยน
    //       = class identity ข้าม chunk ไม่ตรง) → CredentialsSignin หลุดเป็น 500 จอดำ (digest 1535448675)
    unstable_rethrow(error);
    // มาถึงบรรทัดนี้ = error อื่นทั้งหมด = login ไม่สำเร็จ (รหัสผิด/ยังไม่ยืนยันอีเมล/บัญชีถูกล็อก/rate-limit/Redis timeout)
    //   → กลับหน้า login พร้อม ?error=1 (โชว์ข้อความปกติ ไม่ใช่ 500)
    redirect(`/login?error=1&callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
}
