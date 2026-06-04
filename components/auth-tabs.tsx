// สลับระหว่างหน้าเข้าสู่ระบบ / สมัครสมาชิก แบบ segmented toggle
// ตอบโจทย์ "ให้รู้ว่าจะกดอะไร" โดยไม่ต้องเป็น dropdown — เห็นทั้งสองทางพร้อมกัน
import Link from "next/link";

export function AuthTabs({ active }: { active: "login" | "register" }) {
  const tab = (href: string, label: string, isActive: boolean) => (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`flex h-9 flex-1 items-center justify-center rounded-md text-sm font-medium transition-colors ${
        isActive
          ? "bg-white text-neutral-900 shadow-sm"
          : "text-neutral-500 hover:text-neutral-800"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1">
      {tab("/login", "เข้าสู่ระบบ", active === "login")}
      {tab("/register", "สมัครสมาชิก", active === "register")}
    </div>
  );
}
