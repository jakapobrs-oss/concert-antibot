// ============================================================
// กติกาแต่งตั้ง/ถอนเจ้าหน้าที่หน้างาน (STAFF) — pure, unit test ได้ (rev 42)
// ============================================================
// หน้า /admin/staff ให้แอดมินแต่งตั้งด้วย "อีเมล" ของบัญชีที่สมัครไว้แล้ว
// กฎ:
//   - แตะได้แค่ USER ↔ STAFF เท่านั้น — บัญชี ADMIN เปลี่ยนที่นี่ไม่ได้ (ทั้งลดและเพิ่ม)
//     ทำไม: หน้านี้ตั้งใจให้ "แจกสิทธิ์สแกน" ไม่ใช่จัดการแอดมิน · แอดมินมาจาก SEED_ADMIN_EMAIL เท่านั้น
//     ถ้าปล่อยให้ตั้ง ADMIN จากหน้าเว็บ = แอดมินหนึ่งคนสร้างแอดมินไม่รู้จบ / ลดสิทธิ์กันเองได้
//   - แต่งตั้งซ้ำ / ถอนคนที่ไม่ได้เป็น = ไม่ผิด แค่บอกสถานะ (idempotent — แอดมินกดสองทีไม่พัง)
import type { UserRole } from "@prisma/client";

export type StaffRoleChange =
  | { ok: true; role: UserRole; changed: boolean; message: string }
  | { ok: false; error: string };

export function decideStaffRoleChange(current: UserRole, makeStaff: boolean): StaffRoleChange {
  if (current === "ADMIN") {
    return { ok: false, error: "บัญชีนี้เป็นแอดมิน — เปลี่ยนสิทธิ์แอดมินจากหน้านี้ไม่ได้" };
  }
  if (makeStaff) {
    if (current === "STAFF") {
      return { ok: true, role: "STAFF", changed: false, message: "บัญชีนี้เป็นเจ้าหน้าที่อยู่แล้ว" };
    }
    // เปิดลิงก์ตรงได้ทันที (หน้าเช็ค role กับ DB) — แต่เมนู "จุดเช็คอิน" ในหัวเว็บอ่าน role จาก JWT จะขึ้นหลังล็อกอินใหม่
    return {
      ok: true,
      role: "STAFF",
      changed: true,
      message: "แต่งตั้งเป็นเจ้าหน้าที่แล้ว — ส่งลิงก์ /staff/checkin ให้เปิดได้ทันที (เมนู \"จุดเช็คอิน\" จะขึ้นหลังออกจากระบบแล้วเข้าใหม่)",
    };
  }
  if (current === "USER") {
    return { ok: true, role: "USER", changed: false, message: "บัญชีนี้ไม่ได้เป็นเจ้าหน้าที่อยู่แล้ว" };
  }
  return { ok: true, role: "USER", changed: true, message: "ถอนสิทธิ์เจ้าหน้าที่แล้ว — สแกนต่อไม่ได้ทันที" };
}
