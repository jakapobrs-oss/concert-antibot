// Footer ของหน้า public — พื้นเวทีลึก + แถบ barcode ปิดท้ายเหมือนขอบตั๋ว
import Link from "next/link";
import { Ticket } from "lucide-react";
import { EqBars } from "@/components/eq-bars";

export function SiteFooter() {
  return (
    <footer className="bg-stage relative mt-auto overflow-hidden border-t border-fg/10">
      <div className="bg-grain pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-[1.4fr_1fr_1fr]">
        {/* แบรนด์ */}
        <div>
          <Link href="/" className="flex w-fit items-center gap-2.5 text-fg">
            <span className="grid size-9 place-items-center rounded-lg bg-brand-600">
              <Ticket className="size-5 text-white" strokeWidth={2.2} />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">
              Concert<span className="text-brand-400">.</span>
            </span>
          </Link>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-fg-faint">
            ระบบจองบัตรคอนเสิร์ตที่คัดบอทออกก่อนถึงหน้าจอง
            และจัดคิวแบบสุ่มให้ผู้ใช้จริงทุกคนมีโอกาสเท่ากัน
          </p>
          <EqBars className="mt-4 h-3.5 text-brand-500/70" />
        </div>

        {/* เมนู */}
        <nav className="text-sm" aria-label="เมนูท้ายเว็บ">
          <p className="mb-3 font-display font-semibold text-fg">เมนู</p>
          <ul className="space-y-2 text-fg-faint">
            <li>
              <Link href="/concerts" className="transition-colors hover:text-fg">
                คอนเสิร์ตทั้งหมด
              </Link>
            </li>
            <li>
              <Link href="/account/tickets" className="transition-colors hover:text-fg">
                ตั๋วของฉัน
              </Link>
            </li>
            <li>
              <Link href="/login" className="transition-colors hover:text-fg">
                เข้าสู่ระบบ
              </Link>
            </li>
            <li>
              <Link href="/register" className="transition-colors hover:text-fg">
                สมัครสมาชิก
              </Link>
            </li>
          </ul>
        </nav>

        {/* เกี่ยวกับระบบ */}
        <div className="text-sm">
          <p className="mb-3 font-display font-semibold text-fg">ระบบนี้คืออะไร</p>
          <p className="leading-relaxed text-fg-faint">
            ปริญญานิพนธ์วิทยาการคอมพิวเตอร์ —
            ศึกษาการป้องกันบอทและความเป็นธรรมในการจองบัตรคอนเสิร์ต
          </p>
        </div>
      </div>

      {/* แถบล่าง: copyright + เส้น barcode เหมือนขอบตั๋ว */}
      <div className="relative border-t border-fg/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-5 text-xs text-fg-faint sm:flex-row">
          <p>© 2026 Concert Anti-Bot — โปรเจ็คจบ ป.ตรี</p>
          <div className="bg-barcode h-5 w-36 text-fg/25" aria-hidden />
        </div>
      </div>
    </footer>
  );
}
