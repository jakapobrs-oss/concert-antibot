-- CreateEnum
CREATE TYPE "QueueTokenStatus" AS ENUM ('WAITING', 'ADMITTED', 'EXPIRED', 'CONVERTED', 'LEFT');

-- CreateTable
CREATE TABLE "queue_tokens" (
    "id" BIGSERIAL NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "concertId" BIGINT NOT NULL,
    "userId" BIGINT,
    "fingerprintHash" VARCHAR(64),
    "ip" VARCHAR(45),
    "timeBucket" BIGINT NOT NULL,
    "randomScore" INTEGER NOT NULL,
    "status" "QueueTokenStatus" NOT NULL DEFAULT 'WAITING',
    "position" INTEGER,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "queue_tokens_token_key" ON "queue_tokens"("token");

-- CreateIndex
CREATE INDEX "queue_tokens_concertId_status_idx" ON "queue_tokens"("concertId", "status");

-- CreateIndex
CREATE INDEX "queue_tokens_token_idx" ON "queue_tokens"("token");

-- AddForeignKey
ALTER TABLE "queue_tokens" ADD CONSTRAINT "queue_tokens_concertId_fkey" FOREIGN KEY ("concertId") REFERENCES "concerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tokens" ADD CONSTRAINT "queue_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
