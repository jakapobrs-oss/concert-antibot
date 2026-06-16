# Security TODO — Optional / Future Items

รายการนี้รวบรวมจุดที่ตรวจพบในการ audit รอบแรก (2026-06) แต่เลือกเลื่อนออกไป
เพราะ risk ต่ำ, แก้ซับซ้อน, หรือต้องการ architectural decision ก่อน

---

## ระดับ Medium — ควรทำก่อน Go-Live

### 1. Bot score ไม่ถูกตรวจที่จุด Purchase
- **ไฟล์**: `app/actions/booking.ts` → `holdAndCreateOrder()`
- **ปัญหา**: Anti-bot score ถูกตรวจที่ queue join เท่านั้น บอทที่ผ่าน queue มาได้
  สามารถซื้อตั๋วได้โดยตรง (เช่น หาก token รั่ว)
- **แนวทาง**: ดึง `BotEvent` ล่าสุดของ userId ก่อน hold seat
  ถ้า score สูงเกิน threshold → reject พร้อม `action: "CHALLENGE"`
- **ข้อระวัง**: เพิ่ม latency ~5–10ms (DB read), ต้องกำหนด threshold ให้ดี
  กัน false positive กับคนซื้อตั๋วปกติ

### 2. Turnstile: ไม่ตรวจ `hostname` และ `action`
- **ไฟล์**: `lib/antibot.ts` → `verifyTurnstile()`
- **ปัญหา**: Cloudflare ส่งคืน `hostname` (ชื่อโดเมนที่ widget แสดง) และ `action`
  (ชื่อที่ set ใน widget) แต่ปัจจุบันไม่ได้ตรวจ → token ที่สร้างบน subdomain อื่น
  หรือ action อื่นยังผ่านได้
- **แนวทาง**:
  ```ts
  if (result.hostname !== process.env.TURNSTILE_EXPECTED_HOSTNAME) throw ...
  if (result.action !== "queue_join") throw ...
  ```
- **ข้อระวัง**: ต้องตั้ง `data-action` ในทุก widget และเพิ่ม env var

### 3. payerKey fallback ใช้ชื่อผู้โอน
- **ไฟล์**: `lib/order-finalize.ts`
- **ปัญหา**: ถ้า bank slip ไม่มี promptpay proxy number, fallback ใช้ชื่อผู้โอน
  เป็น key → คนชื่อเดียวกันอาจชนกัน (จ่ายด้วย slip คนละใบแต่ถูก dedup)
- **แนวทาง**: บันทึก `transactionRef` จาก EasySlip แทน (unique ต่อ transaction)
  หรือ composite key `senderName:amount:date`
- **ข้อระวัง**: EasySlip API ต้องคืน ref เสมอ — ตรวจสอบ response schema ก่อน

### 4. Amount comparison ควรเป็น integer satang
- **ไฟล์**: `lib/order-finalize.ts`
- **ปัญหา**: เปรียบเทียบ `slipAmount` (float) กับ `order.totalAmount` (Decimal)
  อาจมี floating-point drift (เช่น 1500.0 ≠ 1500.0000001)
- **แนวทาง**: แปลงทั้งสองเป็น integer satang (`Math.round(x * 100)`) ก่อนเปรียบเทียบ
- **ข้อระวัง**: ต้องตรวจว่า EasySlip ส่งกลับเป็น THB หรือ satang ก่อน

---

## ระดับ Low — ทำได้ แต่ไม่เร่ง

### 5. Dead field: `trustScore` ใน Prisma schema
- **ไฟล์**: `prisma/schema.prisma` → model `User`
- **ปัญหา**: field นี้ถูกเพิ่มไว้แต่ไม่มีโค้ดใดอ่านหรือเขียน
- **แนวทาง**: `prisma migrate dev` เพื่อ drop column หรือ repurpose เป็น aggregate bot score
- **ข้อระวัง**: ต้อง migrate production DB ด้วย → วางแผน downtime

### 6. `admitNext` — atomicity ของ pipeline
- **ไฟล์**: `lib/queue.ts` → `admitNext()`
- **ปัญหา**: ใช้ `redis.pipeline()` แต่ `ZRANGEBYSCORE` → loop → `ZADD` ไม่ atomic
  ถ้า process crash กลางทาง token บางอันอาจอยู่ใน WAITING ค้าง
- **แนวทาง**: เขียน Lua script รวม ZRANGEBYSCORE + HSET + ZADD ให้ atomic
- **ข้อระวัง**: Lua script ซับซ้อนขึ้น, ต้อง test กับ Redis Cluster ด้วย (EVALSHA)

### 7. Ghost token ใน queue ZSET
- **ไฟล์**: `lib/queue.ts`
- **ปัญหา**: token ที่หมดอายุ (1 ชม) ยังอยู่ใน `queue:{concertId}:waiting` ZSET
  ทำให้ position แสดงไม่ถูกต้อง (นับ ghost token เป็น slot)
- **แนวทาง**: เพิ่ม cleanup step ใน `admitNext()` โดย ZREMRANGEBYSCORE ที่ expiresAt < now
  หรือ run background job ทุก 5 นาที
- **ข้อระวัง**: ต้องเก็บ expiresAt ใน ZSET score หรือ hash metadata

### 8. HoldSeats loop ไม่ atomic
- **ไฟล์**: `lib/seat-hold.ts` → `holdSeats()`
- **ปัญหา**: loop `SET NX` ทีละที่นั่งใน pipeline — ถ้า seat แรก SET ได้ แต่ seat สอง
  ล้มเหลว (ถูก hold ไปแล้ว) → seat แรกค้างอยู่โดยไม่มีคนถือ (จนหมด TTL)
- **แนวทาง**: Lua script ตรวจ all-or-nothing: ถ้า NX ล้มเหลวแม้อันเดียว → undo ทั้งหมด
  แล้ว return fail
- **ข้อระวัง**: Lua script ใหญ่ขึ้น, ต้อง benchmark vs. current approach

### 9. HSTS preload (production)
- **ไฟล์**: `next.config.ts`
- **ปัญหา**: ปัจจุบัน `Strict-Transport-Security` ไม่มี `preload` directive
- **แนวทาง**: เพิ่ม `; preload` แล้ว submit domain ที่ hstspreload.org
- **ข้อระวัง**: เมื่อ submit แล้วถอดออกยาก — ทำเฉพาะเมื่อมั่นใจว่า HTTPS permanent

---

## หมายเหตุ

- รายการนี้ไม่ครอบคลุม business logic bug — ดู `docs/17_GO_LIVE_CHECKLIST.md` แทน
- "Must-fix" items ทั้งหมดถูกแก้ไขแล้วใน PR #2 (branch `claude/charming-wright-nrjj40`)
- อัปเดตไฟล์นี้เมื่อทำรายการเสร็จ หรือเมื่อค้นพบจุดใหม่
