"use client";

// เมนูผู้ใช้แบบ dropdown (แสดงเมื่อ login แล้ว) — โทนเวทีมืด
// ปิดเมื่อคลิกข้างนอก / กด Escape / เลือกเมนู — เข้าถึงด้วยคีย์บอร์ดได้
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Ticket, LayoutDashboard, LogOut } from "lucide-react";

interface Props {
  name: string;
  email?: string | null;
  isAdmin: boolean;
  signOutAction: () => Promise<void>;
}

export function UserMenu({ name, email, isAdmin, signOutAction }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // ตัวอักษรแรกของชื่อไว้ทำ avatar
  const initial = name.trim().charAt(0).toUpperCase() || "U";

  // ปิดเมนูเมื่อคลิกนอกพื้นที่ หรือกด Escape
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-sm text-fg
          transition-colors hover:bg-fg/10 active:bg-fg/15"
      >
        <span
          className="grid size-8 place-items-center rounded-full bg-brand-600 font-display text-sm font-semibold text-white"
          aria-hidden
        >
          {initial}
        </span>
        <span className="hidden max-w-32 truncate font-medium sm:block">{name}</span>
        <ChevronDown
          className={`size-4 text-fg-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          style={{ zIndex: "var(--z-dropdown)" }}
          className="animate-scale-in absolute right-0 mt-2 w-60 origin-top-right overflow-hidden
            rounded-xl border border-fg/15 bg-ink-800 shadow-lg"
        >
          {/* หัวเมนู — ชื่อ + อีเมล */}
          <div className="border-b border-fg/10 px-4 py-3">
            <p className="truncate text-sm font-semibold text-fg">{name}</p>
            {email && <p className="truncate text-xs text-fg-faint">{email}</p>}
          </div>

          <div className="p-1.5">
            <MenuLink href="/account/tickets" icon={<Ticket className="size-4" />} onClick={() => setOpen(false)}>
              ตั๋วของฉัน
            </MenuLink>
            {isAdmin && (
              <MenuLink
                href="/admin"
                icon={<LayoutDashboard className="size-4" />}
                onClick={() => setOpen(false)}
              >
                แดชบอร์ดผู้ดูแล
              </MenuLink>
            )}
          </div>

          {/* ออกจากระบบ — เรียก server action ผ่าน form */}
          <div className="border-t border-fg/10 p-1.5">
            <form action={signOutAction}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium
                  text-danger transition-colors hover:bg-danger/10"
              >
                <LogOut className="size-4" />
                ออกจากระบบ
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg-dim
        transition-colors hover:bg-fg/10 hover:text-fg"
    >
      <span className="text-fg-faint">{icon}</span>
      {children}
    </Link>
  );
}
