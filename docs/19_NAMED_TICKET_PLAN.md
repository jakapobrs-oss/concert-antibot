# 19 — Named Ticket Plan (กัน scalper ด้วยบัตรผูกชื่อ)

> สถานะ: **✅ Implement ครบ 3 phase แล้ว (2026-07-04)** — Open Questions ตอบครบ (ดูหัวข้อ "คำตอบที่เคาะแล้ว")
> ของจริงที่ลง: schema (`20260703150000_named_ticket_checkin_qr_refund`), actions (`booking.ts:assignHolder/clearHolder`, `tickets.ts`), UI (checkout/tickets/admin checkin/admin refunds), lib (`holder-policy.ts`, `entry-code.ts`)

## เป้าหมาย & ขอบเขตปัญหา
แก้: **scalper/บอทกดบัตรไปขายเก็งกำไร** (บางใบ +2 เท่า) → คนอยากดูจริงไม่ได้บัตร
**ไม่**แก้ (และไม่ตั้งใจแก้): การกดแย่งตอนเปิดขาย / บอทกดเร็ว — อันนั้น anti-bot + คิว FCFS เดิมคุมอยู่ คงไว้

หลักคิด: เลิก "พิสูจน์ว่าเป็นแฟน" (quiz ศิลปิน = google ได้ + กันแฟนจริงพลาด) → **ตัดแรงจูงใจคนที่ไม่ใช่แฟน**: บัตรขายต่อไม่ได้ → scalper กดไปก็ขายไม่ออก = ติดมือ → รอบหน้าเลิกกดเอง (demand ปลอมค่อยๆ หาย)

## ทางที่พิจารณาแล้ว "ตัดทิ้ง" — อย่าเสนอซ้ำ
- **Group/ballot/window-batch แทน FCFS** → user เลือกคง FCFS เดิม (reuse งานที่ test ผ่าน 7/7)
- **Lottery สุ่ม** → แฟร์แบบ "โอกาสเท่ากัน" แต่ไม่ตอบ "คนอยากได้จริงได้"
- **Free transfer (โอนให้เพื่อน)** → = ช่องเดียวกับ resale scalper ("ให้เบอร์แล้วโอนกันเอง")
- **Resale คืนระบบ + นัดเวลากดรับ** → = transfer อำพราง (scalper นัดลูกค้ากดรับได้ + รับมือ race ดีกว่าเพื่อนจริงเพราะมี bot)
- **เติมชื่อผู้ถือทีหลัง / ก่อนงาน X ชม.** → = transfer อำพราง

### 🔑 กฎเหล็ก (หลักการแกน — ห้ามละเมิดตอนออกแบบต่อ)
**"ส่งบัตรถึงคนเจาะจง หลังกดได้แล้ว" = ความสามารถเดียวกับที่ scalper ต้องการ** ระบบแยกเพื่อนจริงกับลูกค้า scalper ไม่ออก → ทุกกลไกที่ให้ "เล็งผู้รับหลังกด" เปิดช่อง scalper เสมอ
→ ทางแก้เดียว: **commit ผู้ถือ ณ ตอนซื้อ** (ตอนนั้น scalper ยังไม่มีลูกค้าจะใส่ชื่อใคร)

## Scope สุดท้าย (3 มาตรการ + ไม่มีโอน/resale)
1. **ล็อกชื่อผู้ถือกับบัตร** — commit ตอน checkout แก้ไม่ได้
2. **Dynamic QR** — หมุนทุก ~30 วิในแอป กันแชร์ภาพหน้าจอ
3. **Check-in กันใช้ซ้ำ** — 1 บัตรสแกนเข้าได้ครั้งเดียว
- เสริม: ตรวจชื่อ↔บัตรประชาชนด้วยตาหน้างาน (spot-check ได้ เพราะ #2/#3 กัน QR แชร์แล้ว → คิวไม่ตัน)
- ⚠️ จุดอ่อนที่ต้องยอมรับ: ความ "หายจริง" ของปัญหาอยู่ที่ **หน้างานตรวจ ID จริงไหม** (trust boundary ย้ายออกนอกโค้ด)

## ✅ คำตอบที่เคาะแล้ว (user ตอบ 2026-07-03)
1. **ผู้ถือต้องมีบัญชี** — ระบุด้วยเบอร์/อีเมลของบัญชีที่ verify แล้ว + user เพิ่มเงื่อนไข **อายุบัญชีขั้นต่ำ ~1 เดือน** (env `HOLDER_MIN_ACCOUNT_AGE_DAYS=30`, 0=ปิดตอน dev) — กัน scalper ให้ลูกค้าสมัครบัญชีใหม่มารับบัตร. เสริมด้วย **เพดานรับบัตรฝั่งผู้ถือ** ต่อคอนเสิร์ต (นับข้ามทุกผู้ซื้อ ใช้ `maxTicketsPerUser` เดียวกัน) + ชื่อจริงบนบัญชีต้องมี (ใช้เทียบบัตร ปชช.)
   - หมายเหตุ: แนวคิด "ต้องเป็นเพื่อนกัน 1 เดือน" (friend graph) แลกกับต้องสร้างระบบเพื่อน → ใช้ "อายุบัญชี" เป็น costly signal แทน (ผลใกล้กัน เบากว่ามาก)
2. **ไม่ตัด resale เกลี้ยง — เพิ่ม "ช่องคืนบัตรเข้าระบบ"** (เบี่ยงจากแผนเดิม แต่ไม่ละเมิดกฎเหล็ก):
   - ผู้ซื้อคืนบัตร → ที่นั่งกลับ **pool กลาง** ขายผ่านคิว+anti-bot ปกติ → **ผู้คืนเลือกผู้รับไม่ได้** = ไม่ใช่ transfer อำพราง
   - เงินคืน **ราคาหน้าบัตร** ให้ผู้ซื้อเดิม (ผ่านหน้า admin refunds — โอนมือแล้วกดปิดงาน) → scalper ไม่มีกำไรจากช่องนี้
   - เส้นตายคืน: env `RETURN_CUTOFF_HOURS=24` ชม.ก่อนงาน; ตั๋วเช็คอินแล้วคืนไม่ได้

## แผน Implement (3 phase, test แยกได้)

### Phase 1 — Named ticket (คุณค่าหลัก: กัน scalper)
- **schema** (`prisma/schema.prisma`): `OrderItem.holderUserId BigInt?` (+relation User), `Ticket.holderName String` (snapshot ชื่อตอนออกตั๋ว)
- **flow**:
  - checkout: action ใหม่ `assignHolders(orderId, [{itemId, holderUserId}])` — ค้นบัญชีด้วยเบอร์/อีเมล, ต้อง verified, default = ผู้ซื้อ, ต้องครบทุกใบก่อนเปิดปุ่มจ่าย
  - `lib/order-finalize.ts` `finalizePaidOrder`: ออกตั๋ว `Ticket.userId = item.holderUserId ?? purchaserUserId` (Order.userId=ผู้ซื้อคงเดิม, Ticket.userId=ผู้ถือ) + set `holderName`
  - `account/tickets` page: query by userId อยู่แล้ว → ผู้ถือเห็นบัตรตัวเองอัตโนมัติ + แสดง holderName
- **ไฟล์ที่แตะ**: schema.prisma, app/actions/booking.ts (+action assignHolders), app/(public)/checkout/[orderId]/page.tsx + components/checkout-client, lib/order-finalize.ts, app/(public)/account/tickets/page.tsx
- **ไม่แตะ**: per-payer cap, payment/slip flow, queue, seat-hold

### Phase 2 — Check-in (บังคับใช้บัตรหน้างานได้จริง)
- **schema**: `Ticket.checkedInAt DateTime?`; role `STAFF` (เพิ่มใน enum UserRole หรือใช้ ADMIN)
- หน้า staff scan ใหม่ + action `checkInTicket`: verify → ถ้า `checkedInAt != null` = reject (กันใช้ซ้ำ) → set checkedInAt → คืน holderName ให้ จนท.เทียบบัตร ปชช.

### Phase 3 — Dynamic QR (กันแชร์ภาพ QR)
- **schema**: `Ticket.qrSecret String` (สุ่มตอนออกตั๋ว)
- `account/tickets`: แทน static QR → rotating: client poll action `getEntryCode(ticketId)` ทุก ~25 วิ → server คืน code = `HMAC(qrSecret, timeWindow30s)` → render QR
- จุดสแกน verify: HMAC ตรง time window ปัจจุบัน (±1 window กัน clock skew) + check-in
- ⚠️ อย่าส่ง qrSecret ไป client — ให้ server gen code เท่านั้น

## หมายเหตุ technical
- Stack: Next 15 App Router + Server Actions, Prisma 6 + Postgres 16, Redis (queue/seat-hold), NextAuth v5
- จุดเชื่อม schema เดิมที่ใช้ได้เลย: `Order.userId`=ผู้ซื้อ (มีอยู่), `Ticket.userId`→ใช้เป็น "ผู้ถือ", `User.phone`/`email` (มีอยู่)
- ⚠️ machine gotcha: Application Control บล็อก Prisma migrate/seed บนเครื่องนี้ (runtime ปกติ) — ดู memory `project_concert_payment`
