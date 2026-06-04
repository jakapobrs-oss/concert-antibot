// Landing page — hero + คอนเสิร์ตเด่น
import Link from "next/link";
import { ArrowRight, ShieldCheck, Users, Zap } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ConcertCard } from "@/components/concert-card";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

// revalidate ทุก 60 วินาที — concert list ไม่ค่อยเปลี่ยน
export const revalidate = 60;

const trust = [
  { icon: ShieldCheck, label: "Anti-bot 8 ชั้น" },
  { icon: Users, label: "คิวสุ่มยุติธรรม" },
  { icon: Zap, label: "จองลื่นไม่สะดุด" },
];

export default async function HomePage() {
  // ดึง concerts ที่ ON_SALE + SCHEDULED มาแสดง (limit 6)
  const concerts = await prisma.concert.findMany({
    where: { status: { in: ["ON_SALE", "SCHEDULED"] } },
    include: { zones: { select: { price: true } } },
    orderBy: [{ status: "asc" }, { saleStartAt: "asc" }],
    take: 6,
  });

  return (
    <>
      <SiteHeader />

      {/* Hero */}
      <section className="bg-stage relative overflow-hidden text-white">
        <div className="bg-spotlight absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-24 text-center sm:py-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-white/80">
            <span className="size-1.5 animate-pulse rounded-full bg-brand-400" />
            ระบบจองบัตรกันบอท สำหรับงานจริง
          </span>

          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
            จองบัตรคอนเสิร์ต
            <br />
            <span className="text-brand-400">อย่างเป็นธรรม</span> กับทุกคน
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg text-white/70">
            ระบบ anti-bot 8 ชั้น และคิวสุ่มยุติธรรม คัดบอทออกก่อนถึงหน้าจอง
            ให้ผู้ใช้จริงทุกคนมีโอกาสเท่ากัน
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/concerts">
              <Button size="lg" rightIcon={<ArrowRight className="size-4" />}>
                ดูคอนเสิร์ตทั้งหมด
              </Button>
            </Link>
            <Link href="/register">
              <Button
                size="lg"
                variant="outline"
                className="border-white/25 bg-white/5 text-white hover:bg-white/10 hover:border-white/40"
              >
                สมัครสมาชิกฟรี
              </Button>
            </Link>
          </div>

          {/* แถบ trust — ไม่ใช่ big-number template แค่บอกจุดเด่นสั้นๆ */}
          <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-white/60">
            {trust.map((t) => (
              <span key={t.label} className="flex items-center gap-2">
                <t.icon className="size-4 text-brand-400" />
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* คอนเสิร์ตเด่น */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-neutral-900">คอนเสิร์ตเด่น</h2>
            <p className="mt-1 text-sm text-neutral-500">รอบที่กำลังเปิดขายและกำลังจะมาถึง</p>
          </div>
          <Link
            href="/concerts"
            className="hidden shrink-0 items-center gap-1 text-sm font-medium text-brand-600 hover:underline sm:flex"
          >
            ดูทั้งหมด <ArrowRight className="size-4" />
          </Link>
        </div>

        {concerts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-white py-16 text-center">
            <p className="text-neutral-500">ยังไม่มีคอนเสิร์ตในระบบ</p>
            <Link
              href="/admin/concerts/new"
              className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline"
            >
              admin เพิ่มคอนเสิร์ตได้ที่นี่ →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {concerts.map((c) => (
              <ConcertCard key={c.id.toString()} concert={c} />
            ))}
          </div>
        )}
      </section>

      <footer className="bg-stage mt-8 text-white/50">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-10 text-sm sm:flex-row">
          <p>© 2026 Concert Anti-Bot — โปรเจ็คจบ ป.ตรี</p>
          <div className="flex gap-5">
            <Link href="/concerts" className="hover:text-white">
              คอนเสิร์ต
            </Link>
            <Link href="/login" className="hover:text-white">
              เข้าสู่ระบบ
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
