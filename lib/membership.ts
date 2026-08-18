// ============================================================
// Membership — สิทธิ์สมาชิก (Phase 2)
// ============================================================
// ขอบเขตที่ตกลงไว้: สมาชิก **ชั้นเดียว** (เป็น/ไม่เป็น) และสิทธิ์มีอย่างเดียวคือ
// "เข้ารอบกดบัตรก่อน" — ไม่ให้ซื้อได้เยอะกว่าคนทั่วไป เพราะจะขัดกับระบบกันคนกวาดตั๋ว
// (บัตรผูกชื่อ + เพดานตั๋วต่อบัญชี) ที่ทำไว้แล้ว
//
// 🔑 หัวใจของไฟล์นี้: **หมดอายุคำนวณสดจากเวลาปัจจุบัน ไม่มี cron มาพลิกสถานะ**
//    ถ้าเก็บ "EXPIRED" เป็นสถานะในตาราง จะเกิดบั๊กคลาสสิกทันที: สมาชิกหมดอายุไปแล้ว
//    แต่ในตารางยังเขียนว่า ACTIVE อยู่เพราะ cron ไม่วิ่ง/วิ่งช้า -> คนหมดสิทธิ์ยังเข้ารอบสมาชิกได้
//    ตารางจึงเก็บแค่ "ข้อเท็จจริง" (เริ่มเมื่อไหร่ ถึงเมื่อไหร่ ถูกเพิกถอนไหม) แล้วตัดสินสดตอนถาม

import { prisma } from "@/lib/prisma";

/** รูปร่างขั้นต่ำที่ใช้ตัดสิน — รับเป็น interface เพื่อให้เทสได้โดยไม่ต้องมีฐานข้อมูล */
export interface MembershipLike {
  status: "ACTIVE" | "REVOKED";
  expiresAt: Date | null;
}

/**
 * ยังเป็นสมาชิกอยู่จริงไหม ณ เวลาที่ถาม
 *
 * ผ่านเมื่อ: สถานะ ACTIVE **และ** (ไม่มีวันหมดอายุ หรือ ยังไม่ถึงวันหมดอายุ)
 * `expiresAt = null` แปลว่าไม่มีกำหนด (สิทธิ์ที่แอดมินให้แบบถาวร)
 */
export function isMembershipActive(
  membership: MembershipLike | null | undefined,
  now: Date = new Date()
): boolean {
  if (!membership) return false;
  if (membership.status !== "ACTIVE") return false;
  if (membership.expiresAt === null) return true;
  // ตรงเวลาหมดอายุพอดี = หมดแล้ว (ใช้ > ไม่ใช่ >=) ให้สอดคล้องกับช่วงเวลาแบบ [start, end)
  return membership.expiresAt.getTime() > now.getTime();
}

/**
 * ดึงสิทธิ์สมาชิกที่ยังใช้ได้ของ user คนนี้ — คืน null ถ้าไม่มี/หมดอายุ/ถูกเพิกถอน
 *
 * ผู้เรียกหลักคือด่านรอบกดบัตร (lib/sale-round.ts) และหน้าดูสถานะของผู้ใช้เอง
 */
export async function getActiveMembership(userId: bigint, now: Date = new Date()) {
  const membership = await prisma.membership.findUnique({ where: { userId } });
  return isMembershipActive(membership, now) ? membership : null;
}

/** เวอร์ชันสั้นสำหรับด่านที่ต้องการแค่ผ่าน/ไม่ผ่าน */
export async function isActiveMember(userId: bigint, now: Date = new Date()): Promise<boolean> {
  return (await getActiveMembership(userId, now)) !== null;
}

/**
 * สาเหตุที่ "ไม่ได้เป็นสมาชิก" — ใช้บอกผู้ใช้ให้ตรงเรื่องบนหน้าสถานะ
 * แยกจาก isMembershipActive เพราะด่านต้องการแค่ boolean ส่วนหน้าจอต้องการเหตุผล
 */
export type MembershipState =
  | { active: true; expiresAt: Date | null }
  | { active: false; reason: "NONE" | "REVOKED" | "EXPIRED" };

export function describeMembership(
  membership: MembershipLike | null | undefined,
  now: Date = new Date()
): MembershipState {
  if (!membership) return { active: false, reason: "NONE" };
  if (membership.status === "REVOKED") return { active: false, reason: "REVOKED" };
  if (membership.expiresAt !== null && membership.expiresAt.getTime() <= now.getTime()) {
    return { active: false, reason: "EXPIRED" };
  }
  return { active: true, expiresAt: membership.expiresAt };
}

/** อายุสมาชิกเริ่มต้นตอนผู้ใช้กดสมัครเอง (วัน) — แอดมินให้สิทธิ์เองกำหนดได้อิสระ */
export const SELF_SIGNUP_DURATION_DAYS = 365;

/** บวกวันจากเวลาที่กำหนด — แยกออกมาเพื่อให้เทสกำหนดเวลาเองได้ ไม่ต้องพึ่งนาฬิกาเครื่อง */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
