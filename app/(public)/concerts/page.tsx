// Concert listing page — แสดงคอนเสิร์ตทั้งหมด (โทนเวทีมืด)
import { prisma } from "@/lib/prisma";
import { ConcertCard } from "@/components/concert-card";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const revalidate = 60;

export default async function ConcertsPage() {
  const concerts = await prisma.concert.findMany({
    where: { status: { in: ["ON_SALE", "SCHEDULED", "SOLD_OUT"] } },
    include: { zones: { select: { price: true } } },
    orderBy: [{ saleStartAt: "asc" }],
  });

  const onSaleCount = concerts.filter((c) => c.status === "ON_SALE").length;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      {/* แถบหัวเรื่อง — เวทีลึก + แสงสาดจางๆ */}
      <section className="bg-stage relative overflow-hidden border-b border-fg/10">
        <div className="bg-spotlight absolute inset-0 opacity-70" aria-hidden />
        <div className="bg-grain absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <h1 className="animate-fade-in-up font-display text-4xl font-bold tracking-tight text-fg">
            คอนเสิร์ตทั้งหมด
          </h1>
          <p className="animate-fade-in-up mt-2 text-fg-dim" style={{ animationDelay: "90ms" }}>
            {onSaleCount > 0
              ? `กำลังเปิดขาย ${onSaleCount} งาน — รอบอื่นกำลังตามมา`
              : "รอบที่กำลังเปิดขาย กำลังจะมาถึง และที่เต็มแล้ว"}
          </p>
        </div>
      </section>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12">
        {concerts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 py-16 text-center text-fg-faint">
            ยังไม่มีคอนเสิร์ตในระบบ
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {concerts.map((c) => (
              <ConcertCard key={c.id.toString()} concert={c} />
            ))}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
