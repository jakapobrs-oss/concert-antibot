// Register page — Email/Password + auto send verification token
import Link from "next/link";
import { AuthTabs } from "@/components/auth-tabs";
import { RegisterForm } from "@/components/register-form";

export default function RegisterPage() {
  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">สร้างบัญชีใหม่</h1>
        <p className="mt-1 text-sm text-neutral-500">สมัครฟรี เพื่อเข้าคิวและจองบัตรคอนเสิร์ต</p>
      </div>

      <AuthTabs active="register" />

      <RegisterForm />

      <p className="mt-6 text-center text-sm text-neutral-600">
        มีบัญชีอยู่แล้ว?{" "}
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          เข้าสู่ระบบ
        </Link>
      </p>
    </div>
  );
}
