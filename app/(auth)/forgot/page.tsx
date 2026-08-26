// ลืมรหัสผ่าน — ขอลิงก์ตั้งรหัสใหม่ทางอีเมล (rev 35)
import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export const metadata: Metadata = { title: "ลืมรหัสผ่าน" };

export default function ForgotPasswordPage() {
  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">ลืมรหัสผ่าน</h1>
        <p className="mt-1 text-sm text-fg-faint">
          กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้ (ใช้ได้ 30 นาที)
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="mt-6 text-center text-sm text-fg-dim">
        สมัครด้วย Google? ไม่ต้องใช้รหัสผ่าน —{" "}
        <Link href="/login" className="font-semibold text-brand-300 hover:underline">
          เข้าสู่ระบบด้วย Google
        </Link>
      </p>
    </div>
  );
}
