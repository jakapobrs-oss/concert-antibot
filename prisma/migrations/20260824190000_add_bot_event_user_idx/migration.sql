-- ด่าน bot-score ตอนกดซื้อ (SECURITY_TODO #1) ค้นหา BotEvent ล่าสุดของ user บนเส้นทางเงิน
-- CreateIndex
CREATE INDEX "bot_events_userId_createdAt_idx" ON "bot_events"("userId", "createdAt");

-- ด่านเดียวกันอ่านสัญญาณ Layer 2 ด้วย userId (ตอนกดซื้อไม่มี fingerprint ติดมือมา)
-- CreateIndex
CREATE INDEX "behavior_sessions_userId_createdAt_idx" ON "behavior_sessions"("userId", "createdAt");
