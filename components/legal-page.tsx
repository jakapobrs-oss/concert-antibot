// โครงหน้าเอกสารสำหรับผู้ใช้ (นโยบายความเป็นส่วนตัว / ข้อกำหนด / เงื่อนไขบัตร)
// หัวเวทีมืดแบบเดียวกับหน้า listing + เนื้อหากว้าง ~70ch อ่านสบาย + สารบัญสั้นด้านบน
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export type LegalSectionMeta = { id: string; title: string };

// ลิงก์ข้ามไปเอกสารอื่นท้ายหน้า — ตัดหน้าที่กำลังเปิดอยู่ออก
const LEGAL_LINKS = [
  { href: "/terms", label: "ข้อกำหนดการใช้งาน" },
  { href: "/privacy", label: "นโยบายความเป็นส่วนตัว" },
  { href: "/ticket-terms", label: "เงื่อนไขบัตรและการคืนเงิน" },
] as const;

export function LegalPage({
  title,
  intro,
  version,
  currentPath,
  sections,
  children,
}: {
  title: string;
  intro: string;
  version: string;
  currentPath: (typeof LEGAL_LINKS)[number]["href"];
  sections: LegalSectionMeta[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <section className="bg-stage relative overflow-hidden border-b border-fg/10">
        <div className="bg-spotlight absolute inset-0 opacity-70" aria-hidden />
        <div className="bg-grain absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-3xl px-4 py-12 sm:py-16">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-brand-400">
            เอกสารสำหรับผู้ใช้
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-fg-dim">{intro}</p>
          <p className="mt-4 text-xs text-fg-faint">ฉบับวันที่ {version}</p>
        </div>
      </section>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        {/* สารบัญ — เลขข้อตรงกับหัวข้อจริง (เอกสารกฎหมายอ้างอิงกันด้วยเลขข้อ) */}
        <nav aria-label="หัวข้อในหน้านี้" className="mb-10 rounded-xl border border-fg/10 bg-ink-900/60 p-4 text-sm">
          <ol className="grid gap-1.5 sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-fg-dim transition-colors hover:text-fg">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="space-y-10">{children}</article>

        <p className="mt-14 border-t border-fg/10 pt-6 text-sm text-fg-faint">
          เอกสารที่เกี่ยวข้อง:{" "}
          {LEGAL_LINKS.filter((l) => l.href !== currentPath).map((l, i) => (
            <span key={l.href}>
              {i > 0 && " · "}
              <Link href={l.href} className="text-brand-300 hover:underline">
                {l.label}
              </Link>
            </span>
          ))}
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}

// หัวข้อย่อย — id ต้องตรงกับที่ส่งเข้า sections ของ LegalPage, n = เลขข้อ (ลำดับเดียวกัน)
export function LegalSection({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-xl font-bold text-fg">
        {n}. {title}
      </h2>
      <div className="mt-3 space-y-3 leading-relaxed text-fg-dim [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_strong]:text-fg">
        {children}
      </div>
    </section>
  );
}

// ตารางในเอกสาร — หัวคอลัมน์ + แถว (ข้อความล้วน) ใช้กับตารางชนิดข้อมูล
export function LegalTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-fg/10">
      <table className="w-full min-w-[36rem] text-sm">
        <thead className="bg-ink-900/70 text-left font-display text-xs uppercase tracking-wider text-fg-faint">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-fg/10">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((cell, j) => (
                <td key={j} className={`px-3 py-2 ${j === 0 ? "font-medium text-fg" : "text-fg-dim"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
