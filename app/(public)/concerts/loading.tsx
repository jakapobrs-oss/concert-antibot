// โครงรอโหลดหน้ารายการคอนเสิร์ต — แทนจอว่างระหว่าง server ดึงข้อมูล (หัวเว็บโชว์ทันที)
import { SiteHeader } from "@/components/site-header";

export default function ConcertsLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <section className="bg-stage border-b border-fg/10">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <div className="h-10 w-64 animate-pulse rounded-lg bg-ink-800" />
          <div className="mt-3 h-5 w-80 animate-pulse rounded bg-ink-850" />
        </div>
      </section>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12" aria-busy="true" aria-label="กำลังโหลดรายการคอนเสิร์ต">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-fg/10 bg-ink-850">
              <div className="aspect-[4/3] animate-pulse bg-ink-800" />
              <div className="space-y-2.5 p-4">
                <div className="h-5 w-3/4 animate-pulse rounded bg-ink-800" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-ink-800/70" />
                <div className="h-4 w-1/3 animate-pulse rounded bg-ink-800/70" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
