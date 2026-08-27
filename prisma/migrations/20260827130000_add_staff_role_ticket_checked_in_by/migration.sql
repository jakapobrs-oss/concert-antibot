-- rev 42: role STAFF (เจ้าหน้าที่หน้างาน สแกนเช็คอินอย่างเดียว) + บันทึกว่าใครสแกนบัตรใบไหน
-- สร้างจาก `prisma migrate diff --from-schema-datasource --to-schema-datamodel --script` (migrate dev ใช้ไม่ได้ใน shell แบบ non-interactive)
-- หมายเหตุ Postgres: ADD VALUE ให้ enum ใน transaction ได้ (PG ≥ 12) ตราบใดที่ไม่ใช้ค่านั้นใน migration เดียวกัน — ไฟล์นี้ไม่ใช้

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'STAFF';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "checkedInById" BIGINT;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
