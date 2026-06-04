// Site header — แถบบนของทุกหน้า (พื้นเวทีดำอมแดง, sticky)
// ยังไม่ login → 2 ปุ่มชัดๆ (เข้าสู่ระบบ / สมัครสมาชิก)
// login แล้ว → เมนูผู้ใช้แบบ dropdown (components/user-menu.tsx)
import Link from "next/link";
import { Ticket } from "lucide-react";
import { auth, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
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
      className="bg-stage sticky top-0 border-b border-white/10 backdrop-blur-sm"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        {/* โลโก้ */}
        <Link href="/" className="group flex items-center gap-2 text-white">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-600 shadow-brand transition-transform duration-200 group-hover:scale-105">
            <Ticket className="size-5" strokeWidth={2.2} />
          </span>
          <span className="text-lg font-bold tracking-tight">
            Concert<span className="text-brand-400">.</span>
          </span>
        </Link>

        {/* nav */}
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/concerts"
            className="rounded-lg px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            คอนเสิร์ตทั้งหมด
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
                <Button variant="ghost" size="sm" className="text-white hover:bg-white/10">
                  เข้าสู่ระบบ
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">สมัครสมาชิก</Button>
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
