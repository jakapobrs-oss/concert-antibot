// หน้า 404 ทั้งเว็บ — ธีมเวทีมืดเดียวกับหน้าอื่น (เดิมเป็นหน้าขาวภาษาอังกฤษของ Next)
// Next เรียกหน้านี้เมื่อ route ไม่มี หรือหน้าไหนเรียก notFound() (เช่น concert/order ที่หา id ไม่เจอ)
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Home } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "ไม่พบหน้าที่ต้องการ" };

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-20 text-center">
        <div className="bg-spotlight pointer-events-none absolute inset-x-0 top-0 h-80" aria-hidden />
        {/* เลข LED ใหญ่แบบป้ายหน้าเวที */}
        <p className="text-led relative font-display text-8xl font-bold tracking-tight text-spot-300 sm:text-9xl">404</p>
        <h1 className="relative mt-4 font-display text-2xl font-bold text-fg sm:text-3xl">ไม่พบหน้าที่คุณต้องการ</h1>
        <p className="relative mt-3 max-w-md text-fg-dim">
          ลิงก์อาจพิมพ์ผิด หมดอายุ หรือคอนเสิร์ต/คำสั่งซื้อนั้นถูกนำออกจากระบบแล้ว
        </p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/concerts">
            <Button size="lg" rightIcon={<ArrowRight className="size-4" />}>
              ดูคอนเสิร์ตทั้งหมด
            </Button>
          </Link>
          <Link href="/">
            <Button size="lg" variant="outline" leftIcon={<Home className="size-4" />}>
              กลับหน้าแรก
            </Button>
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
