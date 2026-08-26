// โครงรอโหลดหน้ารายละเอียดคอนเสิร์ต — โปสเตอร์ + ชิปข้อมูล + รายการโซน
import { SiteHeader } from "@/components/site-header";

export default function ConcertDetailLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <section className="bg-stage border-b border-fg/10">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="aspect-[3/2] animate-pulse rounded-2xl bg-ink-800" />
          <div className="space-y-4">
            <div className="h-6 w-28 animate-pulse rounded-full bg-ink-800" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-ink-800" />
            <div className="h-10 w-2/3 animate-pulse rounded-lg bg-ink-800" />
            <div className="flex gap-2">
              <div className="h-8 w-32 animate-pulse rounded-full bg-ink-850" />
              <div className="h-8 w-40 animate-pulse rounded-full bg-ink-850" />
            </div>
            <div className="h-12 w-48 animate-pulse rounded-xl bg-brand-900/60" />
          </div>
        </div>
      </section>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12" aria-busy="true" aria-label="กำลังโหลดรายละเอียดคอนเสิร์ต">
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl border border-fg/10 bg-ink-850" />
          ))}
        </div>
      </main>
    </div>
  );
}
