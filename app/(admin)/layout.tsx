// Server-side guard สำหรับทุกหน้าใต้ /admin (N5) — defense-in-depth ซ้อนกับ middleware
// เหตุผล: พึ่ง middleware อย่างเดียวเสี่ยง (เช่น Next.js middleware bypass CVE-2025-29927
//   ที่ปลอม header ข้าม middleware ได้) → หน้า admin ที่ดึงข้อมูลรายได้/รายชื่อ/บอท-ล็อก จะหลุด
// layout นี้เป็น Server Component รันบน server ทุกครั้งที่เข้าหน้า admin → เช็ค role ก่อน render/ดึงข้อมูล
import { redirect } from "next/navigation";
import { isVerifiedAdmin } from "@/lib/admin-guard";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // F2: เช็ค role กับ DB จริง (ไม่เชื่อ JWT ที่ค้างได้ถึง 30 วัน) → demote มีผลทันที
  if (!(await isVerifiedAdmin())) {
    // ไม่ใช่ admin (หรือยังไม่ได้ login) → เด้งออก ไม่ render เนื้อหา admin เลย
    redirect("/");
  }
  return <>{children}</>;
}
