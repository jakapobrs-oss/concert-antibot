-- CreateTable
CREATE TABLE "behavior_sessions" (
    "id" BIGSERIAL NOT NULL,
    "sessionKey" VARCHAR(64) NOT NULL,
    "userId" BIGINT,
    "mouseMoveCount" INTEGER NOT NULL DEFAULT 0,
    "keyPressCount" INTEGER NOT NULL DEFAULT 0,
    "mouseTimingVariance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mousePathEntropy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dwellTimeMs" INTEGER NOT NULL DEFAULT 0,
    "behaviorScore" INTEGER NOT NULL DEFAULT 0,
    "isLikelyBot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "behavior_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "behavior_sessions_sessionKey_key" ON "behavior_sessions"("sessionKey");

-- CreateIndex
CREATE INDEX "behavior_sessions_sessionKey_idx" ON "behavior_sessions"("sessionKey");

-- CreateIndex
CREATE INDEX "behavior_sessions_createdAt_idx" ON "behavior_sessions"("createdAt");
