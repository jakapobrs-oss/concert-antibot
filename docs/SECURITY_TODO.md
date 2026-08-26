# Security TODO — Optional / Future Items

รายการนี้รวบรวมจุดที่ตรวจพบในการ audit รอบแรก (2026-06) แต่เลือกเลื่อนออกไป
เพราะ risk ต่ำ, แก้ซับซ้อน, หรือต้องการ architectural decision ก่อน

---

## ระดับ Medium — ควรทำก่อน Go-Live

### 1. Bot score ไม่ถูกตรวจที่จุด Purchase — ✅ แก้แล้ว (2026-08-25)
- **ไฟล์**: `lib/antibot-purchase.ts` (ใหม่) · `app/actions/booking.ts` → `assessPurchaseForUser()`
  · `components/seat-map-svg.tsx` / `components/seat-map.tsx` (UI ยืนยัน)
- **ปัญหาเดิม**: Anti-bot score ถูกตรวจที่ queue join เท่านั้น บอทที่ผ่าน queue มาได้
  สามารถซื้อตั๋วได้โดยตรง (เช่น หาก token รั่ว)
- **ที่ทำจริง ต่างจาก "แนวทาง" ที่เขียนไว้เดิม — และทำไมถึงต่าง**:
  แนวทางเดิม ("ดึง `BotEvent` ล่าสุดของ userId มาเทียบ threshold") แทบไม่กันอะไรเลย
  เพราะด่านคิว (`app/api/queue/join/route.ts`) ปฏิเสธ 403 ทันทีเมื่อ BLOCK
  → ใครถือ queue token ที่ admit แล้ว ย่อมเคยได้ ALLOW (คะแนน < 40) มาก่อนเสมอ
  → อ่านคะแนนเก่ามาเทียบ ก็ผ่านทุกครั้ง
  ช่องที่เปิดอยู่จริงคือ **ตัวคำขอตอนกดซื้อไม่เคยถูกประเมิน** (คนเข้าคิวเป็นมนุษย์
  แล้วส่ง session ให้สคริปต์ยิงต่อ / สัญญาณ Layer 2 ที่เพิ่งติดตอนเลือกที่นั่งไม่มีใครอ่านซ้ำ)
  จึงประเมิน **คำขอนี้ใหม่** แทนการใช้ผลเก่า
- **สัญญาณที่ใช้** (`assessPurchase()`): UA + headers ของคำขอนี้ (น้ำหนักเดียวกับด่านคิว)
  · `BehaviorSession.isLikelyBot` (Layer 2) +30 · เคยโดน BLOCK ใน 30 นาที +45
  · Turnstile ที่ส่งมาแล้วไม่ผ่าน +55 · threshold เดียวกับด่านคิว (CHALLENGE 40 / BLOCK 70)
- **จุดที่จงใจต่างจากด่านคิว**: "ไม่ส่ง Turnstile token" = **0 คะแนน** ไม่ใช่ +40
  เพราะตอนกดซื้อไม่มี token ติดมือมาตั้งแต่แรก — ถ้ายืมกติกาด่านคิวมาตรง ๆ
  คนซื้อจริงจะโดน CHALLENGE ยกแผงบนเส้นทางเงิน
- **กันวนลูป**: ทำ Turnstile ผ่านสด ๆ → ปลด CHALLENGE เป็น ALLOW แต่ **ไม่ปลด BLOCK**
  (สคริปต์ก็ทำ Turnstile ผ่านได้ UA `python-requests` จึงยังต้องโดนบล็อก)
- **ไม่มีพารามิเตอร์ "ข้ามด่าน"**: server action ถูกเรียกจาก client ด้วยอาร์กิวเมนต์อะไรก็ได้
  จึงห้ามรับ flag ข้ามด่านจาก client เด็ดขาด
- **latency**: อ่าน DB 2 query แบบขนาน (`BotEvent` ล่าสุด + `BehaviorSession`)
  + ยิง Turnstile เฉพาะเมื่อมี token · การเขียน `BotEvent` (checkpoint `purchase`)
  อยู่ใน try/catch — บันทึก audit ล้มเหลวต้องไม่ทำให้ซื้อไม่ได้
- **index ที่เพิ่ม**: `bot_events(userId, createdAt)` + `behavior_sessions(userId, createdAt)`
  (migration `20260824190000_add_bot_event_user_idx`)
- **หลักฐาน**: `tests/unit/antibot-purchase.test.ts` 12 เทส (รวมเคส false positive)
  · `pnpm test:purchase-antibot` เทสบนเบราว์เซอร์จริง 7/7
  (คนจริงยังซื้อได้ / UA สคริปต์ถูกหยุดไม่ถึง checkout / มี BotEvent ลง DB / ที่นั่งไม่ถูกล็อกค้าง)
  · `pnpm test:seatmap-buyer` 27/27 ยืนยันว่าไม่ทำให้คนซื้อปกติพัง

### 2. Turnstile: ไม่ตรวจ `hostname` และ `action` — ✅ แก้แล้ว (2026-08-26)
- **ไฟล์**: `lib/turnstile.ts` → `verifyTurnstile(token, ip, expectation)` · `lib/turnstile-actions.ts` (ใหม่, pure)
  · `components/turnstile-widget.tsx` (prop `action` บังคับ) · `lib/antibot.ts` / `lib/antibot-purchase.ts` (ผู้เรียก)
- **ปัญหาเดิม**: Cloudflare ส่งคืน `hostname` (โดเมนที่ widget รัน) และ `action` (ชื่อที่ตั้งใน widget)
  แต่ไม่ได้ตรวจ → token ที่มนุษย์แก้ให้ที่ด่านคิว เอาไปยิงด่านซื้อได้ / token ที่แก้บนโดเมนอื่นยังผ่าน
- **ที่ทำจริง ต่างจาก "แนวทาง" เดิม — และทำไม**:
  - `action`: widget ทุกจุดตั้ง `action` (`queue_join` ที่ห้องรอ · `purchase` ที่ผังที่นั่ง 2 ตัว) เป็น prop **บังคับ**
    ใน `TurnstileWidget` (TypeScript บังคับให้จุดใหม่ต้องระบุ — widget ที่ไม่มี action จะถูก server ปฏิเสธ
    คนจริงแก้ challenge แล้วไม่ผ่าน) · server เทียบเป๊ะ: ไม่ตรง หรือ Cloudflare ไม่คืน action เลย = `action-mismatch`
  - `hostname`: **ไม่เพิ่ม env var** `TURNSTILE_EXPECTED_HOSTNAME` ตามแนวทางเดิม แต่เทียบกับ **`Host` header ของคำขอนี้**
    (normalize: ตัด port / lower-case / IPv6 `[::1]:3000`) — ไม่มีอะไรต้องตั้งบน prod, ใช้ได้ทั้ง `localhost:3000`
    และ `concert-antibot.vercel.app` โดยไม่ต้องแก้ค่า, ไม่มีทาง misconfig (ตั้ง env ผิด = คนจริงเข้าไม่ได้ทั้งเว็บ)
    ไม่ทราบ Host (null) = ข้ามเช็คโดเมน แต่ยังเช็ค action
  - ไม่ผ่าน 2 ข้อนี้ = `success:false` → ผู้เรียกนับเป็น "Turnstile fail" (+55) เหมือน token ปลอม — ไม่มี path ใหม่
  - **dev mode (test key ของ Cloudflare) ข้ามเช็ค 2 ข้อ** — test key คืน hostname/action ค่าตายตัวของ Cloudflare ไม่ใช่ของเรา
    (คีย์จริงใน `.env` ของเครื่อง dev → เช็คทำงานบน localhost ด้วย)
- **ข้อจำกัด / ข้อระวัง**:
  - ยืนยันด้วย unit test (mock siteverify) เท่านั้น — **ยังไม่ได้เห็น token จริงผ่านด่านนี้** เพราะสคริปต์แก้ Turnstile
    คีย์จริงไม่ได้ (ตั้งใจไม่ bypass) และห้องรอต้อง login → เช็คมือหลัง deploy: เข้าคิวคอนเสิร์ตจริง 1 ครั้ง
    ต้องเข้าคิวได้ ไม่ใช่จอ "ตรวจพบกิจกรรมผิดปกติ"; ถ้าพัง `BotEvent` จะมี `errorCodes: action-mismatch`/`hostname-mismatch`
  - ช่วง deploy: แท็บที่เปิดค้างด้วย bundle เก่า (widget ไม่มี action) จะแก้ challenge ไม่ผ่านจนกว่าจะรีเฟรช — ชั่วคราว
  - โดเมน preview ของ Vercel ต้องอยู่ใน hostname allowlist ของ Turnstile ถึงจะ render widget ได้ (เรื่องเดิม ไม่ใช่ของ fix นี้)
- **หลักฐาน**: `tests/unit/turnstile.test.ts` (ใหม่ 14) · `antibot.test.ts` +1 · `antibot-purchase.test.ts` +2 · typecheck 0

### 3. payerKey fallback ใช้ชื่อผู้โอน — ✅ แก้แล้ว (2026-08-26) แบบ "ธนาคาร:ชื่อ"
- **ไฟล์**: `lib/payer-key.ts` → `computePayerKey({ senderAccount, senderName, senderBank })`
  · `lib/easyslip.ts` (map `sender.bank.id` → `senderBank`) · `app/actions/booking.ts` (ส่งต่อ)
- **ปัญหาเดิม**: สลิปที่ไม่มีเลขบัญชี/พร็อกซีผู้จ่าย fallback ใช้ "ชื่อผู้โอน" เป็นคีย์ per-payer cap
  → คนชื่อ-นามสกุลซ้ำกันชนคีย์ → ผู้ซื้อจริงคนที่สองโดน `PAYER_LIMIT` ผิดคน (ต้องคืนเงิน)
- **ที่ทำจริง ต่างจาก "แนวทาง" เดิม — และทำไม**: แนวทางเดิม (ใช้ `transRef`) **ใช้ไม่ได้กับงานนี้**
  เพราะ transRef unique ต่อธุรกรรม → ทุกสลิปกลายเป็น "ผู้จ่ายคนใหม่" cap ไม่นับสะสม = เท่ากับไม่มี cap
  (transRef ถูกใช้กันสลิปซ้ำอยู่แล้วที่ `Payment.slipRef UNIQUE` — คนละหน้าที่)
  ทางเลือกที่ชั่งแล้ว:
  - **A (เลือก)**: คีย์ `name:<รหัสธนาคารต้นทาง>:<ชื่อ>` — ชื่อเดียวกันคนละธนาคาร = คนละผู้จ่าย;
    ชื่อเดียวกัน+ธนาคารเดียวกัน+สลิปไม่มีเลขบัญชีเลย ยังชนได้ (ยอมรับ: โอกาสน้อยมาก และผลคือ "คืนเงิน"
    ซึ่งกู้คืนได้ + มี `REFUND_REQUIRED` ใน DB)
  - B (ไม่เอา): สลิปไม่มีเลขบัญชี = ข้าม cap — ขบวนการบอท **เลือก** ช่องทางจ่ายที่สลิปไม่โชว์เลขบัญชี
    แล้วหลุด cap ได้ทั้งขบวน (บอทเลือกได้ เราแก้ทีหลังไม่ได้) → ปล่อยบัตรถึงมือ scalper = กู้คืนไม่ได้
  - ไม่มี senderBank (สลิปไม่บอก) → รูปแบบเดิม `name:<ชื่อ>` (ยังบังคับ cap) · มีเลขบัญชี → `acct:` เหมือนเดิม
- **ข้อระวัง**: รูปแบบคีย์ fallback เปลี่ยน — แถว `payments.payerKey` เก่าที่เป็น `name:<ชื่อ>` จะไม่นับรวมกับคีย์ใหม่
  ของผู้จ่ายเดียวกัน (prod ยังไม่มีการขายจริง = ไม่มีแถวแบบนี้) · ไม่แตะ schema/migration
- **หลักฐาน**: `tests/unit/payer-key.test.ts` +5 · `easyslip.test.ts` +1 (map `sender.bank.id` → fallback `short`)

### 4. Amount comparison ควรเป็น integer satang — ✅ แก้แล้ว (2026-08-26)
- **ไฟล์**: `lib/money.ts` (ใหม่, pure: `toSatang` / `sameAmount`) · `app/actions/booking.ts` → `submitSlip()`
  (จุดเทียบยอดจริงอยู่ที่นี่ ไม่ใช่ `order-finalize.ts` ตามที่เขียนไว้เดิม)
- **ปัญหาเดิม**: `verify.amount !== expectedAmount` เทียบ float (EasySlip) กับ `Number(Decimal.toString())` ตรง ๆ
  → drift เช่น 1500.0000000001 ≠ 1500 ปฏิเสธคนจ่ายถูกยอด
- **ที่ทำจริง**: แปลงทั้งสองฝั่งเป็นสตางค์จำนวนเต็ม (`Math.round(x * 100)`) แล้วเทียบ · tolerance ยัง 0 (ต่าง 1 สตางค์ = ไม่ตรง)
  · ยอดที่ขาด/อ่านไม่ได้ (`undefined`/`NaN`/สตริงไม่ใช่ทศนิยม) = **ไม่ตรง** (fail-closed)
  · EasySlip คืนหน่วย **บาท** (`data.amount.amount` เช่น 1500) — ตรวจแล้วจาก shape ที่ `lib/easyslip.ts` map อยู่
- **บั๊กที่เทสจับได้ระหว่างทำ (บันทึกไว้กันทำซ้ำ)**: ร่างแรกใช้ `Number(String(x))` → `Number("") === 0`
  = สลิปที่อ่านยอดไม่ได้กลายเป็น "0 บาท" (fail-open) → บังคับ string ต้องเป็นทศนิยมล้วน `^-?\d+(\.\d+)?$`
  (ตัด `""`, `"1,500"`, `"1e3"`, `"0x10"`) ก่อน `Number()`
- **ข้อระวัง**: ยอดรวม order ตอนสร้าง (`lib/order-finalize.ts` `createOrder…` บวก `Number(price)` เป็น float
  แล้วเก็บ Decimal(10,2)) ยังเป็น float-sum — ไม่แตะในรอบนี้ (Postgres ปัดเป็น 2 ตำแหน่งตอนเขียน จึงไม่กระทบการเทียบ)
- **หลักฐาน**: `tests/unit/money.test.ts` (ใหม่ 6 เทส รวมเคส `""`/`"0x10"`/NaN) · `pnpm test:seatmap-buyer` +
  `pnpm test:purchase-antibot` (เบราว์เซอร์จริง) ยังผ่านหลังแก้

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

### 10. CSP ยังผ่อน `'unsafe-inline'` — อัปเกรดเป็น nonce-based
- **ไฟล์**: `next.config.ts` → `headers()` (มี CSP header แล้วตั้งแต่รอบ hardening)
- **ปัญหา**: Next.js 15 inject inline script ตอน hydration → ต้องผ่อน `'unsafe-inline'`
  ใน `script-src`/`style-src` ทำให้ CSP กัน XSS แบบ inline injection ไม่ได้
  (ยังได้ประโยชน์จาก `object-src 'none'`, `base-uri 'self'`, จำกัด `frame-src` เฉพาะ Turnstile)
- **แนวทาง**: generate nonce ต่อ request ใน `middleware.ts` แล้วส่งผ่าน header ให้ Next
  แปะใน inline script → ตัด `'unsafe-inline'` ออกจาก `script-src`
- **ข้อระวัง**: ต้อง test กับ Turnstile widget + inline style ของ Tailwind/shadcn
- **ที่มา**: บันทึกจากรีวิว Codex §7 Infra (2026-07-10) · รายละเอียดใน `18_SECURITY_AUDIT.md` §CSP

---

## บันทึกการตัดสินใจ (accepted decisions — ไม่ใช่บั๊กค้าง แต่บันทึกกันลืมเหตุผล)

### D1. Payment ถูกลบแบบลูกโซ่เมื่อ Order ถูกลบ (`ON DELETE CASCADE`)
- **ไฟล์**: `prisma/schema.prisma` → model `Payment` (`orderId` relation, `onDelete: Cascade`)
- **พฤติกรรม**: ลบแถว `Order` → แถว `Payment` (หลักฐานการจ่าย + สลิป base64) หายตามทันที
  ต่างจาก `Ticket` ที่เป็น `Restrict` (มีตั๋วอยู่จะลบ order ไม่ได้)
- **ทำไมยอมรับได้ตอนนี้**: ไม่มี code path ใน production ที่ลบ `Order` เลย
  (ตรวจแล้ว 2026-07-16: `order.delete/deleteMany` มีเฉพาะใน test scripts `scripts/test-*.ts`) —
  order ที่หมดอายุ/ยกเลิกใช้ `status: CANCELLED` ไม่ใช่การลบแถว ประวัติการเงินจึงไม่หายใน flow จริง
- **ก่อนขายจริง**: ควรเปลี่ยนเป็น `onDelete: Restrict` หรือ soft-delete
  เพื่อการันตี audit trail การเงินระดับ schema (ผูกกับข้อกำหนดเก็บหลักฐานธุรกรรม/PDPA)
- **ที่มา**: รีวิว Codex §7 Infra (2026-07-10) · อ้างถึงใน `HANDOFF-security-chapter-for-thesis.md` §ข้อจำกัด

---

## หมายเหตุ

- รายการนี้ไม่ครอบคลุม business logic bug — ดู `docs/17_GO_LIVE_CHECKLIST.md` แทน
- "Must-fix" items ทั้งหมดถูกแก้ไขแล้วใน PR #2 (branch `claude/charming-wright-nrjj40`)
- อัปเดตไฟล์นี้เมื่อทำรายการเสร็จ หรือเมื่อค้นพบจุดใหม่
