// สลับระหว่างหน้าเข้าสู่ระบบ / สมัครสมาชิก แบบ segmented toggle (โทนเวทีมืด)
// แท็บที่เลือกติดไฟแดงเหมือนปุ่มบนแผงควบคุม — เห็นทั้งสองทางพร้อมกัน
import Link from "next/link";

export function AuthTabs({ active }: { active: "login" | "register" }) {
  const tab = (href: string, label: string, isActive: boolean) => (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`flex h-9 flex-1 items-center justify-center rounded-md font-display text-sm font-medium transition-colors ${
        isActive
          ? "bg-brand-600 text-white shadow-glow-brand"
          : "text-fg-faint hover:text-fg"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg border border-fg/10 bg-ink-950/70 p-1">
      {tab("/login", "เข้าสู่ระบบ", active === "login")}
      {tab("/register", "สมัครสมาชิก", active === "register")}
    </div>
  );
}
