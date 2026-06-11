// Email verification page — รับ ?token= แล้วยืนยัน
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { verifyEmail } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = token ? await verifyEmail(token) : { ok: false, error: "ไม่พบ token ในลิงก์" };

  return (
    <div className="animate-fade-in-up text-center">
      {result.ok ? (
        <>
          <div className="mx-auto grid size-16 place-items-center rounded-full border border-success/25 bg-success/10 text-success">
            <CheckCircle2 className="size-8" />
          </div>
          <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-fg">
            ยืนยันอีเมลสำเร็จ
          </h1>
          <p className="mt-2 text-sm text-fg-faint">บัญชีของคุณพร้อมใช้งานแล้ว</p>
        </>
      ) : (
        <>
          <div className="mx-auto grid size-16 place-items-center rounded-full border border-danger/25 bg-danger/10 text-danger">
            <XCircle className="size-8" />
          </div>
          <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-fg">
            ยืนยันไม่สำเร็จ
          </h1>
          <p className="mt-2 text-sm text-fg-faint">{result.error}</p>
        </>
      )}

      <Link href="/login" className="mt-6 block">
        <Button size="lg" className="w-full">
          ไปหน้าเข้าสู่ระบบ
        </Button>
      </Link>
    </div>
  );
}
