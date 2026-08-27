// ============================================================
// Admin/Staff authorization guard — re-check role กับ DB จริง (Codex §4 #2 / F2)
// ============================================================
// ปัญหาเดิม: role ถูก bake ลง JWT ตอน login และมีอายุ ~30 วัน (default) ทุกจุด admin
//   (layout, api/admin/*, server actions) อ่าน role จาก session/JWT ล้วน → ไม่มีที่ไหน re-check DB
//   ⇒ แอดมินที่ถูกถอดสิทธิ์ยังเข้า /admin ได้จนกว่า token จะหมดอายุ (privilege persistence)
// วิธีแก้: ทุกจุด admin เรียก guard นี้ที่ query role ปัจจุบันจาก DB → demote มีผลทันที
//   (admin traffic น้อย — DB query ต่อ request รับได้)
//
// rev 42: เพิ่ม role STAFF (เจ้าหน้าที่หน้างาน) — ทำได้อย่างเดียวคือสแกนเช็คอิน
//   isVerifiedStaff = STAFF หรือ ADMIN (แอดมินสแกนเองได้ด้วย) · isVerifiedAdmin = ADMIN เท่านั้น
//   กติกาเดียวกัน: เชื่อ role ใน DB เท่านั้น ถอนสิทธิ์ STAFF แล้วสแกนต่อไม่ได้ทันที
import type { Session } from "next-auth";
import type { UserRole } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// role ที่ถือว่า "เป็นเจ้าหน้าที่จุดสแกน" — ADMIN รวมอยู่ด้วยเพื่อไม่ต้องสลับบัญชีตอนเดโม/งานเล็ก
export const STAFF_ROLES: readonly UserRole[] = ["STAFF", "ADMIN"];

// คืน session เฉพาะเมื่อ role ปัจจุบัน "ใน DB" อยู่ในชุดที่อนุญาต (ไม่เชื่อ role ใน JWT)
async function verifiedRoleSession(allowed: readonly UserRole[]): Promise<Session | null> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { id: BigInt(id) },
    select: { role: true },
  });
  return user && allowed.includes(user.role) ? session : null;
}

async function verifiedAdminSession(): Promise<Session | null> {
  return verifiedRoleSession(["ADMIN"]);
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

// ---- STAFF (rev 42) ----
// boolean guard สำหรับ layout /staff/* — STAFF หรือ ADMIN
export async function isVerifiedStaff(): Promise<boolean> {
  return (await verifiedRoleSession(STAFF_ROLES)) !== null;
}

// throwing guard สำหรับ action เช็คอิน — คืน session เพื่อบันทึกว่าใครเป็นคนสแกน
export async function assertVerifiedStaff(): Promise<Session> {
  const session = await verifiedRoleSession(STAFF_ROLES);
  if (!session) throw new Error("ต้องเป็นเจ้าหน้าที่เท่านั้น");
  return session;
}
