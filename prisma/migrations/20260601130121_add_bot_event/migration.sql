-- CreateEnum
CREATE TYPE "BotAction" AS ENUM ('ALLOW', 'CHALLENGE', 'BLOCK');

-- CreateTable
CREATE TABLE "bot_events" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT,
    "ip" VARCHAR(45),
    "userAgent" VARCHAR(500),
    "fingerprintHash" VARCHAR(64),
    "score" INTEGER NOT NULL,
    "action" "BotAction" NOT NULL,
    "signals" JSONB NOT NULL,
    "checkpoint" VARCHAR(50) NOT NULL DEFAULT 'queue_join',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_events_createdAt_idx" ON "bot_events"("createdAt");

-- CreateIndex
CREATE INDEX "bot_events_action_createdAt_idx" ON "bot_events"("action", "createdAt");
