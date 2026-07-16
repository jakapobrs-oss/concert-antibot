# 11 — Requirements (Single Source of Truth)

> ไฟล์นี้รวม **ทุก requirement ที่ user เคยพูดในทุก session**
> ใช้เป็นจุดอ้างอิงเดียว — ถ้าไฟล์อื่นขัดแย้งกับไฟล์นี้ → ไฟล์นี้ถูก
> อัปเดต: 2026-05-25 rev 3

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
