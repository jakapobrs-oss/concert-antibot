"use server";

// ============================================================
// แต่งตั้ง/ถอนเจ้าหน้าที่หน้างาน (role STAFF) — ฝั่งแอดมิน (rev 42)
// ============================================================
// RBAC: middleware + (admin)/layout กันชั้นนึงแล้ว — ที่นี่เช็คซ้ำกับ DB จริง (assertVerifiedAdmin)
// กติกา USER ↔ STAFF อยู่ใน lib/staff-role.ts (pure) — ADMIN แตะไม่ได้
// ทุก action คืน { ok } ไม่ throw — แผงแอดมินเอาไปแสดงข้อความได้ตรง ๆ
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertVerifiedAdmin } from "@/lib/admin-guard";
import { decideStaffRoleChange } from "@/lib/staff-role";

export type AdminStaffResult = { ok: true; message: string } | { ok: false; error: string };

// ไม่ใช้ .email() ตามคอนเวนชันของโปรเจกต์ (lib/auth.ts:16) — บัญชี dev เป็น "user@local" ไม่มี TLD
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "อีเมลไม่ถูกต้อง")
  .max(255, "อีเมลยาวเกินไป")
  .includes("@", { message: "อีเมลไม่ถูกต้อง" });

const idSchema = z.string().regex(/^\d+$/, "userId ไม่ถูกต้อง");

async function applyRoleChange(
  where: { id: bigint } | { email: string },
  makeStaff: boolean,
): Promise<AdminStaffResult> {
  try {
    await assertVerifiedAdmin();
  } catch {
    return { ok: false, error: "ต้องเป็นแอดมิน" };
  }

  // อีเมลเทียบแบบไม่สนตัวพิมพ์ (audit rev 42): ตอนสมัครไม่ได้ normalize → บัญชี "Somchai@Gmail.com" ต้องแต่งตั้งได้
  const user = await prisma.user.findFirst({
    where: "id" in where ? { id: where.id } : { email: { equals: where.email, mode: "insensitive" } },
    select: { id: true, role: true },
  });
  if (!user) return { ok: false, error: "ไม่พบผู้ใช้อีเมลนี้ในระบบ — ให้เจ้าหน้าที่สมัครบัญชีก่อน" };

  const decision = decideStaffRoleChange(user.role, makeStaff);
  if (!decision.ok) return decision;

  if (decision.changed) {
    // เขียนแบบมีเงื่อนไข role เดิม — กันสองแอดมินกดชนกัน หรือ role เพิ่งถูกเปลี่ยนจากทางอื่น
    const updated = await prisma.user.updateMany({
      where: { id: user.id, role: user.role },
      data: { role: decision.role },
    });
    if (updated.count === 0) {
      return { ok: false, error: "สิทธิ์ของบัญชีนี้เพิ่งถูกเปลี่ยน กรุณารีเฟรชแล้วลองใหม่" };
    }
    revalidatePath("/admin/staff");
  }
  return { ok: true, message: decision.message };
}

// แต่งตั้งด้วยอีเมล — แอดมินมักได้อีเมลจากเจ้าหน้าที่ ไม่ใช่ id
export async function grantStaffByEmail(input: { email: string }): Promise<AdminStaffResult> {
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "อีเมลไม่ถูกต้อง" };
  }
  return applyRoleChange({ email: parsed.data }, true);
}

// ถอนสิทธิ์จากแถวในตาราง (ใช้ id)
export async function revokeStaffById(input: { userId: string }): Promise<AdminStaffResult> {
  const parsed = idSchema.safeParse(input.userId);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  return applyRoleChange({ id: BigInt(parsed.data) }, false);
}
