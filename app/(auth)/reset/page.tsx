// ตั้งรหัสผ่านใหม่จากลิงก์ในอีเมล (?token=) — เช็ค token ก่อนโชว์ฟอร์ม (ไม่ consume จนกว่าจะตั้งสำเร็จ)
import type { Metadata } from "next";
import Link from "next/link";
import { XCircle } from "lucide-react";
import { peekResetToken } from "@/app/actions/password";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "ตั้งรหัสผ่านใหม่" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const state = token ? await peekResetToken(token) : { usable: false, reason: "missing" as const };

  if (!state.usable || !token) {
    return (
      <div className="animate-fade-in-up text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-full border border-danger/25 bg-danger/10 text-danger">
          <XCircle className="size-8" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-fg">ลิงก์ใช้ไม่ได้แล้ว</h1>
        <p className="mt-2 text-sm text-fg-faint">
          {state.reason === "expired"
            ? "ลิงก์ตั้งรหัสผ่านหมดอายุ (ใช้ได้ 30 นาที)"
            : "ลิงก์ไม่ถูกต้อง หรือถูกใช้ไปแล้ว"}{" "}
          — ขอลิงก์ใหม่ได้เลย
        </p>
        <Link href="/forgot" className="mt-6 block">
          <Button size="lg" className="w-full">
            ขอลิงก์ใหม่
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">ตั้งรหัสผ่านใหม่</h1>
        <p className="mt-1 text-sm text-fg-faint">ตั้งแล้วบัญชีที่ถูกล็อกจากการเดารหัสจะถูกปลดล็อกด้วย</p>
      </div>
      <ResetPasswordForm token={token} />
    </div>
  );
}
