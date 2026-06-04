// Layout ของกลุ่มหน้า auth — split-screen
// ซ้าย: แผงแบรนด์ (พื้นเวที + จุดขายระบบ) / ขวา: ฟอร์ม
import Link from "next/link";
import { Ticket, ShieldCheck, Users, Sparkles } from "lucide-react";

const points = [
  { icon: ShieldCheck, title: "Anti-bot 8 ชั้น", desc: "กรองบอทออกก่อนถึงหน้าจอง" },
  { icon: Users, title: "คิวสุ่มยุติธรรม", desc: "ทุกคนมีโอกาสเท่ากัน ไม่ใช่ใครเร็วกว่า" },
  { icon: Sparkles, title: "จองลื่นไม่สะดุด", desc: "ที่นั่งล็อกชั่วคราวระหว่างชำระเงิน" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* แผงแบรนด์ (ซ่อนบนจอเล็ก) */}
      <aside className="bg-stage relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        <Link href="/" className="group flex w-fit items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-600 shadow-brand transition-transform group-hover:scale-105">
            <Ticket className="size-5" strokeWidth={2.2} />
          </span>
          <span className="text-xl font-bold tracking-tight">
            Concert<span className="text-brand-400">.</span>
          </span>
        </Link>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight tracking-tight">
            จองบัตรคอนเสิร์ต
            <br />
            อย่างเป็นธรรมกับทุกคน
          </h2>
          <ul className="mt-8 space-y-5">
            {points.map((p) => (
              <li key={p.title} className="flex gap-3.5">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 text-brand-400">
                  <p.icon className="size-5" />
                </span>
                <div>
                  <p className="font-semibold">{p.title}</p>
                  <p className="text-sm text-white/60">{p.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-white/40">© 2026 Concert Anti-Bot</p>
      </aside>

      {/* ฝั่งฟอร์ม */}
      <main className="flex flex-col items-center justify-center bg-neutral-50 px-4 py-10">
        {/* โลโก้ย่อสำหรับจอเล็ก */}
        <Link href="/" className="mb-8 flex items-center gap-2 lg:hidden">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-600 text-white">
            <Ticket className="size-5" strokeWidth={2.2} />
          </span>
          <span className="text-lg font-bold tracking-tight text-neutral-900">
            Concert<span className="text-brand-600">.</span>
          </span>
        </Link>

        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
