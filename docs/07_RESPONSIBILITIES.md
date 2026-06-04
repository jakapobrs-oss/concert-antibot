# 07 — แบ่งงาน: Claude ทำได้ vs User ต้องทำเอง

> ใช้ไฟล์นี้เป็น checklist ก่อนเริ่มแต่ละ phase
> 🤖 = Claude ทำได้ • 👤 = User ต้องทำ • 🤝 = ทำร่วมกัน

---

## 1. สิ่งที่ Claude ทำแทนได้ทั้งหมด 🤖

### 1.1 Coding / Implementation
- เขียน Next.js code ทั้งหมด (page, component, API route, server action)
- เขียน Prisma schema + migration
- เขียน Redis logic (queue, lock, rate limit)
- เขียน NextAuth config (credentials + Google provider)
- เขียน anti-bot engine (4-8 layers)
- เขียน behavior collector JS
- เขียน CAPTCHA integration (Turnstile)
- เขียน fingerprint integration
- เขียน mock payment + Stripe/Omise integration
- เขียน email template (React Email)
- เขียน QR code generator
- เขียน admin dashboard UI
- เขียน seat map component

### 1.2 Testing
- เขียน unit test (Vitest) ทุก service/util
- เขียน E2E test (Playwright) ทุก user flow
- เขียน load test script (k6) สำหรับ 1k/5k/10k concurrent
- เขียน bot simulation script (Puppeteer + curl) สำหรับทดสอบ anti-bot
- รัน test ใน local และดู output

### 1.3 DevOps
- สร้าง Dockerfile + docker-compose.yml
- สร้าง .env.example
- สร้าง GitHub Actions workflow (lint, typecheck, test, build, deploy)
- เขียน Caddyfile / nginx config
- เขียน pg_dump backup script
- เขียน Prisma seed script + demo data

### 1.4 Documentation
- เขียน / อัปเดต README, ADR, runbook
- เขียน API documentation (OpenAPI/Swagger)
- render Mermaid diagram เป็น PNG/SVG สำหรับ thesis
- comment ภาษาไทยใน code
- เขียนเนื้อหา thesis (draft) — chapter 3 method, chapter 4 results, chapter 5 conclusion

### 1.5 Code Quality
- setup ESLint, Prettier, Husky, lint-staged, Commitlint
- code review ด้วยตัวเอง (ใช้ skill `/code-review`)
- refactor ตามที่ user สั่ง
- debug bug ที่ user รายงาน

### 1.6 Setup ที่ไม่ต้องใช้ external account
- `git init` และ commit แรก
- scaffold Next.js, ติดตั้ง dependency
- รัน docker-compose ใน local
- รัน migration, seed, dev server
- generate password hash, JWT secret, random tokens

---

## 2. สิ่งที่ User ต้องทำเอง 👤

> สิ่งเหล่านี้ Claude ทำไม่ได้เพราะต้องใช้ตัวตน, บัตรเครดิต, หรือเป็นการตัดสินใจทางธุรกิจ

### 2.1 สมัครบัญชี + เอา API Key (สำคัญที่สุด)
| บริการ | ทำอะไร | ต้องส่งให้ Claude |
|---|---|---|
| 👤 **Google Cloud Console** | สร้าง OAuth Client ID สำหรับ Google Login | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| 👤 **Cloudflare** | สมัคร + เพิ่ม site → ได้ Turnstile keys | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |
| 👤 **Resend** | สมัคร → verify domain → API key | `RESEND_API_KEY`, `EMAIL_FROM` |
| 👤 **Stripe** (ตอน Phase 7) | สมัคร merchant → test mode keys | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| 👤 **Omise** (ทางเลือก) | merchant ไทย | `OMISE_PUBLIC_KEY`, `OMISE_SECRET_KEY` |
| 👤 **Cloudflare R2** | สร้าง bucket + API token | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET`, `R2_BUCKET` |
| 👤 **Upstash** (ถ้าเลือก) | สมัคร → สร้าง Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| 👤 **Sentry** (optional) | สร้าง project | `SENTRY_DSN` |
| 👤 **UptimeRobot** (optional) | สมัคร + เพิ่ม monitor | (URL ของระบบ) |
| 👤 **GitHub** | สร้าง repo (push code) | repo URL |
| 👤 **Domain registrar** | ซื้อโดเมน | domain name |

### 2.2 การตัดสินใจทางธุรกิจ
- 👤 ตั้งราคาบัตร, จำนวนโซน, จำนวนที่นั่งต่อโซน
- 👤 ตั้งเวลาเปิด/ปิดขาย, max ticket per user
- 👤 เลือกรูปแบบ refund policy
- 👤 เลือกข้อมูลคอนเสิร์ตจริง (หรือ fake สำหรับ demo)
- 👤 อัปโหลดรูปคอนเสิร์ต (artwork)
- 👤 เขียน Terms of Service / Privacy Policy (Claude ช่วย draft ได้)
- 👤 ตัดสินใจสี/branding ของเว็บ (Claude เสนอ palette ได้)

### 2.3 Hosting / Deploy
- 👤 ตัดสินใจเลือก hosting (Vercel / Hetzner / Railway / etc.)
- 👤 ซื้อ VPS หรือ subscribe Vercel Pro (ใช้บัตรเครดิต)
- 👤 ผูก domain กับ DNS
- 👤 จ่ายค่า VPS รายเดือน

### 2.4 Verify / Manual Test
- 👤 ทดลองใช้จริงบน iPhone 13 Pro ของ user (mobile UX)
- 👤 ทดลอง Google login ด้วย account จริง
- 👤 ทดลองรับ OTP ทางเบอร์โทรจริง
- 👤 ทดลองจ่ายเงิน (Stripe test mode → real test)
- 👤 ทดสอบ accessibility กับ user จริง (~30 คน) สำหรับ SUS

### 2.5 ปริญญานิพนธ์ / วิชาการ
- 👤 ส่ง draft thesis ให้อาจารย์ที่ปรึกษา review
- 👤 ตอบ comment อาจารย์
- 👤 ส่งสอบ + present
- 👤 ส่งเอกสารบัณฑิตวิทยาลัย
- 👤 (Claude ช่วย draft, edit, format, ทำ diagram, ทำ table)

### 2.6 Security ที่ user ต้องเก็บเอง
- 👤 เก็บ admin password, API keys ใน password manager
- 👤 ห้าม commit `.env.local` ลง git (Claude จะ gitignore ให้)
- 👤 ตรวจ Google account ที่ login OAuth ว่าเปิด 2FA แล้ว
- 👤 ถ้า credentials หลุด → ต้อง revoke เอง (Claude บอกขั้นตอนได้)

---

## 3. ทำร่วมกัน 🤝

| งาน | Claude ทำ | User ทำ |
|---|---|---|
| **Load test** | เขียน script, ตั้ง scenario, run ใน local | ดู report, ตัดสินใจว่าผ่าน/ไม่ผ่าน |
| **Bot test** | เขียน bot simulator + รัน | ดูผล, decide ว่าจะ tighten rule ไหน |
| **User testing** | เตรียม task list, ทำแบบฟอร์ม SUS | หา tester 30 คน, นัด, สังเกตการณ์ |
| **Deploy ครั้งแรก** | เขียน deploy script, runbook | login VPS, รัน script, confirm |
| **Migration ใน production** | เขียน migration + rollback plan | approve before run, observe |
| **Domain setup** | เขียน DNS record ที่ต้องใส่ | login registrar, paste DNS |
| **Sale day** | monitor metrics, debug | watch + decide pull plug ถ้าเกิดปัญหา |

---

## 4. Decision Points ที่ต้องการ user input ก่อนเริ่ม

> Claude **ต้องถาม** ก่อนเริ่ม implement ใน decision เหล่านี้

| # | คำถาม | ทางเลือก | default ถ้าไม่ตอบ |
|---|---|---|---|
| D1 | ใช้ Postgres หรือ MySQL? | Postgres / MySQL | **Postgres 16** |
| D2 | Deploy ที่ไหน? | Vercel / VPS / Railway | **เริ่มที่ local + Docker** |
| D3 | ใช้ Cloudflare Turnstile หรือ hCaptcha? | Turnstile / hCaptcha | **Turnstile** (ฟรีกว่า) |
| D4 | Payment provider? | Stripe / Omise / mock | **mock** จนกว่าจะถึง Phase 7 |
| D5 | UI accent color? | ม่วง / ฟ้า / แดง / กำหนดเอง | **ม่วง** (#7C3AED) |
| D6 | ภาษาเริ่มต้น? | TH / EN / ทั้งคู่ | **TH** |
| D7 | Mobile-first หรือ Desktop-first? | M / D | **Mobile-first** |
| D8 | ติดตั้งบนเครื่องเดียว หรือแยก service? | mono / micro | **mono (one Next.js)** |

> Claude จะใช้ default ถ้า user ไม่ตอบใน 1 round

---

## 5. Handoff Checklist (เมื่อ user มา/ไป)

### เมื่อ user กลับมาทำงานต่อ
1. อ่าน `docs/00_README.md` index
2. ดู `docs/01_PLAN.md §4` progress tracker
3. เปิด Claude session ใหม่ → บอกว่า "ต่อจาก Phase X"

### เมื่อ user ส่งต่อให้คนอื่น
1. แชร์ docs/ ทั้งโฟลเดอร์
2. แชร์ `.env.example` (ไม่ใช่ `.env.local`)
3. ส่ง list ของ external accounts ที่ต้อง onboard
4. ส่ง credential ผ่านช่องทางปลอดภัย (ไม่ใช่ chat/email)

---

## 6. สรุปสั้น (TL;DR)

> **Claude:** เขียน code, test, doc, devops config ทั้งหมด
> **User:** สมัคร account, จ่ายเงิน, อนุมัติ, test บนเครื่องจริง, ส่งอาจารย์
> **ทำคู่:** deploy, monitoring, ตัดสินใจ scope
