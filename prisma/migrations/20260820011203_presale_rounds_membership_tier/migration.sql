-- CreateEnum
CREATE TYPE "MembershipTier" AS ENUM ('STANDARD', 'PREMIUM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SaleRoundAudience" ADD VALUE 'FANCLUB';
ALTER TYPE "SaleRoundAudience" ADD VALUE 'PARTNER';

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "tier" "MembershipTier" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "sale_rounds" ADD COLUMN     "maxTicketsPerUser" INTEGER,
ADD COLUMN     "preRegisterEndAt" TIMESTAMP(3),
ADD COLUMN     "preRegisterStartAt" TIMESTAMP(3),
ADD COLUMN     "requiresPreRegistration" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "seatQuota" INTEGER;

-- CreateTable
CREATE TABLE "pre_registrations" (
    "id" BIGSERIAL NOT NULL,
    "saleRoundId" BIGINT NOT NULL,
    "userId" BIGINT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_codes" (
    "id" BIGSERIAL NOT NULL,
    "saleRoundId" BIGINT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "label" VARCHAR(100),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_code_redemptions" (
    "id" BIGSERIAL NOT NULL,
    "accessCodeId" BIGINT NOT NULL,
    "userId" BIGINT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_code_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pre_registrations_code_key" ON "pre_registrations"("code");

-- CreateIndex
CREATE INDEX "pre_registrations_saleRoundId_idx" ON "pre_registrations"("saleRoundId");

-- CreateIndex
CREATE UNIQUE INDEX "pre_registrations_saleRoundId_userId_key" ON "pre_registrations"("saleRoundId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "access_codes_code_key" ON "access_codes"("code");

-- CreateIndex
CREATE INDEX "access_codes_saleRoundId_idx" ON "access_codes"("saleRoundId");

-- CreateIndex
CREATE INDEX "access_code_redemptions_userId_idx" ON "access_code_redemptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "access_code_redemptions_accessCodeId_userId_key" ON "access_code_redemptions"("accessCodeId", "userId");

-- AddForeignKey
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_saleRoundId_fkey" FOREIGN KEY ("saleRoundId") REFERENCES "sale_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_saleRoundId_fkey" FOREIGN KEY ("saleRoundId") REFERENCES "sale_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_code_redemptions" ADD CONSTRAINT "access_code_redemptions_accessCodeId_fkey" FOREIGN KEY ("accessCodeId") REFERENCES "access_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_code_redemptions" ADD CONSTRAINT "access_code_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
