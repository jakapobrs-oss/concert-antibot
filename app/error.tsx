"use client";

// Error boundary ของทุกหน้า (ยกเว้น root layout เอง — ดู global-error.tsx)
// Next ส่ง error ที่โยนจาก server component/route มาที่นี่ พร้อม digest ไว้ค้นใน log ของ Vercel
// ต้องเป็น client component → ใช้ SiteHeader (async server) ไม่ได้ จึงวางหัวเว็บแบบย่อเอง
import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, Home, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // log ฝั่งเบราว์เซอร์ให้ทีมดูได้จาก console — ข้อความจริงไม่โชว์ผู้ใช้ (อาจมีรายละเอียดภายใน)
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-fg/10 bg-ink-deep/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4">
          <Link href="/" className="flex items-center gap-2.5 text-fg">
            <span className="grid size-9 place-items-center rounded-lg bg-brand-600">
              <Ticket className="size-5 text-white" strokeWidth={2.2} />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">
              Concert<span className="text-brand-400">.</span>
            </span>
          </Link>
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-20 text-center">
        <div className="bg-spotlight pointer-events-none absolute inset-x-0 top-0 h-80" aria-hidden />
        <p className="text-led relative font-display text-7xl font-bold tracking-tight text-danger sm:text-8xl">500</p>
        <h1 className="relative mt-4 font-display text-2xl font-bold text-fg sm:text-3xl">เกิดข้อผิดพลาดในระบบ</h1>
        <p className="relative mt-3 max-w-md text-fg-dim">
          ไม่ใช่ความผิดของคุณ — ลองใหม่อีกครั้ง ถ้ายังเกิดซ้ำ แจ้งทีมงานผ่านแชตช่วยเหลือพร้อมรหัสอ้างอิงด้านล่าง
          ที่นั่งที่ล็อกไว้และคำสั่งซื้อที่ชำระแล้วไม่หายไปจากข้อผิดพลาดนี้
        </p>
        {error.digest && (
          <p className="relative mt-3 font-mono text-xs text-fg-faint">
            รหัสอ้างอิง: <span className="select-all text-fg-dim">{error.digest}</span>
          </p>
        )}
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" onClick={reset} leftIcon={<RotateCcw className="size-4" />}>
            ลองใหม่
          </Button>
          <Link href="/">
            <Button size="lg" variant="outline" leftIcon={<Home className="size-4" />}>
              กลับหน้าแรก
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
