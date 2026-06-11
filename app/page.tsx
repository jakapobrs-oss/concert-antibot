// Landing page — เวทีกลางคืน: hero ไฟเวที + แถบตัววิ่งงานที่กำลังขาย
// + คอนเสิร์ตเด่น + อธิบายกลไกความเป็นธรรม (จุดขายของ thesis)
import Link from "next/link";
import { ArrowRight, ShieldCheck, Users, ReceiptText, Star } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ConcertCard } from "@/components/concert-card";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Marquee } from "@/components/marquee";
import { EqBars } from "@/components/eq-bars";
import { Button } from "@/components/ui/button";

// revalidate ทุก 60 วินาที — concert list ไม่ค่อยเปลี่ยน
export const revalidate = 60;

const trust = [
  { icon: ShieldCheck, label: "คัดบอทออกก่อนถึงหน้าจอง" },
  { icon: Users, label: "คิวสุ่ม ไม่วัดว่าใครเน็ตเร็ว" },
  { icon: ReceiptText, label: "ยืนยันสลิปโอนอัตโนมัติ" },
];

// ขั้นตอนจริงของการจอง — เป็นลำดับจริง เลขจึงมีความหมาย
const steps = [
  {
    n: "1",
    title: "เข้าห้องรอ",
    desc: "ทุกคนที่มาช่วงเวลาเดียวกันถูกสุ่มลำดับคิว ความเร็วเน็ตหรือการรัวรีเฟรชไม่ช่วยอะไร",
  },
  {
    n: "2",
    title: "ระบบคัดกรองบอท",
    desc: "ตรวจลายนิ้วมือเบราว์เซอร์ พฤติกรรมการใช้งาน และ Turnstile ก่อนปล่อยเข้าหน้าเลือกที่นั่ง",
  },
  {
    n: "3",
    title: "จ่ายจริง ได้ตั๋วจริง",
    desc: "โอน PromptPay แล้วระบบตรวจสลิปกับธนาคารอัตโนมัติ บอทปลอมสลิปไม่ผ่าน",
  },
];

export default async function HomePage() {
  // ดึง concerts ที่ ON_SALE + SCHEDULED มาแสดง (limit 6)
  const concerts = await prisma.concert.findMany({
    where: { status: { in: ["ON_SALE", "SCHEDULED"] } },
    include: { zones: { select: { price: true } } },
    orderBy: [{ status: "asc" }, { saleStartAt: "asc" }],
    take: 6,
  });

  const onSaleTitles = concerts.filter((c) => c.status === "ON_SALE").map((c) => c.title);
  // ถ้ายังไม่มีงานกำลังขาย ใช้ข้อความระบบแทน — แถบไม่หาย แค่เปลี่ยนเนื้อ
  const tickerItems = onSaleTitles.length
    ? onSaleTitles.map((t) => `กำลังขาย — ${t}`)
    : ["ระบบพร้อมเปิดขาย", "คิวสุ่มยุติธรรม", "ตรวจสลิปอัตโนมัติ"];

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      {/* Hero — เวทีก่อนไฟเปิด: แสงไฟลอยช้าๆ + เม็ดฟิล์ม */}
      <section className="bg-stage relative overflow-hidden">
        {/* แสงไฟเวที 2 ดวงลอยช้าๆ (ตกแต่งล้วน) */}
        <div
          className="animate-drift-a absolute -top-32 left-1/4 size-[34rem] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.575 0.222 27.5 / 0.4), transparent 65%)" }}
          aria-hidden
        />
        <div
          className="animate-drift-b absolute -right-24 top-10 size-[26rem] rounded-full opacity-50 blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.8 0.15 78 / 0.22), transparent 65%)" }}
          aria-hidden
        />
        <div className="bg-spotlight absolute inset-0" aria-hidden />
        <div className="bg-grain absolute inset-0" aria-hidden />

        <div className="relative mx-auto max-w-6xl px-4 py-24 text-center sm:py-32">
          <span
            className="animate-fade-in-up inline-flex items-center gap-2.5 rounded-full border border-fg/15 bg-fg/5 px-4 py-1.5 font-display text-sm text-fg-dim backdrop-blur-sm"
          >
            <EqBars className="h-2.5 text-brand-400" />
            ระบบจองบัตรกันบอท — คิวสุ่มยุติธรรม
          </span>

          <h1
            className="animate-fade-in-up mx-auto mt-7 max-w-4xl font-display text-5xl font-bold leading-[1.08] tracking-tight text-fg sm:text-7xl"
            style={{ animationDelay: "90ms" }}
          >
            จองบัตรคอนเสิร์ต
            <br />
            <span className="text-brand-400">อย่างเป็นธรรม</span>กับทุกคน
          </h1>

          <p
            className="animate-fade-in-up mx-auto mt-6 max-w-xl text-lg leading-relaxed text-fg-dim"
            style={{ animationDelay: "180ms" }}
          >
            บอทถูกคัดออกตั้งแต่ก่อนถึงหน้าจอง คิวถูกสุ่มอย่างเท่าเทียม
            และเงินทุกบาทถูกตรวจกับธนาคารจริง
          </p>

          <div
            className="animate-fade-in-up mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
            style={{ animationDelay: "270ms" }}
          >
            <Link href="/concerts">
              <Button size="lg" rightIcon={<ArrowRight className="size-4" />}>
                ดูคอนเสิร์ตทั้งหมด
              </Button>
            </Link>
            <Link href="/register">
              <Button size="lg" variant="outline">
                สมัครสมาชิกฟรี
              </Button>
            </Link>
          </div>

          {/* แถบ trust — จุดเด่นสั้นๆ ไม่ใช่ตัวเลขโม้ */}
          <div
            className="animate-fade-in-up mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-fg-faint"
            style={{ animationDelay: "360ms" }}
          >
            {trust.map((t) => (
              <span key={t.label} className="flex items-center gap-2">
                <t.icon className="size-4 text-brand-400" />
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* แถบตัววิ่ง — ป้ายไฟหน้างาน บอกว่าตอนนี้มีอะไรกำลังขาย */}
      <Marquee className="border-y border-brand-500/40 bg-brand-600 py-2.5 text-white">
        {tickerItems.map((item, i) => (
          <span key={i} className="flex items-center gap-3 pr-3 font-display text-sm font-semibold tracking-wide">
            <Star className="size-3.5 fill-current text-spot-200" aria-hidden />
            {item}
          </span>
        ))}
      </Marquee>

      {/* คอนเสิร์ตเด่น */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight text-fg">คอนเสิร์ตเด่น</h2>
            <p className="mt-1.5 text-sm text-fg-faint">รอบที่กำลังเปิดขายและกำลังจะมาถึง</p>
          </div>
          <Link
            href="/concerts"
            className="hidden shrink-0 items-center gap-1 font-display text-sm font-medium text-brand-300 transition-colors hover:text-brand-200 sm:flex"
          >
            ดูทั้งหมด <ArrowRight className="size-4" />
          </Link>
        </div>

        {concerts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 py-16 text-center">
            <p className="text-fg-faint">ยังไม่มีคอนเสิร์ตในระบบ</p>
            <Link
              href="/admin/concerts/new"
              className="mt-2 inline-block text-sm font-medium text-brand-300 hover:underline"
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

      {/* กลไกความเป็นธรรม — ลำดับจริงของการจอง (จุดขายของระบบ/thesis) */}
      <section className="relative overflow-hidden border-y border-fg/10 bg-ink-900">
        <div className="bg-grain absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-fg">
              ทำไมระบบนี้ถึง<span className="text-brand-400">เป็นธรรม</span>
            </h2>
            <p className="mt-2 text-fg-faint">
              สามด่านที่ทุกคนต้องผ่านเหมือนกัน — ไม่มีทางลัด ไม่มีจ่ายแซงคิว
            </p>
          </div>

          <ol className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8">
            {steps.map((s, i) => (
              <li key={s.n} className="relative">
                {/* เส้นเชื่อมลำดับ (เฉพาะจอกว้าง ระหว่างข้อ) */}
                {i < steps.length - 1 && (
                  <span
                    className="absolute left-16 right-0 top-7 hidden h-px bg-gradient-to-r from-brand-500/50 to-transparent sm:block"
                    aria-hidden
                  />
                )}
                <span className="text-led grid size-14 place-items-center rounded-xl border border-spot-400/30 bg-ink-850 text-2xl font-bold text-spot-300 shadow-glow-spot">
                  {s.n}
                </span>
                <h3 className="mt-4 font-display text-lg font-semibold text-fg">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-dim">{s.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
