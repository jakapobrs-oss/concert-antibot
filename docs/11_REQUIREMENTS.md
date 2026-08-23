# 11 — Requirements (Single Source of Truth)

> ไฟล์นี้รวม **ทุก requirement ที่ user เคยพูดในทุก session**
> ใช้เป็นจุดอ้างอิงเดียว — ถ้าไฟล์อื่นขัดแย้งกับไฟล์นี้ → ไฟล์นี้ถูก
> อัปเดต: 2026-08-21 rev 8 (เพิ่ม §2.7–2.11 สมาชิก/รอบพรีเซล/ซับสคริปชั่น/บัตรหมด/UX เว็บกดบัตร — Phase 2 → 2.4)

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

### 2.6 Admin
- ✅ Dashboard ดูคำขอ
- ✅ Bot detection log
- ✅ Manage users (block/unblock)
- ✅ Manual slip verify
- ✅ Reports
- ✅ ให้/เพิกถอนสิทธิ์สมาชิก (`/admin/memberships`)

### 2.7 สมาชิก + รอบกดบัตร (Phase 2) 🆕

> ออกแบบเต็ม: [`20_MEMBERSHIP.md`](20_MEMBERSHIP.md) · ตาราง: `Membership`, `SaleRound`

| # | Requirement | สถานะ |
|---|---|---|
| M1 | สมาชิกมี **ชั้นเดียว** (เป็น/ไม่เป็น) ไม่มีหลายระดับ | ✅ ทำแล้ว |
| M2 | สมัครเองได้ **ฟรี** ไม่มีการจ่ายเงิน (อายุ 365 วัน ต่ออายุได้) | ✅ ทำแล้ว |
| M3 | ต้องยืนยันอีเมล (หรือ login ด้วย Google) ก่อนสมัคร | ✅ ทำแล้ว |
| M4 | ผู้ใช้ดูสถานะ/วันหมดอายุของตัวเองได้ (`/account/membership`) | ✅ ทำแล้ว |
| M5 | แอดมินให้สิทธิ์/ต่ออายุ/เพิกถอนได้ + บันทึกว่าแอดมินคนไหนกด | ✅ ทำแล้ว |
| M6 | หมดอายุต้องมีผลทันทีโดยไม่ต้องพึ่ง cron | ✅ ทำแล้ว (คำนวณสดจาก `expiresAt`) |
| M7 | สิทธิ์เดียวของสมาชิก = เข้า **รอบขายก่อน** (`SaleRound.audience = MEMBER_ONLY`) | ⚪ รอสาย SaleRound ต่อ |
| M8 | ❌ สมาชิก **ห้าม** แซงคิวในรอบเดียวกัน (คิวต้องยัง FIFO) | ✅ กติกาบังคับในดีไซน์ |
| M9 | ❌ สมาชิก **ห้าม** ซื้อได้มากกว่าคนทั่วไป และ **ห้าม** มีส่วนลด | ✅ กติกาบังคับในดีไซน์ |
| M10 | สิทธิ์หมดอายุระหว่างมี order ค้าง → order เดิมต้องจ่ายจบได้ | ✅ ทำแล้ว (ตรวจสิทธิ์ที่ขาเข้าเท่านั้น) |
| M11 | คอนเสิร์ตที่ไม่มีรอบขาย = พฤติกรรมเดิมทุกอย่าง | ✅ ทำแล้ว |

### 2.8 รอบพรีเซลหลายชั้น (Phase 2.1) 🆕

> ออกแบบเต็ม: [`21_PRESALE_ROUNDS.md`](21_PRESALE_ROUNDS.md) · อ้างอิงพฤติกรรมแพลตฟอร์มจริง
> (Live Nation Tero, Weverse, ALPHAZ, All Ticket, พรีเซลบัตรเครดิต)

| # | Requirement | สถานะ |
|---|---|---|
| P1 | รอบขายเรียงตามลำดับสิทธิ์ 4 ชั้น: แฟนคลับ → พาร์ทเนอร์ → สมาชิก → ทั่วไป | ✅ ทำแล้ว |
| P2 | ระดับสมาชิก 2 ชั้น (มาตรฐาน/พรีเมียม) — พรีเมียมเข้ารอบแฟนคลับได้ แอดมินให้เท่านั้น | ✅ ทำแล้ว |
| P3 | รอบกำหนดให้ต้อง **ลงทะเบียนล่วงหน้า** ในช่วงเวลาที่ประกาศได้ (เป็นสมาชิกอย่างเดียวไม่พอ) | ✅ ทำแล้ว |
| P4 | รอบพาร์ทเนอร์ปลดล็อกด้วย **โค้ดสิทธิ์** (โค้ดรวม/โค้ดจำกัดจำนวน) 1 คนใช้ซ้ำไม่ได้ | ✅ ทำแล้ว |
| P5 | รอบตั้ง **เพดานตั๋วต่อคน** เองได้ แต่ต้องตึงกว่าค่าคอนเสิร์ตเท่านั้น (ห้ามผ่อนให้หลวม) | ✅ ทำแล้ว |
| P6 | รอบตั้ง **โควต้าที่นั่ง** ได้ และต้องกันแย่งโควต้าพร้อมกันได้จริง | ✅ ทำแล้ว |
| P7 | ผู้ใช้ต้องเห็นว่า "ตอนนี้ตัวเองอยู่รอบไหน / รอบของตัวเองเริ่มกี่โมง" | ✅ ทำแล้ว |
| P8 | ❌ ห้ามให้รอบพรีเซลกลายเป็นการ **แซงคิว** ในรอบเดียวกัน | ✅ กติกาบังคับในดีไซน์ |
| P9 | คอนเสิร์ตที่ไม่ตั้งรอบ = ขายแบบเดิมทุกประการ | ✅ ทำแล้ว + unit test คุม |
| P10 | ❌ ไม่มีสมาชิกแบบเสียเงิน (ต่างจาก Weverse ของจริง) | ✅ ตัดออกโดยตั้งใจ |

### 2.9 ซับสคริปชั่น / แพ็กเกจสมาชิก (Phase 2.2) 🆕

> ออกแบบเต็ม: [`22_SUBSCRIPTION.md`](22_SUBSCRIPTION.md)

| # | Requirement | สถานะ |
|---|---|---|
| S1 | ผู้ใช้เลือกแพ็กเกจได้: ระดับ (มาตรฐาน/พรีเมียม) × ระยะเวลา (1/3/12 เดือน) | ✅ ทำแล้ว |
| S2 | มีประวัติการสมัครแต่ละรอบ ตรวจย้อนหลังได้ | ✅ ทำแล้ว (ตาราง `Subscription`) |
| S3 | ต่ออายุแล้ววันที่เหลือต้องไม่หาย (รอบใหม่ต่อท้ายรอบเดิม) | ✅ ทำแล้ว |
| S4 | อัประดับเป็นพรีเมียมมีผลทันที · ลดระดับระหว่างรอบถูกกันไว้ | ✅ ทำแล้ว |
| S5 | ยกเลิกได้ และสิทธิ์ยังใช้ได้จนจบรอบที่สมัครไว้ | ✅ ทำแล้ว |
| S6 | มีเพดานสะสมสิทธิ์ล่วงหน้า (24 เดือน) | ✅ ทำแล้ว |
| S7 | สิทธิ์ที่ด่านตรวจใช้ต้องมาจากแหล่งเดียว (`Membership`) ไม่ใช่ตาราง ledger | ✅ ทำแล้ว |
| S8 | ❌ **ยังไม่เก็บเงินจริง** — ทุกแพ็กเกจ 0 บาท และหน้าจอเขียนกำกับชัด | ✅ ตามที่ทีมเคาะ 2026-08-20 |
| S9 | เปิดเก็บเงินทีหลังได้โดยไม่ต้องรื้อโครง (เว้นรอยต่อไว้) | ✅ ดู [22 §6](22_SUBSCRIPTION.md) |

### 2.10 บัตรหมด (SOLD OUT) + รอบมาตรฐาน (Phase 2.3) 🆕

> ออกแบบเต็ม: [`23_SOLD_OUT.md`](23_SOLD_OUT.md) · อ้างอิงพฤติกรรมผังคอน/เอเจนซี่ไทย

| # | Requirement | สถานะ |
|---|---|---|
| SO1 | ระบบต้องรู้เองว่าบัตรหมด ไม่ต้องรอแอดมินมากด | ✅ ทำแล้ว (ตรวจตอนออกตั๋วใบสุดท้าย) |
| SO2 | "บัตรหมด" = ไม่เหลือทั้งที่นั่งว่างและที่นั่งที่ค้างจ่าย | ✅ ทำแล้ว (กันประกาศเร็วเกินตอน hold ยังค้าง) |
| SO3 | บัตรหมดตั้งแต่รอบสมาชิก → รอบทั่วไปต้องไม่เปิดขาย | ✅ ทำแล้ว (รอบขึ้น "ไม่เปิดขาย — บัตรหมดก่อน") |
| SO4 | ขอเข้าคิวตอนบัตรหมด → ปฏิเสธพร้อมข้อความ "บัตรหมดแล้ว" | ✅ ทำแล้ว |
| SO5 | สถานะพลิกทิศทางเดียว (ON_SALE → SOLD_OUT) การเปิดขายใหม่เป็นสิทธิ์ของผู้จัด | ✅ ทำแล้ว |
| SO6 | การติดป้ายสถานะห้ามทำให้ "จ่ายเงินแล้วออกตั๋วสำเร็จ" กลายเป็นล้มเหลว | ✅ ทำแล้ว (แยก try/catch นอกทรานแซกชัน) |
| SO7 | ตั้งรอบ "สมาชิกกดก่อน N วัน แล้วต่อรอบทั่วไป" ได้ในคลิกเดียว | ✅ ทำแล้ว |

### 2.11 UX แบบเว็บกดบัตรจริง (Phase 2.4) 🆕

> ออกแบบเต็ม: [`24_STOREFRONT_UX.md`](24_STOREFRONT_UX.md)

| # | Requirement | สถานะ |
|---|---|---|
| U1 | ผู้ใช้ต้องกลับไปจ่ายเงิน order ที่ค้างได้ แม้ปิดแท็บ checkout ไปแล้ว | ✅ ทำแล้ว (`/account/orders`) |
| U2 | ผู้ใช้ยกเลิก order เองได้ และที่นั่งกลับเข้าระบบทันที | ✅ ทำแล้ว |
| U3 | order ที่หมดเวลาต้องแสดงว่า "หมดเวลา" ทันที ไม่รอ sweeper | ✅ ทำแล้ว (คำนวณสด) |
| U4 | เคส "เงินเข้าแต่ออกตั๋วไม่ได้" ต้องบอกผู้ใช้ว่ากำลังรอคืนเงิน | ✅ ทำแล้ว |
| U5 | มีนับถอยหลังก่อนเปิดขาย/เปิดรอบ และปลดล็อกเองเมื่อถึงเวลา | ✅ ทำแล้ว |
| U6 | ❌ ห้ามปลดล็อกสิทธิ์จากนาฬิกาเครื่องผู้ใช้ — server ต้องเป็นคนตัดสิน | ✅ ทำแล้ว (ถึงเวลาแล้วค่อย refetch) |
| U7 | ค้นหางานได้ทั้งชื่องานและสถานที่ + กรองตามสถานะ | ✅ ทำแล้ว |

---

## 3. Non-Functional Requirements

### 3.1 ค่าใช้จ่าย (Cost Constraint) 🆕
- ✅ **ทุกอย่างต้องไม่มีค่าใช้จ่าย** สำหรับ primary path
- ✅ ถ้ามี → ต้อง **ไม่แพง** + ทำเป็น **optional**
- ✅ Total cost = **0 บาท/เดือน** ✅

### 3.2 สกุลเงิน 🆕
- ✅ **THB (บาทไทย)** ทุก display, database, payment
- ✅ Format: `1,500 บาท` หรือ `฿1,500`

### 3.3 Deployment 🆕
- ✅ **Local only** — run บน laptop ตัวเอง
- ❌ ไม่มี cloud deploy
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

- ❌ Cloud deployment (Vercel, AWS, etc.)
- ❌ Mobile native app (ใช้ PWA แทน)
- ❌ Multi-language (รองรับ TH อย่างเดียว — EN เป็น future)
- ❌ Refund flow แบบ automated (manual admin ทำ)
- ❌ Resale market
- ❌ Live streaming concert
- ❌ Advanced analytics (ใช้ basic logging แทน)
- ❌ Multi-tenant (1 organization เท่านั้น)
- ❌ White-label / customization
- ❌ Real-name international payment
- ❌ สมาชิกแบบเสียเงิน / สมาชิกหลายระดับ (ชั้นเดียว ฟรี เท่านั้น)
- ❌ อีเมลแจ้งเตือนก่อนสมาชิกหมดอายุ (ไม่มีระบบ cron สำหรับอีเมลในโปรเจ็คนี้)

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
- [ ] docs/ ครบ 12 ไฟล์
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
| 2026-08-20 | "สมาชิกกดก่อน" = รอบเวลาแยก ไม่ใช่สิทธิ์แซงคิว | ถ้าให้แซงคิว คิวไม่ FIFO → สถิติ fairness/inversion ในเล่มต้องวัดใหม่ทั้งบท |
| 2026-08-20 | สมาชิกไม่มีสถานะ `EXPIRED` ใน DB (คำนวณสดจาก `expiresAt`) | ตัด failure mode "cron ไม่วิ่ง = คนหมดอายุยังเข้ารอบสมาชิกได้" |
| 2026-08-20 | ตรวจสิทธิ์สมาชิกที่ขาเข้า ไม่ตรวจตอนจ่ายเงิน | กันเคส "โอนเงินแล้วไม่ได้ตั๋ว" ซึ่งกลายเป็นงานคืนเงินค้าง |
| 2026-08-20 | สมาชิกสมัครฟรี ไม่มีสมาชิกแบบเสียเงิน | ถ้าคิดเงินต้องลากทางเดินเงิน/สลิป/คืนเงินทั้งเส้นเข้ามาเกี่ยว |
| 2026-08-20 | ลอกลำดับรอบพรีเซลจากแพลตฟอร์มจริง แต่ทำเป็น "ลำดับของรอบเวลา" เท่านั้น | ของจริงหลายเจ้าปนกับ queue priority — ถ้าลอกมาทั้งดุ้น คิวจะไม่ FIFO และผลวิจัยใช้ไม่ได้ |
| 2026-08-20 | เพิ่มการลงทะเบียนล่วงหน้า (แบบ Weverse) | ได้ยอดคนล่วงหน้าไว้ตั้ง cap คิว + กระจายโหลดออกจากวินาทีเปิดขาย + เป็นด่านที่บอทต้องมาสองรอบ |
| 2026-08-20 | เพดานตั๋วของรอบผ่อนให้หลวมกว่าคอนเสิร์ตไม่ได้ | กันรอบสมาชิกกลายเป็นช่องให้ซื้อได้มากกว่าคนทั่วไป (ขัดกับกลไกกันกวาดตั๋ว) |
| 2026-08-20 | ทำโครงซับสคริปชั่นก่อน แต่ยังไม่เปิดเก็บเงิน | ได้โครงข้อมูล/หน้าจอ/กติกาครบไว้ก่อน โดยไม่ต้องแตะทางเดินเงินจริงที่ยังเป็นจุดเสี่ยงสุดของระบบ |
| 2026-08-20 | แยก `Subscription` (ประวัติ) ออกจาก `Membership` (สิทธิ์ปัจจุบัน) | ถ้าให้ด่านตรวจอ่าน ledger จะกลายเป็นสองแหล่งความจริง และเคส "แอดมินให้สิทธิ์เอง" จะพัง |
| 2026-08-20 | เปลี่ยน "หน้าต่างต่ออายุ 30 วัน" → เพดานสะสม 24 เดือน | แพ็กเกจมีหลายระยะเวลา ถ้าล็อกหน้าต่าง 30 วันจะซื้อ 12 เดือนล่วงหน้าไม่ได้เลย |
| 2026-08-20 | ประกาศ SOLD OUT อัตโนมัติ แต่ไม่เปิดขายใหม่อัตโนมัติ | ประกาศช้า = ผู้ใช้เฝ้ารอเก้อ ส่วนการเปิดขายใหม่เป็นการตัดสินใจเชิงธุรกิจของผู้จัด |
| 2026-08-20 | นับที่นั่ง HELD เป็น "ยังไม่หมด" | ถ้านับแต่ AVAILABLE จะประกาศหมดตอน hold ค้าง พอ hold หลุดที่นั่งกลับมาแต่ป้ายค้างไปแล้ว |
| 2026-08-21 | ตัวนับถอยหลังไม่ปลดล็อกปุ่มเอง แต่ยิงถาม server ตอนถึงเวลา | นาฬิกาเครื่องผู้ใช้เชื่อไม่ได้ — ถ้าปล่อยให้ client ตัดสิน คนตั้งนาฬิกาเร็วจะได้เปรียบ |
| 2026-08-21 | ค้นหา/กรองงานทำฝั่ง client | หน้ารายการเป็นหน้าแคช + งานมีหลักสิบ → กรองในเครื่องเร็วกว่าและไม่เพิ่มโหลดวันเปิดขาย |

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
