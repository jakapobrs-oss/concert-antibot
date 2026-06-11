// Site header — แถบบนของทุกหน้า (กลืนกับพื้นเวทีมืด, sticky)
// ยังไม่ login → 2 ปุ่มชัดๆ (เข้าสู่ระบบ / สมัครสมาชิก)
// login แล้ว → เมนูผู้ใช้แบบ dropdown (components/user-menu.tsx)
import Link from "next/link";
import { Ticket } from "lucide-react";
import { auth, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { EqBars } from "@/components/eq-bars";
import { UserMenu } from "@/components/user-menu";

export async function SiteHeader() {
  const session = await auth();
  const user = session?.user as
    | { name?: string | null; email?: string | null; role?: string }
    | undefined;
  const isLoggedIn = !!user;
  const isAdmin = user?.role === "ADMIN";

  // server action สำหรับออกจากระบบ — ส่งให้ client component (UserMenu)
  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <header
      style={{ zIndex: "var(--z-sticky)" }}
      className="sticky top-0 border-b border-fg/10 bg-ink-deep/85 backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        {/* โลโก้ — ป้ายไฟแดง + ชื่อ + equalizer เล็กๆ ให้รู้ว่าเว็บ "มีชีวิต" */}
        <Link href="/" className="group flex items-center gap-2.5 text-fg">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-600 shadow-glow-brand transition-transform duration-200 group-hover:scale-105">
            <Ticket className="size-5 text-white" strokeWidth={2.2} />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            Concert<span className="text-brand-400">.</span>
          </span>
          {/* equalizer เป็นของตกแต่ง — ซ่อนบนจอเล็กให้ header มีที่พอ */}
          <span className="hidden sm:block">
            <EqBars className="h-3 text-brand-400/80" />
          </span>
        </Link>

        {/* nav */}
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/concerts"
            className="whitespace-nowrap rounded-lg px-3 py-2 font-display text-sm font-medium text-fg-dim transition-colors hover:bg-fg/10 hover:text-fg"
          >
            {/* จอเล็กใช้คำสั้น กันแถบ header ล้น */}
            <span className="sm:hidden">คอนเสิร์ต</span>
            <span className="hidden sm:inline">คอนเสิร์ตทั้งหมด</span>
          </Link>

          {isLoggedIn ? (
            <div className="ml-1 sm:ml-2">
              <UserMenu
                name={user.name || "ผู้ใช้"}
                email={user.email}
                isAdmin={isAdmin}
                signOutAction={signOutAction}
              />
            </div>
          ) : (
            <div className="ml-1 flex items-center gap-2 sm:ml-2">
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  เข้าสู่ระบบ
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">
                  {/* จอเล็กใช้คำสั้น กันปุ่มล้นขอบจอ */}
                  <span className="sm:hidden">สมัคร</span>
                  <span className="hidden sm:inline">สมัครสมาชิก</span>
                </Button>
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
