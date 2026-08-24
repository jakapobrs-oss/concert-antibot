# 11 — Requirements (Single Source of Truth)

> ไฟล์นี้รวม **ทุก requirement ที่ user เคยพูดในทุก session**
> ใช้เป็นจุดอ้างอิงเดียว — ถ้าไฟล์อื่นขัดแย้งกับไฟล์นี้ → ไฟล์นี้ถูก
> อัปเดต: 2026-08-24 rev 4 (เพิ่ม §2.2.3 ผังที่นั่งรายโซน + §2.7 คืนบัตร/ขายต่อ · แก้ §3.3/§5 ที่ยังเขียนว่า local-only ทั้งที่ deploy ขึ้น Vercel แล้ว)

---

## 1. Core Goal

> **โปรเจ็คจบ:** ระบบกดบัตรคอนเสิร์ตที่มี anti-bot ที่ดีและทำได้จริง
> ต้องให้ผู้ใช้จริงเข้าได้พร้อมกัน ทุกแบบ ไม่มีลำเอียง ทุกคนมีสิทธิ์เท่ากัน

---

## 2. Functional Requirements

### 2.1 Authentication
- ✅ Login แบบทั่วไป (email/password)
- ✅ Login ด้วย Google account (OAuth)
- ✅ Email verification + (optional) phone OTP

### 2.2 Concert / Ticketing
- ✅ Admin จัดการคอนเสิร์ต (CRUD)
- ✅ Public ดูรายการคอนเสิร์ตที่จะมา
- ✅ จองที่นั่ง (มี seat map)
- ✅ ออกบัตรเป็น QR code

### 2.2.1 ผังที่นั่งจากรูปสถานที่จริง 🆕 (2026-08-19 — รายละเอียดเต็มใน [20_SEATMAP.md](20_SEATMAP.md))
เหตุผล: สถานที่จัดคอนเสิร์ตแต่ละแห่งมีพื้นที่ใช้งานไม่เหมือนกัน ผังตารางสี่เหลี่ยมตายตัวสื่อสารเรื่องนี้ไม่ได้
- ✅ Admin อัปโหลดรูปผังสถานที่ แล้ววาดกรอบโซนทับรูป
- ✅ ระบบโปรยที่นั่งเต็มกรอบให้เอง **ได้จำนวนเป๊ะตามที่สั่ง** พร้อมเลขแถว/เลขที่นั่งอัตโนมัติ
- ✅ คนซื้อเห็นผังที่นั่งทับบนรูปสถานที่จริง ซูมได้ กดเลือกได้
- ✅ 🔴 **ห้ามเจนที่นั่งทับโซนที่ขาย/จองค้าง/มีตั๋วผูกอยู่** — ตั๋วที่จ่ายเงินจริงต้องไม่ชี้ที่นั่งที่หายไป
- ✅ คอนเสิร์ตที่ยังไม่ได้ทำผัง **ต้องใช้งานได้เหมือนเดิมทุกอย่าง** (ถอยไปผังตารางเดิม)
- ✅ โซนที่ขายบัตรไปแล้วต้องยังตั้งกรอบได้ โดยไม่ลบที่นั่งเดิม
- ❌ ไม่ทำ: ให้ระบบอ่านรูปแล้วแยกโซนเอง (computer vision) — ดูเหตุผลที่ตัดทิ้งใน [20_SEATMAP.md §2](20_SEATMAP.md)
- 🟡 ยังไม่ทำ: จิ้มสีแล้วให้ระบบเดากรอบ (flood fill) — ของเสริม

### 2.2.3 ผังที่นั่ง**ภายในโซน** + โซนยืน + โหมดให้ระบบเลือกที่ให้ 🆕 (2026-08-24 — รายละเอียดเต็มใน [20_SEATMAP.md §8](20_SEATMAP.md))
เหตุผล: §2.2.1 ทำให้เห็นว่า "โซนไหนอยู่ตรงไหนของสถานที่" แต่พอกดเข้าโซนแล้วยังเป็นแค่ปุ่มเลขที่นั่งเรียงต่อกัน — คนซื้อไม่รู้ว่า A12 อยู่หน้าหรือหลัง
- ✅ กดโซนแล้วเห็นกริดของโซนนั้น **1 แถวจริง = 1 บรรทัดบนจอเสมอ** (ไม่ใช่ปุ่มพับตามความกว้างจอ) + ป้ายแถวติดขอบ
- ✅ ระบบบอก **ทิศที่เวทีอยู่เมื่อมองจากโซนนั้น** — คำนวณอัตโนมัติจากกรอบเวที และ **แอดมินกดแก้ทับได้** (`Zone.stageSide`)
- ✅ **โซนยืน** (`Zone.isStanding`) — ขายเป็น "จำนวนใบ" ไม่เปิดให้เลือกรายที่นั่ง · ป้ายที่คนซื้อ/บนตั๋ว/หน้าเช็คอินเห็นคือ **"โซนยืน · ใบที่ 312"** ไม่ใช่ "แถว S เลข 312"
- ✅ **แถวยาวไม่เท่ากันได้** (`Zone.rowSpec` เช่น `[12,14,16]`) + หน้าแอดมิน "จัดแถว" + คอลัมน์ Excel "ที่นั่งต่อแถว" — ผังจริงไม่ใช่สี่เหลี่ยมตายตัว
- ✅ 🔴 **โหมด "ให้ระบบเลือกที่ดีที่สุดให้" (best available) เป็นค่าเริ่มต้น** — เลือกจำนวนใบ แล้วเซิร์ฟเวอร์หยิบที่นั่งติดกันใกล้เวทีที่สุดให้
- ✅ 🔴 **ไม่ส่งผังที่นั่งทั้งงานไปเบราว์เซอร์อีกต่อไป** — ส่งแค่ `{ ว่างกี่ที่, ทั้งหมดกี่ที่ }` ต่อโซน · จะได้รายที่นั่งต้องขอ **รายโซน** และต้องผ่านด่าน login + คิว + rate-limit ก่อน
  - **นี่คือมาตรการกันบอทโดยตรง ไม่ใช่เรื่องประสิทธิภาพ**: ของเดิมบอทที่ผ่านคิวได้ครั้งเดียวจะได้ "แผนที่สต็อกทั้งงานพร้อมสถานะสด" ในคำขอเดียว แล้วรีเฟรชดูความเปลี่ยนแปลงได้เรื่อย ๆ
- ✅ โซนยืนต้องเจนที่นั่งจริงลง DB ("ที่นั่งผี" แถว `S`) เพื่อให้ลิมิตตั๋ว/คิว/hold/คืนบัตร/เช็คอิน QR เดิมทำงานต่อได้โดยไม่ต้องแก้
- ❌ ไม่ทำ: ทางเดิน (aisle) แยกเป็นข้อมูล — ทางเดินอยู่ในรูปผังที่แอดมินวาดมาแล้ว ไม่กระทบราคา/เลขที่นั่ง
- 🟡 ยังไม่ทำ: ที่นั่งพิเศษ (วีลแชร์ / เสาบัง / วิวไม่ดี) — ถ้าทำต้องเพิ่ม `Seat.kind` **ห้ามใช้ `SeatStatus.BLOCKED`** เพราะ `BLOCKED` แปลว่า "ขายไม่ได้" แต่ที่นั่งวีลแชร์ต้องขายได้

### 2.2.2 สิทธิ์สมาชิก + รอบกดบัตร 🆕 (2026-08-19 — รายละเอียดเต็มใน [21_MEMBERSHIP_ROUNDS.md](21_MEMBERSHIP_ROUNDS.md))
เหตุผล: "early bird" ต้องแปลว่าสมาชิก **กดก่อน** ไม่ใช่ได้ **ลดราคา**
- ✅ ผู้ใช้รับสิทธิ์สมาชิกเองได้ (1 ปี) / Admin ให้สิทธิ์และเพิกถอนได้
- ✅ หมดอายุ **คำนวณสดทุกครั้งที่ถาม** ไม่มี cron มาพลิกสถานะ (กัน bug คลาส cron ตกรอบ)
- ✅ เพิกถอนแล้ว **เก็บแถวไว้** (`REVOKED` + `revokedAt`) ไม่ลบประวัติทิ้ง
- ✅ Admin ตั้งรอบให้คอนเสิร์ตได้ว่าช่วงไหนใครกดได้ (`MEMBER_ONLY` / `PUBLIC`)
- ✅ 🔑 ทำเป็น **รอบเวลาแยก ไม่ใช่ให้สมาชิกแซงคิว** → คิวในแต่ละรอบยังเป็นธรรมเหมือนเดิม สถิติ fairness ในเล่มยังใช้ได้
- ✅ บังคับใช้ **3 จุด**: เข้าคิว / หน้าเลือกที่นั่ง / ยืนยันจอง (ยิง API ตรงข้ามหน้าเว็บก็โดนกัน)
- ✅ **คอนเสิร์ตที่ไม่ได้ตั้งรอบ = พฤติกรรมเดิมทุกอย่าง** (ของเก่าไม่พัง)
- ✅ บันทึกว่าคำสั่งซื้อเกิดรอบไหน (`Order.saleRoundId`) สำหรับสถิติในเล่ม
- ❌ ไม่ทำ: ส่วนลดราคาสำหรับสมาชิก — โจทย์คือกดก่อน ไม่ใช่ถูกกว่า
- ❌ ไม่ทำ: คิวแบบมีลำดับความสำคัญ — จะทำลายผลวัดความเป็นธรรมทั้งบท (เหตุผลเต็มใน [21_MEMBERSHIP_ROUNDS.md §2](21_MEMBERSHIP_ROUNDS.md))
- 🟡 ยังไม่ทำ: เก็บเงินค่าสมาชิก, ระดับสมาชิกหลายชั้น, อีเมลแจ้งก่อนรอบเปิด

### 2.3 Anti-Bot (หัวใจของโปรเจ็ค)
- ✅ Multi-layer defense (**2 ชั้น**: Layer-1 scoring + Layer-2 behavior escalate-only — ดู `THESIS_GUIDE.md` §1)
- ✅ Behavior analysis (mouse, keystroke, scroll)
- ✅ CAPTCHA escalation
- ✅ Fingerprint + headless detection
- ✅ Rate limiting

### 2.4 Fairness
- ✅ Virtual Waiting Room (Queue)
- ✅ Randomized batch release
- ✅ Seat hold with TTL (5 นาที)
- ✅ Limit ticket per account
- ✅ Server-side time enforcement (กัน pre-warm)

### 2.5 Payment
- ✅ **PromptPay QR (primary)** — ฟรี + เงินเข้าจริง
- ✅ Auto slip verification (EasySlip API)
- ✅ Manual slip verification (admin fallback)
- ⚪ Optional: บัตรเครดิต/เดบิต (Omise — มีค่าธรรมเนียม)
- ⚪ Optional: TrueMoney, Mobile Banking

### 2.7 คืนบัตร + จุดยืนเรื่องตลาดขายต่อ (resale) 🆕 (2026-08-24)
เหตุผล: ไล่จับคนขายต่อไม่มีวันชนะ — **ตัดแรงจูงใจ** ให้บัตรขายต่อไม่ได้ตั้งแต่ออกแบบ แล้ว scalper จะเลิกกดเอง
- ✅ **ตั๋วผูกชื่อผู้ถือ** (`Ticket.holderName` snapshot แก้ไม่ได้หลังจ่าย) → หน้างานเทียบบัตรประชาชน
- ✅ **QR หมุนตามเวลา** (`Ticket.qrSecret` HMAC) → สกรีนช็อต QR ส่งต่อใช้เข้างานไม่ได้
- ✅ **ช่องคืนบัตรเข้าระบบ** (`TicketReturn`) — คืนได้ที่ **ราคาหน้าบัตร** แล้วที่นั่งกลับ pool กลาง ขายต่อผ่านคิว+anti-bot ปกติ
- ✅ 🔑 **ผู้คืนเลือกผู้รับไม่ได้** — จึงไม่ใช่การโอนตั๋วอำพราง (ถ้าให้เลือกผู้รับได้ = เปิดช่องขายต่อกลับมาเต็ม ๆ)
- ✅ **เส้นตายคืนบัตร** (`RETURN_CUTOFF_HOURS`) ให้ระบบมีเวลาขายรอบใหม่ทัน
- ✅ **กันคืนซ้ำ/ชนกับเช็คอิน** — conditional `updateMany` ใน transaction (atomic claim)
- ✅ **กันบัญชีปั้ม** (`lib/holder-policy.ts`) — เช็คอายุบัญชี + เพดานจำนวนตั๋วที่คนหนึ่งถือได้
- ❌ ไม่ทำ (ตั้งใจ): ตลาดขายต่อระหว่างผู้ใช้ + การโอนตั๋วให้เพื่อนแบบเลือกผู้รับได้
- 📌 = โมเดลเดียวกับ Ticketmaster **Face Value Exchange + SafeTix** — ตอบกรรมการได้ว่า **ตัดตลาดขายต่อทิ้งด้วยการออกแบบ ไม่ใช่ทำไม่ทัน**

### 2.6 Admin
- ✅ Dashboard ดูคำขอ
- ✅ Bot detection log
- ✅ Manage users (block/unblock)
- ✅ Manual slip verify
- ✅ Reports

---

## 3. Non-Functional Requirements

### 3.1 ค่าใช้จ่าย (Cost Constraint) 🆕
- ✅ **ทุกอย่างต้องไม่มีค่าใช้จ่าย** สำหรับ primary path
- ✅ ถ้ามี → ต้อง **ไม่แพง** + ทำเป็น **optional**
- ✅ Total cost = **0 บาท/เดือน** ✅

### 3.2 สกุลเงิน 🆕
- ✅ **THB (บาทไทย)** ทุก display, database, payment
- ✅ Format: `1,500 บาท` หรือ `฿1,500`

### 3.3 Deployment 🆕 (แก้ 2026-08-24 — ของเดิมเขียนว่า local-only ซึ่งไม่ตรงกับของจริงแล้ว)
- ✅ **Local เป็นหลักสำหรับพัฒนา/สาธิต** — Docker (Postgres + Redis) + `pnpm dev`
- ✅ 🆕 **มี deploy บน Vercel จริง** (free tier) — DB = Neon, Redis = Upstash, cron sweep รายวันผ่าน `vercel.json`
  - `vercel.json` ตั้ง `buildCommand` ให้รัน `prisma migrate deploy` **อัตโนมัติทุกครั้งที่ deploy** → migration ขึ้นฐานจริงตอน build ไม่ต้องรันมือ
- ✅ ยังคงเงื่อนไข **0 บาท/เดือน** (Vercel Hobby + Neon free + Upstash free)
- ✅ Multi-device access via local Wi-Fi / hotspot / Cloudflare Tunnel (free)

### 3.4 Multi-Device Support 🆕
- ✅ iPhone (ทุกรุ่น)
- ✅ iPad (portrait + landscape)
- ✅ Android phone + tablet
- ✅ Desktop browser (Chrome, Firefox, Safari, Edge)
- ✅ Responsive mobile-first
- ✅ Touch-friendly (≥44px tap targets)
- ✅ PWA support (Add to Home Screen)

### 3.5 Database
- ✅ **ID เป็นตัวเลข** (BIGSERIAL / BIGINT auto-increment) เป็น default
- ✅ Currency field = THB

### 3.6 UI/UX
- ✅ คล้ายสไตล์ The Concert (แต่ไม่ลอก)
- ✅ ใช้งานง่าย
- ✅ ภาษาไทยเป็นหลัก

### 3.7 Tech Stack
- ✅ Next.js 15 (แนะนำ) — มี alternative optional
- ✅ Version ต้องเข้ากันได้และเสถียร
- ✅ Free open-source ทุกตัว (ไม่ใช้ commercial license)

### 3.8 Real Payment Testing 🆕
- ✅ **เงินต้องเข้าบัญชีจริง** เพื่อทดสอบ
- ✅ Test ได้ฟรี (โอน 1 บาท เข้าบัญชีตัวเอง)
- ✅ Demo day: เพื่อน/อาจารย์โอนเข้าบัญชี user จริง

---

## 4. Process / Workflow Rules

### 4.1 ขั้นตอนการพัฒนา
1. ✅ สร้างไฟล์ plan ก่อน
2. ✅ ทำ ER + diagrams ที่จำเป็น
3. ✅ อ่านไฟล์วิจัย (อ้างอิง, ห้าม edit)
4. ✅ จัดระเบียบให้หาง่าย (docs/ + numbered files)
5. ⚠️ ส่ง notification ผ่าน Claude app บน iPhone (ต้องเปิด Remote Control)
6. ✅ ใช้ usage limit ไม่เกิน 30-50% / session
7. ✅ **เริ่ม implement ได้เมื่อ user approve เท่านั้น**

### 4.2 บันทึกข้อมูล 🆕
- ✅ ทุก project data ใน session ต้อง save ใน docs/
- ✅ ทุก decision ต้องมี changelog
- ✅ Memory file สำหรับ context ระหว่าง session

---

## 5. Out of Scope (สิ่งที่ไม่ทำ)

- ~~❌ Cloud deployment (Vercel, AWS, etc.)~~ → **เปลี่ยนแล้ว 2026-08-24: deploy บน Vercel free tier จริง** (ดู §3.3)
- ❌ Mobile native app (ใช้ PWA แทน)
- ❌ Multi-language (รองรับ TH อย่างเดียว — EN เป็น future)
- ❌ Refund flow แบบ automated (manual admin ทำ — `TicketReturn.status` `PENDING` → แอดมินโอนคืน → `REFUNDED`)
- ❌ Resale market **ระหว่างผู้ใช้** — เป็นการตัดสินใจเชิงออกแบบ ไม่ใช่ของที่ทำไม่ทัน
  - ⚠️ อย่าอ่านบรรทัดนี้ว่า "ไม่มีอะไรเรื่องขายต่อ" — **มีช่องคืนบัตรเข้าระบบที่ราคาหน้าบัตรแล้ว** (§2.7)
- ❌ Live streaming concert
- ❌ Advanced analytics (ใช้ basic logging แทน)
- ❌ Multi-tenant (1 organization เท่านั้น)
- ❌ White-label / customization
- ❌ Real-name international payment

---

## 6. Constraints & Limitations

| Constraint | Rationale |
|---|---|
| รัน local laptop | ไม่มี budget cloud |
| PromptPay only (primary) | ฟรี + เงินเข้าจริง |
| ไม่ใช้บริการ paid | budget = 0 |
| Sandbox/Test = real for thesis | demo สำหรับอาจารย์เท่านั้น |
| THB เท่านั้น | local market |
| Single host (laptop) | ไม่มี cluster |
| 1 user ทำเอง | ไม่ใช่งานบริษัท |

---

## 7. Acceptance Criteria (ส่งงานได้เมื่อ)

### 7.1 Technical
- [ ] รัน `docker-compose up && pnpm dev:lan` แล้วเปิดได้จาก iPhone/iPad/Desktop
- [ ] Login email + Google ใช้งานได้
- [ ] Admin สร้างคอนเสิร์ตได้, public เห็น
- [ ] 5 คนพร้อมกัน → เข้าคิว → ได้บัตรครบทุกคน (ตามที่นั่ง)
- [ ] Bot script ถูก block แต่ user จริงผ่าน
- [ ] PromptPay QR + slip verify + ออกบัตร end-to-end ทำงาน
- [ ] เงิน 1 บาทเข้าบัญชี user จริง (ทดสอบ)

### 7.2 Documentation
- [x] docs/ ครบ (ตอนนี้ 00–21 + `THESIS_GUIDE.md` + `SECURITY_TODO.md`)
- [ ] thesis chapter 3-4 draft + diagrams
- [ ] README รัน demo ได้ตาม instruction

### 7.3 Cost
- [ ] Total monthly cost = 0 บาท ✅

---

## 8. Decision Log (สรุปการตัดสินใจสำคัญ)

| Date | Decision | Reason |
|---|---|---|
| 2026-05-25 | ใช้ PostgreSQL ไม่ใช่ MySQL | BIGSERIAL + JSONB + SKIP LOCKED + free |
| 2026-05-25 | Next.js 15 + App Router | all-in-one, modern, free |
| 2026-05-25 | NextAuth v5 | รองรับ Next 15, Google OAuth ฟรี |
| 2026-05-25 | Cloudflare Turnstile (ไม่ใช่ reCAPTCHA) | ฟรี unlimited, privacy-friendly |
| 2026-05-25 | Local-only deployment | user requirement |
| 2026-05-25 | PromptPay + EasySlip (ไม่ใช่ Omise primary) | ฟรี + เงินเข้าจริง |
| 2026-05-25 | THB currency lock | TH market |
| 2026-05-25 | Mobile-first responsive + PWA | multi-device requirement |
| 2026-05-25 | MinIO local (ไม่ใช่ R2/S3) | ฟรี + local-only |
| 2026-05-25 | SSE (ไม่ใช่ WebSocket/Pusher) | ฟรี + เพียงพอ |
| 2026-07-03 | ตั๋วผูกชื่อ + QR หมุนตามเวลา + คืนบัตรเข้า pool กลาง | ตัดแรงจูงใจ scalper แทนการไล่จับ (§2.7) |
| 2026-08-18 | สมาชิก = **รอบเวลาแยก** ไม่ใช่แซงคิว | คิวแต่ละรอบยัง FIFO → สถิติ fairness ในเล่มไม่ต้องวัดใหม่ |
| 2026-08-19 | ผังจากรูป + วาดกรอบทับ (ไม่ใช่ computer vision) | CV พังกับผังจริงที่มีตัวหนังสือ/เส้น/สีซ้ำ + ไม่ทันเวลา |
| 2026-08-24 | ผังในโซนเก็บเป็น **`rowSpec` จำนวนที่นั่งต่อแถว** ไม่ใช่พิกัดรายที่นั่ง | ผังจริงมีโซนที่แถวยาวไม่เท่ากัน แต่การเก็บพิกัดทีละที่นั่งแพงเกินจำเป็น |
| 2026-08-24 | best-available เป็นค่าเริ่มต้น + ไม่ส่งผังทั้งงานไป client | ปิดช่อง scrape สต็อก = มาตรการกันบอท (§2.2.3) |
| 2026-08-24 | Deploy Vercel free tier (เลิกยึด local-only) | ให้กรรมการ/ผู้ทดสอบเปิดจากที่ไหนก็ได้ โดยยังจ่าย 0 บาท |

---

## 9. คำถามที่ user ยังไม่ตอบ (Default Applied)

ถ้า user ไม่ตอบใน Decision Points ต่อไปนี้ Claude ใช้ default:

| # | คำถาม | Default ที่ใช้ |
|---|---|---|
| D1 | DB engine? | PostgreSQL 16 |
| D2 | Hosting? | Local only (no deploy) |
| D3 | CAPTCHA? | Cloudflare Turnstile |
| D4 | Payment? | PromptPay + EasySlip |
| D5 | UI accent color? | สีม่วง #7C3AED |
| D6 | Language? | TH only |
| D7 | Layout strategy? | Mobile-first |
| D8 | Architecture? | Monolith (1 Next.js app) |
| D9 | Realtime tech? | SSE |
| D10 | ML for behavior? | Rule-based ก่อน, ML เป็น future |

---

## 10. References

- วิจัยต้นฉบับ: `วิจัยระบบแอนติบอท finish.docx` (root folder)
- All planning docs: `docs/00_README.md` through `docs/12_CHANGELOG.md`
- Original task requirements ใน scheduled task system
