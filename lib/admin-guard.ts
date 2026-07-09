// ============================================================
// Admin authorization guard — re-check role กับ DB จริง (Codex §4 #2 / F2)
// ============================================================
// ปัญหาเดิม: role ถูก bake ลง JWT ตอน login และมีอายุ ~30 วัน (default) ทุกจุด admin
//   (layout, api/admin/*, server actions) อ่าน role จาก session/JWT ล้วน → ไม่มีที่ไหน re-check DB
//   ⇒ แอดมินที่ถูกถอดสิทธิ์ยังเข้า /admin ได้จนกว่า token จะหมดอายุ (privilege persistence)
// วิธีแก้: ทุกจุด admin เรียก guard นี้ที่ query role ปัจจุบันจาก DB → demote มีผลทันที
//   (admin traffic น้อย — DB query ต่อ request รับได้)
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// คืน session เฉพาะเมื่อ role ปัจจุบัน "ใน DB" = ADMIN (ไม่เชื่อ role ใน JWT)
async function verifiedAdminSession(): Promise<Session | null> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { id: BigInt(id) },
    select: { role: true },
  });
  return user?.role === "ADMIN" ? session : null;
}

// boolean guard — ใช้ใน route/layout ที่คืน 403/redirect เอง
export async function isVerifiedAdmin(): Promise<boolean> {
  return (await verifiedAdminSession()) !== null;
}

// throwing guard — ใช้ใน server action ที่ต้องการ session กลับไปใช้ต่อ
export async function assertVerifiedAdmin(): Promise<Session> {
  const session = await verifiedAdminSession();
  if (!session) throw new Error("ต้องเป็น admin เท่านั้น");
  return session;
}
