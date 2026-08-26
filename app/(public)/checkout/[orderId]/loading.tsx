// โครงรอโหลดหน้าชำระเงิน — หน้านี้ต้องดึง order + สร้าง QR ก่อนแสดง จึงมีจังหวะว่างที่ผู้ใช้กังวลว่า "ที่นั่งหลุดหรือยัง"
import { SiteHeader } from "@/components/site-header";

export default function CheckoutLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8" aria-busy="true" aria-label="กำลังเตรียมหน้าชำระเงิน">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-ink-800" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-ink-850" />
        <div className="mt-6 space-y-4 rounded-2xl border border-fg/10 bg-ink-850 p-6">
          <div className="h-5 w-32 animate-pulse rounded bg-ink-800" />
          <div className="mx-auto aspect-square w-56 animate-pulse rounded-xl bg-ink-800" />
          <div className="h-10 w-full animate-pulse rounded-lg bg-ink-800" />
          <div className="h-12 w-full animate-pulse rounded-xl bg-brand-900/60" />
        </div>
        <p className="mt-4 text-center text-xs text-fg-faint">กำลังเตรียม QR และตรวจสถานะที่นั่งของคุณ…</p>
      </main>
    </div>
  );
}
