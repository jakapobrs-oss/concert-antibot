-- ============================================================
-- Named Ticket (docs/19) + Check-in + Dynamic QR + Return/Refund + Codex #3
-- ============================================================
-- หมายเหตุเครื่อง dev (Windows): Application Control บล็อก prisma migrate
--   → ไฟล์นี้ถูก apply ด้วย psql ใน docker ตรงๆ + บันทึก _prisma_migrations ด้วยมือ
--   บนเครื่องอื่น/Vercel ใช้ prisma migrate deploy ตามปกติ (ALTER TYPE ADD VALUE
--   อยู่ใน tx ได้บน PG12+ ตราบใดที่ไม่ "ใช้" ค่าใหม่ใน tx เดียวกัน — ไฟล์นี้ไม่ใช้)

-- Codex #3: เงินเข้าแล้วแต่ออกตั๋วไม่ได้ → ต้องมีสถานะตามรอยใน DB
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND_REQUIRED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

-- Phase 1 (named ticket): ผู้ถือบัตรต่อที่นั่ง — commit ตอน checkout
ALTER TABLE "order_items" ADD COLUMN "holderUserId" BIGINT;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_holderUserId_fkey"
  FOREIGN KEY ("holderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "order_items_holderUserId_idx" ON "order_items"("holderUserId");

-- Ticket: snapshot ชื่อผู้ถือ + check-in + dynamic QR secret + สถานะคืนบัตร
ALTER TABLE "tickets" ADD COLUMN "holderName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "tickets" ADD COLUMN "checkedInAt" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN "qrSecret" TEXT NOT NULL DEFAULT '';
ALTER TABLE "tickets" ADD COLUMN "returnedAt" TIMESTAMP(3);

-- ตั๋วเก่าที่ออกก่อน migration: เติม qrSecret สุ่มให้ใช้ dynamic QR ได้ +
-- เติม holderName จากชื่อ/อีเมลของผู้ถือปัจจุบัน (userId)
UPDATE "tickets" SET "qrSecret" = md5(random()::text) || md5(random()::text) WHERE "qrSecret" = '';
UPDATE "tickets" t
SET "holderName" = COALESCE(u."name", u."email", '')
FROM "users" u
WHERE u."id" = t."userId" AND t."holderName" = '';

-- คืนบัตรแล้วที่นั่งเดิมต้องออกตั๋วใบใหม่ได้:
-- unique เปลี่ยนจาก "ตลอดชีพ" → "เฉพาะตั๋วที่ยังไม่ถูกคืน" (partial unique index)
DROP INDEX IF EXISTS "tickets_seatId_key";
CREATE INDEX "tickets_seatId_idx" ON "tickets"("seatId");
CREATE UNIQUE INDEX "tickets_seatId_active_key" ON "tickets"("seatId") WHERE "returnedAt" IS NULL;

-- ตารางคำขอคืนบัตร (refund ราคาหน้าบัตรให้ผู้ซื้อเดิม — admin กดยืนยันหลังโอนคืน)
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'REFUNDED');
CREATE TABLE "ticket_returns" (
    "id" BIGSERIAL NOT NULL,
    "ticketId" BIGINT NOT NULL,
    "orderId" BIGINT NOT NULL,
    "payerUserId" BIGINT NOT NULL,
    "holderUserId" BIGINT,
    "amount" DECIMAL(10,2) NOT NULL,
    "seatLabel" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_returns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ticket_returns_ticketId_key" ON "ticket_returns"("ticketId");
CREATE INDEX "ticket_returns_status_idx" ON "ticket_returns"("status");
ALTER TABLE "ticket_returns" ADD CONSTRAINT "ticket_returns_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_returns" ADD CONSTRAINT "ticket_returns_payerUserId_fkey"
  FOREIGN KEY ("payerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
