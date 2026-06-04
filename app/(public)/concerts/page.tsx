// Concert listing page — แสดงคอนเสิร์ตทั้งหมด
import { prisma } from "@/lib/prisma";
import { ConcertCard } from "@/components/concert-card";
import { SiteHeader } from "@/components/site-header";

export const revalidate = 60;

export default async function ConcertsPage() {
  const concerts = await prisma.concert.findMany({
    where: { status: { in: ["ON_SALE", "SCHEDULED", "SOLD_OUT"] } },
    include: { zones: { select: { price: true } } },
    orderBy: [{ saleStartAt: "asc" }],
  });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">คอนเสิร์ตทั้งหมด</h1>
          <p className="mt-1 text-neutral-500">รอบที่กำลังเปิดขาย กำลังจะมาถึง และที่เต็มแล้ว</p>
        </div>
        {concerts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-white py-16 text-center text-neutral-500">
            ยังไม่มีคอนเสิร์ตในระบบ
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {concerts.map((c) => (
              <ConcertCard key={c.id.toString()} concert={c} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
