// Server-side guard สำหรับทุกหน้าใต้ /staff (rev 42) — defense-in-depth ซ้อนกับ middleware
// เหตุผลเดียวกับ (admin)/layout.tsx: พึ่ง middleware อย่างเดียวเสี่ยง (bypass CVE + role ใน JWT ค้าง 30 วัน)
//   → เช็ค role กับ DB จริงทุกครั้ง: STAFF หรือ ADMIN เท่านั้น ถอนสิทธิ์แล้วเข้าไม่ได้ทันที
import { redirect } from "next/navigation";
import { isVerifiedStaff } from "@/lib/admin-guard";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  if (!(await isVerifiedStaff())) {
    // ไม่ใช่เจ้าหน้าที่ (หรือยังไม่ได้ login) → เด้งออก ไม่ render อะไรเลย
    redirect("/");
  }
  return <>{children}</>;
}
