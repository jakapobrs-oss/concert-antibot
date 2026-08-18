-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "MembershipSource" AS ENUM ('SELF_SIGNUP', 'ADMIN_GRANT');

-- CreateEnum
CREATE TYPE "SaleRoundAudience" AS ENUM ('MEMBER_ONLY', 'PUBLIC');

-- AlterTable
ALTER TABLE "concerts" ADD COLUMN     "layoutImageBase64" TEXT,
ADD COLUMN     "layoutImageHeight" INTEGER,
ADD COLUMN     "layoutImageWidth" INTEGER;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "saleRoundId" BIGINT;

-- AlterTable
ALTER TABLE "seats" ADD COLUMN     "x" DOUBLE PRECISION,
ADD COLUMN     "y" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "zones" ADD COLUMN     "polygon" JSONB;

-- CreateTable
CREATE TABLE "memberships" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "MembershipSource" NOT NULL DEFAULT 'SELF_SIGNUP',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "grantedByUserId" BIGINT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_rounds" (
    "id" BIGSERIAL NOT NULL,
    "concertId" BIGINT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "audience" "SaleRoundAudience" NOT NULL DEFAULT 'PUBLIC',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_key" ON "memberships"("userId");

-- CreateIndex
CREATE INDEX "memberships_status_expiresAt_idx" ON "memberships"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "sale_rounds_concertId_startAt_idx" ON "sale_rounds"("concertId", "startAt");

-- CreateIndex
CREATE INDEX "orders_saleRoundId_idx" ON "orders"("saleRoundId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_saleRoundId_fkey" FOREIGN KEY ("saleRoundId") REFERENCES "sale_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_rounds" ADD CONSTRAINT "sale_rounds_concertId_fkey" FOREIGN KEY ("concertId") REFERENCES "concerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
