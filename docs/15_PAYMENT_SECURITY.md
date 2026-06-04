# 15 — Payment Security: ระดับความปลอดภัยของการตรวจจ่ายเงิน

> ต่อยอดจาก [10_PAYMENT_PROVIDERS.md](10_PAYMENT_PROVIDERS.md) (ฝั่ง "แผน/provider")
> ไฟล์นี้ = "ความปลอดภัยที่ลงมือทำจริง + ข้อจำกัด + งานต่อ"
> **อัปเดตล่าสุด:** 2026-06-03 — implement Level 1 + Level 2, เก็บ Level 3 เป็น future work
> เหมาะใช้เขียน thesis หัวข้อ **"Payment Verification Security & Limitations"**

---

## 0. TL;DR

ระบบจ่ายเงินใช้ **PromptPay (เงินเข้าบัญชีจริง) + อัปโหลดสลิป + ตรวจด้วย EasySlip**
จุดสำคัญที่ต้องเข้าใจ: **EasySlip ไม่ได้ถือเงิน** — เงินวิ่งจากลูกค้าเข้าบัญชีเรา (PromptPay) โดยตรง
EasySlip แค่ "อ่าน + ยืนยันสลิปกับข้อมูลธนาคารจริง" แล้วบอกเรา

**ปัญหาที่เจอ (2026-06-03):** ระบบเดิมกดจ่ายผ่านได้โดย **ไม่ต้องแนบสลิป + ไม่ตรวจเงินจริง**
**แก้แล้ว:** ยกระดับเป็น Level 2 (ดูตารางด้านล่าง) — ปิดช่องโหว่หลักทั้งหมด เหลือ Level 3 เป็นงานต่อ

---

## 1. เงินไหลไปไหน? (EasySlip ไม่ถือเงิน)

```
            เงินจริง (PromptPay) — ไม่ผ่าน EasySlip เลย
  ┌──────────┐  สแกน QR + โอน   ┌────────────────┐
  │  ลูกค้า   │ ───────────────▶ │  บัญชีของเรา     │ ◀── เงินเข้าตรงนี้ เต็มจำนวน
  │ (แอปธนาคาร)│  ผ่านระบบ ธปท.    │ (PROMPTPAY_ID)  │     ภายใน 2-3 วินาที
  └────┬─────┘                   └────────────────┘
       │ อัปโหลด "รูปสลิป"
       ▼
  ┌──────────┐  ส่งรูป   ┌──────────────┐
  │ เว็บเรา   │ ───────▶ │   EasySlip    │ ← อ่านสลิป: จริงไหม / ยอด / ผู้รับ / เวลา / ref
  │          │ ◀─────── │ (อ่านสลิป)     │   **ไม่แตะเงิน** แค่ยืนยันกับ record ธนาคาร
  └──────────┘  ผลตรวจ   └──────────────┘
```

| องค์ประกอบ | ถือเงินไหม | หน้าที่ |
|---|:---:|---|
| PromptPay (ระบบ ธปท./ITMX) | — | ย้ายเงินจริง ลูกค้า → บัญชีเรา |
| บัญชีเรา (`PROMPTPAY_ID`) | ✅ | ปลายทางรับเงิน (เบอร์/เลขบัตรที่ผูกพร้อมเพย์) |
| EasySlip API | ❌ | อ่าน + ยืนยันสลิปกับธนาคาร (ไม่ custody เงิน) |

> EasySlip ไม่ได้ OCR รูปแล้วเชื่อ — มันอ่าน QR/ref ในสลิปไปเทียบกับ **record ธนาคารจริง** จึงกันสลิปตัดต่อได้

---

## 2. Threat Model — การโกงที่เป็นไปได้ + การรับมือ

| # | การโกง | กันด้วย | สถานะ |
|---|--------|---------|:-----:|
| T1 | สลิปตัดต่อ/ปลอม (แก้ยอดในรูป) | EasySlip เทียบ record ธนาคาร | ✅ |
| T2 | ไม่แนบสลิปแล้วกดจ่าย | บังคับแนบ 3 ชั้น (client/server/verify) | ✅ |
| T3 | โอนน้อยกว่าราคา | เช็คยอดตรงเป๊ะ | ✅ |
| T4 | เอาสลิปเดิมมาใช้ซ้ำ | `slipRef` UNIQUE | ✅ |
| T5 | โอนเข้าบัญชี**คนอื่น**ยอดเท่ากันแล้วแนบสลิป | เช็ค receiver = `PROMPTPAY_ID` | ✅ (Level 1) |
| T6 | เอา**สลิปเก่า**ที่เคยโอนเข้าบัญชีเรา (เรื่องอื่น) มาแนบ | เช็คเวลาสลิปอยู่ในช่วง order | ✅ (Level 2) |
| T7 | deploy ลืมใส่ key → ระบบแจกตั๋วฟรี | production fail-closed | ✅ |
| T8 | เลขบัญชีปลายทางเลขท้าย 4 ตัวบังเอิญชนกัน | (เทียบได้แค่เลขที่ไม่ถูก mask) | ⚠️ residual |
| T9 | EasySlip ล่ม / โดน MITM / ตอบผิด | พึ่ง third-party | ⚠️ residual |
| T10 | ไม่มีการยืนยันเงินเข้าจาก "ธนาคาร" โดยตรง | ต้องใช้ gateway webhook | 🔜 Level 3 |

---

## 3. ระดับความปลอดภัย (Defense Levels)

| ระดับ | วิธี | กันอะไรเพิ่ม | สถานะ |
|------|------|------------|:-----:|
| 0 | ไม่ตรวจอะไร (mock ผ่านเสมอ) | — | ❌ ช่องโหว่เดิม |
| 1 | EasySlip + ยอด + receiver + กันซ้ำ + บังคับแนบสลิป + fail-closed | T1–T5, T7 | ✅ **ทำแล้ว** |
| 2 | + เช็คเวลาสลิป (freshness) | T6 | ✅ **ทำแล้ว** |
| 3 | Payment gateway webhook (ธนาคารยืนยันเงินเข้าเอง) | T9, T10 (และลดการพึ่งสลิป) | 🔜 **future work** |

---

## 4. สิ่งที่ลงมือทำแล้ว (Level 1 + 2) — อ้างอิงโค้ด

### 4.1 บังคับต้องแนบสลิป (T2) — 3 ชั้น defense-in-depth
- **Client:** ปุ่มยืนยัน disable จนกว่าจะเลือกไฟล์ — `components/checkout-client.tsx`
- **Server:** `slipImageBase64` required (zod `.min(1)`) — `app/actions/booking.ts`
- **Verify:** `verifySlip()` คืน fail ทันทีถ้าไม่มีรูป/payload — `lib/easyslip.ts`

### 4.2 ตรวจเงินเข้าบัญชีเราจริง (T5) — receiver check
- `lib/slip-match.ts` → `receiverMatchesPromptPay()` เทียบเลขท้าย 4 ตัวของบัญชีปลายทางในสลิป กับ `PROMPTPAY_ID`
- เปิด/ปิดด้วย env `PAYMENTS_RECEIVER_CHECK` (default `true`)
- ถ้าไม่ตั้ง `PROMPTPAY_ID` → ปฏิเสธ (fail-closed)

### 4.3 เช็คเวลาสลิป (T6) — freshness check
- `lib/slip-freshness.ts` → `isSlipFresh()` เวลาโอนต้องอยู่ในช่วง `[order.createdAt - skew, now + skew]` (skew 5 นาที)
- กันเอาสลิปเก่ามาแนบ — เปิด/ปิดด้วย env `PAYMENTS_FRESHNESS_CHECK` (default `true`)
- เก็บ `payment.paidAt` เป็น "เวลาโอนจริงจากสลิป"

### 4.4 Fail-closed (T7)
- มี `EASYSLIP_API_KEY` → ตรวจจริงเสมอ (ทั้ง dev/prod)
- ไม่มี key + **production** → ปฏิเสธทุกคำขอ (ไม่แจกตั๋วฟรีเด็ดขาด)
- ไม่มี key + **development** → mock (ยังบังคับแนบสลิป) + เตือนดังๆ ใน log
- `lib/env.ts` เตือนตอน boot ถ้า production แต่ payment config ไม่ครบ

### 4.5 Tests
- `tests/unit/slip-match.test.ts` (10) — receiver match รวมเคส attack T5
- `tests/unit/slip-freshness.test.ts` (9) — freshness รวมเคส attack T6
- รวม unit ทั้งโปรเจกต์ 28/28 ผ่าน

---

## 5. ข้อจำกัดที่เหลือ (พูดตรงๆ — เขียนใน thesis ได้)

1. **slip-based = เชื่อ "หลักฐานจากลูกค้า"** ไม่ใช่ "ธนาคารยืนยันกับเรา" — โดยธรรมชาติมีเพดานความเชื่อมั่น
2. **เทียบ receiver แค่เลขท้าย 4 ตัว (T8)** — เพราะสลิป mask เลขบัญชี มีโอกาส (ต่ำ) ที่บัญชีคนอื่นเลขท้ายตรงกัน ถ้า EasySlip คืนพร็อกซีเต็มควรเทียบมากขึ้น
3. **พึ่ง EasySlip (T9)** — ถ้าล่ม = จ่ายไม่ได้ (fail-closed) เป็นปัญหา availability; ควรมี fallback (SlipOK) หรือ manual admin verify
4. **ไม่มี idempotency ระดับ network** — ถ้า user กดยืนยันรัวๆ พึ่ง `slipRef` unique + order status guard ซึ่งพอ แต่ webhook-based จะสะอาดกว่า

---

## 6. 🔜 Level 3 (Future Work) — Payment Gateway Webhook

> **เป้าหมาย:** เลิกพึ่ง "สลิปจากลูกค้า" — ให้ **ธนาคาร/เกตเวย์ยิง webhook มาบอกเราเองว่าเงินเข้าแล้ว**
> นี่คือวิธีที่ระบบ production จริง (ขายบัตรจริง) ใช้

### 6.1 ทำไมถึงปลอดภัยกว่า
- เงินเข้าจริง = ได้รับ event จากธนาคาร/เกตเวย์ ไม่ใช่จากรูปที่ลูกค้าอัปโหลด → ปลอมไม่ได้
- ปิด T9/T10 และลดน้ำหนัก T1–T8 ทั้งหมด (ไม่ต้องเชื่อสลิปอีก)

### 6.2 ตัวเลือก provider (ไทย)
| Provider | จุดเด่น | ค่าใช้จ่าย | หมายเหตุ |
|---|---|---|---|
| **Omise (Opn)** | doc ดี, sandbox ฟรี, PromptPay + card + webhook | ~3.65% + 11฿/tx (live) | schema มี enum `OMISE` รออยู่แล้ว |
| **GB Prime Pay** | PromptPay QR + webhook, เรตถูก | ~% ต่อ tx | TH-native |
| **2C2P** | enterprise, ครบ | ต่อรองเรต | งานใหญ่ |
| **SCB Easy / KBank API** | verify กับธนาคารตรง realtime | ฟรี | ต้องบัญชี **นิติบุคคล/SME** |

### 6.3 Flow ที่จะเปลี่ยนไป
```
ลูกค้า → จ่ายผ่าน gateway (QR/บัตร) → gateway รับเงิน → ยิง webhook → เว็บเรา
        เว็บเรา: verify signature ของ webhook → mark order PAID → ออกตั๋ว
        (ไม่ต้องอัปโหลดสลิป ไม่ต้องเชื่อรูปจากลูกค้า)
```

### 6.4 งานที่ต้องทำ (checklist สำหรับครั้งหน้า)
- [ ] เพิ่ม API route `app/api/payments/webhook/route.ts` (รับ event จาก gateway)
- [ ] **Verify webhook signature** (HMAC จาก gateway) — กัน fake webhook (สำคัญสุด)
- [ ] Idempotency: เก็บ `gatewayEventId` unique กัน event ซ้ำ
- [ ] เพิ่ม `PaymentMethod` ใช้ `OMISE`/gateway + เก็บ `chargeId`, `gatewayPayload` ใน `Payment`
- [ ] map สถานะ gateway → `PaymentStatus`/`OrderStatus` + ออกตั๋วใน transaction
- [ ] Reconciliation job: เทียบ order ค้าง vs charge จริงในระบบ gateway (กันหลุด)
- [ ] เก็บ slip-flow เดิมไว้เป็น fallback (กรณี gateway ใช้ไม่ได้)
- [ ] Webhook ต้อง return 200 เร็ว + ประมวลผลแบบ idempotent (retry-safe)
- [ ] env: `OMISE_PUBLIC_KEY`, `OMISE_SECRET_KEY`, `OMISE_WEBHOOK_SECRET` + fail-closed guard
- [ ] ทดสอบด้วย sandbox (บัตรเทสต์ 4242…) + จำลอง webhook (CLI/ngrok)

### 6.5 หมายเหตุ thesis
- ศัพท์: **server-to-server payment confirmation / webhook reconciliation** vs **client-submitted proof (slip)**
- จุดขายในเล่ม: อธิบายว่าทำไม slip-based เป็น "good enough for MVP/zero-cost" แต่ production ต้อง gateway-confirmed — แสดงความเข้าใจ trade-off (อาจารย์ชอบมากกว่าอ้างว่าปลอดภัย 100%)

---

## 7. สรุปสถานะ

| | สถานะ |
|---|---|
| Level 1 (ตรวจสลิป + ยอด + receiver + กันซ้ำ + บังคับแนบ + fail-closed) | ✅ ทำแล้ว 2026-06-03 |
| Level 2 (freshness — กันสลิปเก่า) | ✅ ทำแล้ว 2026-06-03 |
| Level 3 (gateway webhook) | 🔜 future work — ดู §6 |
| Unit tests | ✅ 28/28 |
| `tsc --noEmit` | ✅ 0 errors |

---

## 8. Known Findings (security audit 2026-06-03) — ✅ F1–F8 แก้ครบแล้ว 2026-06-04

> audit ทั้ง flow จอง→จ่าย→ออกตั๋ว (adversarial). **"เรื่องเงิน" ปลอดภัยแล้ว** (เอาตั๋วฟรี/จ่ายน้อย/โอนผิดบัญชี/สลิปปลอม/ซ้ำ ทำไม่ได้)
> ที่เหลือคือ **abuse / กักตุน / กวนระบบ** ไม่ใช่ขโมยเงิน — แต่บางข้อขัดกับ "ความเป็นธรรม" ของโปรเจกต์เอง

### ผ่าน audit (จุดแข็ง)
ยอดคำนวณฝั่ง server (ไม่เชื่อ client), เช็คเจ้าของ order (กัน IDOR), กัน race ด้วย Redis SET NX,
กดซ้ำ/สลิปซ้ำกันด้วย `slipRef`+`ticket.seatId` unique, ออกตั๋ว+mark paid ใน transaction เดียว, มี queue gate

### Findings
| # | ระดับ | ปัญหา | ผลกระทบ | ที่ | แนวทางแก้ |
|---|:----:|-------|---------|-----|-----------|
| **F1** | ✅ แก้แล้ว | `submitSlip` ไม่มี rate limit | ยิงสลิปรัว = เผาโควต้า EasySlip 500/เดือนหมด → คนอื่นจ่ายไม่ได้ (DoS) + brute force สลิป | `booking.ts` | ใช้ `checkRateLimit` ก่อนเรียก EasySlip — key `order:{id}:user:{id}` 5/10นาที + `user:{id}` 20/ชม. (ผูก userId กัน DoS ข้ามคน) |
| **F2** | ✅ แก้แล้ว | ลิมิต "X ใบ/บัญชี" เช็คแค่ต่อ order | ซื้อ 2 ใบ → เข้าคิวใหม่ → ซื้ออีก วนได้ = กักตุน/scalp (ขัด fairness) | `booking.ts` | นับ `OrderItem` ของ order PAID+PENDING(active) ของ user ในคอนเสิร์ต รวมกับที่จะจอง ต้อง ≤ max — logic ใน `lib/ticket-limit.ts` |
| **F3** | ✅ แก้แล้ว | order ทิ้งไว้ → ที่นั่งค้าง `HELD` ถาวร | Redis lock หมดใน 5 นาที แต่ DB seat ยัง HELD ตลอด → ล็อกที่นั่งตายโดยไม่จ่าย (griefing) | `lib/order-sweeper.ts` | on-read sweep ใน `holdAndCreateOrder` (ต่อคอนเสิร์ต) + cron `pnpm sweep` (ทั้งระบบ): PENDING+`expiresAt<now` → CANCELLED + ลบ OrderItem + seat → AVAILABLE |
| F4 | ✅ แก้แล้ว | queue token เป็น bearer (`isAdmitted` ไม่ผูก userId) | แชร์ token ข้ามคิวได้ (fairness) | `queue.ts` | `isAdmitted(token, concertId, userId?)` เทียบ `meta.userId` ที่ผูกตอน join + `holdAndCreateOrder` ส่ง userId |
| F5 | ✅ แก้แล้ว | receiver match แค่เลขท้าย 4 | บัญชีอื่นเลขท้ายชนกัน (โอกาสต่ำ) | `slip-match.ts` | ยาวเท่ากัน (unmasked) → เทียบเต็ม; masked → คงเทียบ 4 หลัก (กัน false-negative จาก country-code) |
| F6 | ✅ แก้แล้ว | `new Date(d.date)` ของสลิป | ถ้า EasySlip คืนเวลาไม่มี TZ อาจเพี้ยน 7 ชม. → freshness ผิด | `easyslip.ts` | `lib/slip-date.ts` `parseSlipDate()` — ไม่มี TZ → เติม `+07:00` (เวลาไทย) |
| F7 | ✅ แก้แล้ว | `slipImageBase64` ไม่จำกัดขนาด | อัปรูปยักษ์กิน RAM (จำกัดบางส่วนโดย Next ~1MB) | `booking.ts` | `lib/slip-image.ts` — `.max(~2MB)` + `isLikelyBase64Image()` ตรวจชนิด |
| F8 | ✅ แก้แล้ว | `isHeldBy` import แต่ไม่ใช้ | `submitSlip` ไม่ได้ re-check seat (defense-in-depth) | `booking.ts` | ลบ import dead code; **ตั้งใจไม่ใส่ hard-block** (submitSlip รันหลังเงินเข้า → block = ลูกค้าจ่ายแต่ไม่ได้ตั๋ว) พึ่ง unique constraint `Ticket.seatId`/`OrderItem.seatId` แทน |

### ลำดับที่ควรทำก่อน
~~**F1 → F2 → F3**~~ → ~~**F4–F8**~~ ✅ **ทำครบทั้ง F1–F8 แล้ว 2026-06-04**

### ✅ F4–F8 — สิ่งที่ลงมือทำ (2026-06-04)
- **F4** `lib/queue.ts` `isAdmitted(token, concertId, userId?)` — เทียบ `userId` ใน token meta (ผูกตอน `joinQueue`) + `holdAndCreateOrder` ส่ง userId → กันแชร์/ใช้ token คนอื่น. เทสต์ `scripts/test-f4.ts` (6, Redis จริง)
- **F5** `lib/slip-match.ts` — เลขยาวเท่ากัน (unmasked) เทียบเต็ม, masked เทียบ 4 หลักตามเดิม. เทสต์เพิ่มใน `tests/unit/slip-match.test.ts`
- **F6** `lib/slip-date.ts` `parseSlipDate()` + `easyslip.ts` ใช้แทน `new Date()` — string ไม่มี TZ เติม `+07:00`. เทสต์ `tests/unit/slip-date.test.ts` (8)
- **F7** `lib/slip-image.ts` (`MAX_SLIP_BASE64_LEN`, `isLikelyBase64Image`) + `slipSchema` `.max().refine()`. เทสต์ `tests/unit/slip-image.test.ts` (8)
- **F8** ลบ import `isHeldBy` ที่ไม่ใช้ + comment อธิบายว่าทำไมไม่ใส่ hard-block (พึ่ง unique constraint แทน — กัน "จ่ายแล้วไม่ได้ตั๋ว")
- ✅ verify: unit **62/62**, integration F1–F3 **16/16** + F4 **6/6**, `tsc` 0 errors
- ✅ **E2E (real browser, `scripts/e2e-booking.ts` via playwright-core) 9/9**: login → ห้องรอ/Turnstile → เลือกที่นั่ง → checkout → แนบสลิป → ออกตั๋ว 2 ใบ (order PAID, payment SUCCESS)
  - ⚠️ **หมายเหตุ e2e**: `.env` มี `EASYSLIP_API_KEY` จริง → server ปกติจะ **ปฏิเสธสลิปปลอม** (ทดสอบแล้ว = security ทำงาน). การรัน e2e ให้ "ออกตั๋วสำเร็จ" ต้องสตาร์ท dev server แยกพอร์ตด้วย `EASYSLIP_API_KEY="" npx next dev -p 3001` (dev-mock) — **ไม่แตะ .env จริง**

### ✅ F1–F3 — สิ่งที่ลงมือทำ (2026-06-04)
- **F1** `app/actions/booking.ts` `submitSlip` — เรียก `checkRateLimit` 2 ชั้นก่อน EasySlip (order+user / user). key ผูก `userId` ทั้งคู่ กัน attacker เอา orderId เหยื่อมา spam ล็อกการจ่าย
- **F2** `lib/ticket-limit.ts` (`exceedsTicketLimit`, `remainingTicketAllowance`) + นับ `OrderItem` ยอดรวมใน `holdAndCreateOrder` — เทสต์ `tests/unit/ticket-limit.test.ts` (9)
- **F3** `lib/order-sweeper.ts` (`expireStaleOrders`, `isOrderStale`) เรียก on-read ใน `holdAndCreateOrder` + `scripts/sweep-orders.ts` (`pnpm sweep`) — เทสต์ `tests/unit/order-sweeper.test.ts` (6)
- **🔧 root cause ที่เจอระหว่างทำ F3:** `OrderItem.seatId` เป็น `@unique` ระดับ global แต่ flow ยกเลิก (เดิม `cancelOrder`) **ไม่เคยลบ OrderItem** → ที่นั่งที่ยกเลิกจองใหม่ไม่ได้ (unique violation). แก้โดยลบ `OrderItem` ตอนยกเลิกทั้งใน sweeper และ `cancelOrder` (order ที่ยกเลิกยังไม่มีตั๋ว ลบ line-item ปลอดภัย เก็บ order ไว้เป็น audit)
- ✅ tests รวม **43/43** ผ่าน, `tsc --noEmit` 0 errors

> thesis: ใส่หัวข้อ **"Security Analysis & Threat Model"** — โชว์ว่าวิเคราะห์ครบ ไม่ใช่แค่ "ทำงานได้"

---

## 9. Production Hardening (2026-06-04) — ปิดช่อง config/fail-open ก่อนใช้งานจริง

> รอบนี้เน้น "ความพร้อมใช้งานจริง" ไม่ใช่ logic เงิน(ซึ่ง F1–F8 ปิดไปแล้ว) — แก้จุดที่ config ผิด
> แล้วทำให้เกราะที่เขียนไว้ **ถูกปิดเงียบ ๆ** โดยไม่มีใครรู้

| # | ระดับ | ปัญหา | ที่ | สิ่งที่ทำ |
|---|:----:|-------|-----|-----------|
| **H1** | ✅ แก้แล้ว | Turnstile **fail-open**: production ไม่มี key → fallback ไป test key (always-pass), และ network error → `success:true` = CAPTCHA ถูกปิดเงียบ | `lib/turnstile.ts` | production + ไม่มี secret จริง → คืน fail (`not-configured`); network error → fail-closed บน production เท่านั้น (dev ยัง fail-open กัน false positive) |
| **H2** | ✅ แก้แล้ว | ไม่มี boot-guard เตือนว่า Turnstile ไม่พร้อมบน production (payment มีแล้ว แต่ anti-bot ไม่มี) | `lib/env.ts` | เพิ่ม `TURNSTILE_SITE_KEY/SECRET_KEY` ใน schema + `isTurnstileConfigured` + เตือนดังตอน boot ถ้า production แต่ไม่ตั้ง key |
| **H3** | ✅ แก้แล้ว | `slipRef` เป็น `String? @unique` → ถ้า EasySlip ไม่คืน `transRef` จะเก็บ NULL ซึ่ง Postgres ยอมให้ซ้ำ = **กันสลิปซ้ำ (T4) หลุด** | `lib/easyslip.ts` | ไม่มี `ref` = ปฏิเสธ (fail-closed) → slipRef ไม่มีทางเป็น NULL ตอน success → unique dedup ทำงานเสมอ |
| **H4** | ✅ แก้แล้ว | `/api/behavior` ไม่ auth + ไม่มี rate-limit → spam เขียน DB / ปั่นคะแนน anti-bot ของ session คนอื่น | `app/api/behavior/route.ts` | เพิ่ม rate-limit 60/นาที ต่อ IP (ตามแบบ route อื่น) |

- ✅ verify: `tsc --noEmit` 0 errors, unit **62/62** ผ่าน (ไม่มี test เดิมพัง)

### ⚠️ ยังต้องทำเองก่อน go-live (อยู่นอกเหนือโค้ด — ผมทำแทนไม่ได้)
- [ ] `NODE_ENV=production` ตอน deploy (ตอนนี้ `.env` = development → fail-closed/HSTS ยังไม่ทำงาน)
- [ ] ขอ + ตั้ง `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` จริงจาก Cloudflare (ไม่งั้น H1 จะ block ผู้ใช้จริงหมดบน production = ตั้งใจให้ดัง)
- [ ] **rotate `EASYSLIP_API_KEY`** (เป็น live credential อยู่ใน `.env` หน้าตา template — เสี่ยงหลุด) + ย้าย secret จริงออกจากไฟล์ที่มีหัว template
- [ ] ต่อ Resend จริง (`app/actions/auth.ts` ยัง stub) + ตัดสินใจว่าจะบังคับ `emailVerified` ตอน login มั้ย
- [ ] เสิร์ฟผ่าน HTTPS + reverse proxy (ระบบออกแบบ local-only)
- [ ] (ขายจริงสเกลใหญ่) เริ่ม Level 3 gateway webhook ตาม §6
