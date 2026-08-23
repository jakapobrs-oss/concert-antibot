// ============================================================
// Countdown — นับถอยหลังก่อนเปิดขาย/เปิดรอบ (Phase 2.4, docs/24)
// ============================================================
// ทำไมเว็บกดบัตรทุกเจ้าต้องมี:
//   1) ผู้ใช้ต้องรู้ "อีกกี่วินาทีจะกดได้" ไม่ใช่เดาแล้วกด F5 รัว ๆ
//   2) ตัวนับฝั่ง client + ยิงถามเซิร์ฟเวอร์ครั้งเดียวตอนถึงเวลา = โหลดน้อยกว่าคนกด F5 รัวเป็นสิบครั้ง
//   3) ทุกคนปลดล็อกที่วินาทีเดียวกันตามนาฬิกา "เซิร์ฟเวอร์" ไม่ใช่ตามจังหวะที่ใครรีเฟรชเจอก่อน
//
// ⚠️ เวลาเป้าหมายมาจาก server เสมอ (ISO string) — ห้ามคำนวณสิทธิ์จากนาฬิกาเครื่องผู้ใช้
//    ตัวนับนี้เป็นแค่ "ตัวช่วยสายตา" ส่วนการตัดสินว่าเปิดหรือยัง server เป็นคนบอกตอน refetch

export type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
  done: boolean;
};

export function countdownParts(targetAt: Date, now: Date = new Date()): CountdownParts {
  const totalMs = Math.max(0, targetAt.getTime() - now.getTime());
  const totalSec = Math.floor(totalMs / 1000);
  return {
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
    totalMs,
    done: totalMs <= 0,
  };
}

// ข้อความนับถอยหลังแบบอ่านง่าย — เหลือเป็นวันก็บอกวัน, ใกล้แล้วค่อยลงรายละเอียดวินาที
//   (โชว์ "2 วัน 3 ชม." ตอนเหลือหลายวัน มีประโยชน์กว่าโชว์ 51:23:07 ที่อ่านยาก)
export function formatCountdown(targetAt: Date, now: Date = new Date()): string {
  const p = countdownParts(targetAt, now);
  if (p.done) return "ถึงเวลาแล้ว";
  const pad = (n: number) => String(n).padStart(2, "0");
  if (p.days > 0) return `${p.days} วัน ${p.hours} ชม.`;
  if (p.hours > 0) return `${p.hours}:${pad(p.minutes)}:${pad(p.seconds)} ชม.`;
  return `${p.minutes}:${pad(p.seconds)} นาที`;
}

// ความถี่ที่ควร tick — เหลือเป็นวันไม่ต้องเต้นทุกวินาที (ประหยัด re-render บนหน้าที่เปิดค้างทั้งวัน)
export function tickIntervalMs(targetAt: Date, now: Date = new Date()): number {
  const { totalMs } = countdownParts(targetAt, now);
  if (totalMs > 24 * 60 * 60 * 1000) return 60_000; // เหลือเกิน 1 วัน → นาทีละครั้ง
  return 1000;
}
