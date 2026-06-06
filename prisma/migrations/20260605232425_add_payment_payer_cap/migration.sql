-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "payerKey" VARCHAR(255),
ADD COLUMN     "senderAccount" VARCHAR(255);

-- CreateIndex
CREATE INDEX "payments_payerKey_idx" ON "payments"("payerKey");
