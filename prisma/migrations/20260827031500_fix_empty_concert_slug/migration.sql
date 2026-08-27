-- ซ่อมข้อมูล: คอนเสิร์ตที่ชื่อไทยล้วนถูกสร้างด้วย slug ว่าง "" (บั๊ก slugify ตัดอักษรไทยทิ้ง — 2026-08-27)
--   → เข้าหน้า /concerts/<slug> ไม่ได้เลย ตั้งให้เป็น concert-<id> ตามกติกาใหม่ใน lib/slug.ts
--   (slug เป็น UNIQUE จึงมีได้แถวเดียวที่ว่าง แต่เขียนแบบกวาดทั้งตารางเผื่อไว้)
UPDATE "concerts" SET "slug" = 'concert-' || "id" WHERE "slug" = '' OR "slug" IS NULL;
