// slug ของคอนเสิร์ต (ส่วนท้าย URL /concerts/<slug>) — pure ไม่แตะ DB ให้ unit test ได้
//
// บั๊ก 2026-08-27: ชื่อคอนเสิร์ตภาษาไทยล้วน ("คอนพี่เจี๊ยบ") → slug ว่างเปล่า ""
//   → การ์ดในหน้า /concerts ลิงก์ไป "/concerts" (หน้ารายการเดิม) กดเข้าคอนเสิร์ตไม่ได้เลย
//   ทั้งที่ป้ายขึ้น "กำลังขาย" — สาเหตุคือ slugify เดิมตัดทุกอักขระที่ไม่ใช่ [A-Za-z0-9_] ทิ้งหมด
//
// นโยบาย: slug เป็น ASCII เท่านั้น (a-z 0-9 dash) เพื่อให้ URL/QR/ลิงก์แชร์เสถียร
//   ชื่อไทยล้วนหรือมีแต่สัญลักษณ์ → ใช้ slug สำรอง "concert-<id>" (ดู resolveConcertSlug)

// แปลงชื่อ → slug ASCII (ตัดวรรณยุกต์/อักษรไทย/สัญลักษณ์ทิ้ง, ช่องว่าง → dash)
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // ตัดอักขระพิเศษ (รวมอักษรไทย เพราะ \w = ASCII เท่านั้น)
    .replace(/[\s_-]+/g, "-") // space/underscore → dash
    .replace(/^-+|-+$/g, "");
}

// slug สำรองเมื่อชื่อแปลงเป็น ASCII ไม่ได้ — ผูกกับ id จึงไม่ซ้ำแน่นอน
export function fallbackSlug(id: bigint | number | string): string {
  return `concert-${id.toString()}`;
}

// ตัดสิน slug สุดท้ายของคอนเสิร์ตที่เพิ่งสร้าง (มี id แล้ว)
//   - ชื่อแปลงได้ + ยังไม่มีใครใช้ → ใช้ตามชื่อ
//   - ชื่อแปลงได้ แต่ซ้ำกับคอนเสิร์ตอื่น → เติม -<id> ต่อท้าย (deterministic ไม่ใช่ timestamp)
//   - ชื่อแปลงไม่ได้ (ไทยล้วน/สัญลักษณ์ล้วน) → concert-<id>
export function resolveConcertSlug(params: {
  title: string;
  id: bigint | number | string;
  slugTaken: boolean;
}): string {
  const base = slugifyTitle(params.title);
  if (!base) return fallbackSlug(params.id);
  if (params.slugTaken) return `${base}-${params.id.toString()}`;
  return base;
}
