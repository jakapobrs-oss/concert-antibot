// Layout ของกลุ่มหน้า auth — split-screen (โทนเวทีมืดทั้งสองฝั่ง)
// ซ้าย: แผงแบรนด์ (พื้นเวที + จุดขายระบบ) / ขวา: ฟอร์ม
import Link from "next/link";
import { Ticket, ShieldCheck, Users, Sparkles } from "lucide-react";
import { EqBars } from "@/components/eq-bars";

const points = [
  { icon: ShieldCheck, title: "คัดบอทออกก่อนถึงหน้าจอง", desc: "Turnstile + ตรวจพฤติกรรมการใช้งานจริง" },
  { icon: Users, title: "คิวสุ่มยุติธรรม", desc: "ทุกคนมีโอกาสเท่ากัน ไม่ใช่ใครเน็ตเร็วกว่า" },
  { icon: Sparkles, title: "จองลื่นไม่สะดุด", desc: "ที่นั่งล็อกชั่วคราวระหว่างชำระเงิน" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* แผงแบรนด์ (ซ่อนบนจอเล็ก) */}
      <aside className="bg-stage relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <div className="bg-spotlight absolute inset-0" aria-hidden />
        <div className="bg-grain absolute inset-0" aria-hidden />

        <Link href="/" className="group relative flex w-fit items-center gap-2.5 text-fg">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-600 shadow-glow-brand transition-transform group-hover:scale-105">
            <Ticket className="size-5 text-white" strokeWidth={2.2} />
          </span>
          <span className="font-display text-xl font-bold tracking-tight">
            Concert<span className="text-brand-400">.</span>
          </span>
          <EqBars className="h-3 text-brand-400/80" />
        </Link>

        <div className="relative max-w-md">
          <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-fg">
            จองบัตรคอนเสิร์ต
            <br />
            อย่างเป็นธรรม<span className="text-brand-400">กับทุกคน</span>
          </h2>
          <ul className="mt-8 space-y-5">
            {points.map((p) => (
              <li key={p.title} className="flex gap-3.5">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-brand-500/25 bg-brand-500/12 text-brand-400">
                  <p.icon className="size-5" />
                </span>
                <div>
                  <p className="font-display font-semibold text-fg">{p.title}</p>
                  <p className="text-sm text-fg-faint">{p.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-fg-faint">© 2026 Concert Anti-Bot</p>
      </aside>

      {/* ฝั่งฟอร์ม */}
      <main className="relative flex flex-col items-center justify-center px-4 py-10">
        {/* แสงจางๆ ด้านบนให้ฝั่งฟอร์มไม่แบนทึบ */}
        <div className="bg-spotlight pointer-events-none absolute inset-x-0 top-0 h-64 opacity-50" aria-hidden />

        {/* โลโก้ย่อสำหรับจอเล็ก */}
        <Link href="/" className="relative mb-8 flex items-center gap-2 lg:hidden">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-600 text-white">
            <Ticket className="size-5" strokeWidth={2.2} />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-fg">
            Concert<span className="text-brand-400">.</span>
          </span>
        </Link>

        <div className="relative w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
