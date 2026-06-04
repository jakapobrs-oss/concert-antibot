// Pure helper — เช็คว่า "เวลาที่โอนตามสลิป" อยู่ในช่วงที่สมเหตุสมผลของ order
// ปิดช่องโหว่ Level 2: เอาสลิปเก่า (ที่เคยโอนเข้าบัญชีเราเรื่องอื่น) มาแนบจองตั๋ว
//
// กติกา: เวลาโอนต้อง "หลังสร้าง order" (กันสลิปเก่า) และ "ไม่ใช่อนาคต" (กัน clock เพี้ยน)
//        เผื่อ skew เล็กน้อยเพราะนาฬิกาธนาคารกับ server อาจต่างกัน

export const DEFAULT_SLIP_SKEW_MS = 5 * 60 * 1000; // เผื่อ 5 นาที

export function isSlipFresh(params: {
  slipTime: Date;
  orderCreatedAt: Date;
  now?: Date;
  skewMs?: number;
}): boolean {
  const now = params.now ?? new Date();
  const skew = params.skewMs ?? DEFAULT_SLIP_SKEW_MS;

  const t = params.slipTime.getTime();
  if (Number.isNaN(t)) return false; // parse เวลาไม่ได้ = ตรวจไม่ได้ = ไม่ผ่าน

  const notBefore = params.orderCreatedAt.getTime() - skew; // ต้องโอนหลังสร้าง order (เผื่อ skew)
  const notAfter = now.getTime() + skew; // ต้องไม่ใช่เวลาอนาคต (เผื่อ skew)

  return t >= notBefore && t <= notAfter;
}
