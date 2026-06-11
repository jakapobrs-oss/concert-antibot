// Register page — Email/Password + auto send verification token
import Link from "next/link";
import { AuthTabs } from "@/components/auth-tabs";
import { RegisterForm } from "@/components/register-form";
import { GoogleSignInButton } from "@/components/google-signin-button";

export default function RegisterPage() {
  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">สร้างบัญชีใหม่</h1>
        <p className="mt-1 text-sm text-fg-faint">สมัครฟรี เพื่อเข้าคิวและจองบัตรคอนเสิร์ต</p>
      </div>

      <AuthTabs active="register" />

      <RegisterForm />

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
