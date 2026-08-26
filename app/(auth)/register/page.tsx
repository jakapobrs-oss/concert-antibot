// Register page — Email/Password + auto send verification token
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { AuthTabs } from "@/components/auth-tabs";
import { RegisterForm } from "@/components/register-form";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { isEmailEnabled, isProduction } from "@/lib/env";
import { isEmailSignupOpen, EMAIL_SIGNUP_CLOSED_MESSAGE } from "@/lib/email-signup-gate";

export default function RegisterPage() {
  // production ที่ยังไม่ตั้งอีเมล → ไม่โชว์ฟอร์ม (server action ปฏิเสธอยู่แล้ว แต่ไม่ควรให้กรอกจนจบแล้วค่อยรู้)
  const emailSignupOpen = isEmailSignupOpen({ isProduction, isEmailEnabled });

  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">สร้างบัญชีใหม่</h1>
        <p className="mt-1 text-sm text-fg-faint">สมัครฟรี เพื่อเข้าคิวและจองบัตรคอนเสิร์ต</p>
      </div>

      <AuthTabs active="register" />

      {emailSignupOpen ? (
        <RegisterForm />
      ) : (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-fg/15 bg-fg/5 p-3 text-sm text-fg-dim"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{EMAIL_SIGNUP_CLOSED_MESSAGE}</span>
        </div>
      )}

      <GoogleSignInButton label="สมัครด้วย Google" />

      <p className="mt-6 text-center text-sm text-fg-dim">
        มีบัญชีอยู่แล้ว?{" "}
        <Link href="/login" className="font-semibold text-brand-300 hover:underline">
          เข้าสู่ระบบ
        </Link>
      </p>
    </div>
  );
}
