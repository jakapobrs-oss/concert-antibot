// ข้อมูลอ้างอิงที่หน้ากฎหมาย/นโยบายใช้ร่วมกัน (privacy · terms · ticket-terms) — แก้ที่เดียว ทุกหน้าเปลี่ยนตาม
// ตัวเลขเชิงระบบดึงจาก env จริง ไม่ hardcode ให้เอกสารเพี้ยนจากพฤติกรรมระบบ
import { env } from "@/lib/env";

// วันที่ประกาศใช้ฉบับปัจจุบัน — เปลี่ยนทุกครั้งที่แก้เนื้อหานโยบาย
//   (ผู้ใช้ที่สมัครหลังวันนี้ถือว่ายอมรับฉบับนี้ — เวลาที่ยอมรับ = User.createdAt เพราะสมัครไม่ผ่านถ้าไม่ติ๊ก)
export const POLICY_VERSION = "2026-08-27";

// ผู้ควบคุมข้อมูลส่วนบุคคล (data controller) ตาม PDPA — ระบุเป็นชื่อโครงการ ไม่ใช่ชื่อบุคคล
export const DATA_CONTROLLER_NAME =
  "ทีมพัฒนาระบบจองบัตรคอนเสิร์ตออนไลน์ที่มีระบบป้องกันบอท (ปริญญานิพนธ์ สาขาวิชาวิทยาการคอมพิวเตอร์ " +
  "วิทยาลัยนวัตกรรมดิจิทัลเทคโนโลยี มหาวิทยาลัยรังสิต)";

// คืนเงินภายในกี่วันหลังอนุมัติคำขอคืนบัตร — ⚠️ ค่าตั้งต้นที่ทีมยังไม่ยืนยัน (แก้ตรงนี้ที่เดียว)
export const REFUND_DAYS = 14;

// อีเมลติดต่อเรื่องข้อมูลส่วนบุคคล/ปัญหาการใช้งาน — null = ยังไม่ตั้ง SUPPORT_EMAIL (หน้านโยบายจะชี้ไปแชตช่วยเหลือในเว็บแทน)
export function getSupportEmail(): string | null {
  const value = env.SUPPORT_EMAIL?.trim();
  return value ? value : null;
}

// เวลาที่ที่นั่งถูกล็อกให้ชำระเงิน (นาที) — จาก SEAT_HOLD_TTL_SECONDS
export const seatHoldMinutes = Math.max(1, Math.round(env.SEAT_HOLD_TTL_SECONDS / 60));
// คืนบัตรได้ถึงกี่ชั่วโมงก่อนเริ่มงาน — จาก RETURN_CUTOFF_HOURS
export const returnCutoffHours = env.RETURN_CUTOFF_HOURS;
// ผู้ถือบัตรที่ไม่ใช่ผู้ซื้อต้องมีบัญชีอายุอย่างน้อยกี่วัน (0 = ไม่บังคับ) — จาก HOLDER_MIN_ACCOUNT_AGE_DAYS
export const holderMinAccountAgeDays = env.HOLDER_MIN_ACCOUNT_AGE_DAYS;
