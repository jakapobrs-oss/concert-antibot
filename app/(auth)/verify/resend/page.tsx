// ขอลิงก์ยืนยันอีเมลใหม่ — สำหรับคนที่ลิงก์หมดอายุ/หาย (rev 35; ค้างจาก rev 30)
import type { Metadata } from "next";
import Link from "next/link";
import { ResendVerificationForm } from "@/components/resend-verification-form";
import { isEmailVerificationRequired } from "@/lib/env";

export const metadata: Metadata = { title: "ขอลิงก์ยืนยันอีเมลใหม่" };

export default function ResendVerificationPage() {
  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">ขอลิงก์ยืนยันอีเมลใหม่</h1>
        <p className="mt-1 text-sm text-fg-faint">
          {isEmailVerificationRequired
            ? "ลิงก์ยืนยันใช้ได้ 24 ชั่วโมง — ถ้าหมดอายุหรือหาอีเมลไม่เจอ ขอใหม่ได้ที่นี่"
            : "ระบบนี้ไม่ต้องยืนยันอีเมล — สมัครแล้วเข้าสู่ระบบได้เลย"}
        </p>
      </div>

      {isEmailVerificationRequired ? (
        <ResendVerificationForm />
      ) : (
        <Link href="/login" className="block text-center text-sm font-semibold text-brand-300 hover:underline">
          ไปหน้าเข้าสู่ระบบ
        </Link>
      )}

      <p className="mt-6 text-center text-sm text-fg-dim">
        <Link href="/login" className="font-semibold text-brand-300 hover:underline">
          กลับหน้าเข้าสู่ระบบ
        </Link>
      </p>
    </div>
  );
}
