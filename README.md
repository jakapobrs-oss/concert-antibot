# 🎫 Concert Anti-Bot System

> โปรเจ็คจบ ป.ตรี วิทยาการคอมพิวเตอร์
> ระบบจองบัตรคอนเสิร์ตออนไลน์ที่มีระบบป้องกันบอท **2 ชั้น** + คิวยุติธรรม (fairness queue) + ความปลอดภัยการจ่ายเงินจริง
> ขยายต่อจากวิจัย "ระบบแอนติบอทเพื่อวิเคราะห์การป้องกันบอทในการจองบัตรคอนเสิร์ต"

---

## 📚 เริ่มอ่านจากนี่

- [`docs/THESIS_GUIDE.md`](docs/THESIS_GUIDE.md) — **ข้อเท็จจริงที่ถูกต้อง (canonical facts)** — อ่านก่อนอ้างตัวเลขใดๆ
- [`docs/00_README.md`](docs/00_README.md) — index เอกสารทั้งหมด (บางไฟล์เขียนช่วงวางแผน ตัวเลขอาจเก่า — มีหมายเหตุกำกับ)
- [`docs/11_REQUIREMENTS.md`](docs/11_REQUIREMENTS.md) — requirements ทั้งหมด
- [`docs/15_PAYMENT_SECURITY.md`](docs/15_PAYMENT_SECURITY.md) — threat model การเงิน (T1–T10) + fix
- [`docs/17_GO_LIVE_CHECKLIST.md`](docs/17_GO_LIVE_CHECKLIST.md) — สิ่งที่ต้องทำก่อนขายจริง

## ✨ ฟีเจอร์หลัก

- **คิวยุติธรรม** — waiting room + `timeBucket`/`randomScore` (HMAC) ไม่วัดความเร็วมือกด กันบอทได้เปรียบ · capacity-aware admission ปล่อยคนเข้าห้องเลือกที่นั่งตามความจุจริง + แผงแอดมินคุมคิวสด
- **Anti-bot 2 ชั้น** — Layer 1: scoring (Turnstile + UA + headers + fingerprint → ALLOW/CHALLENGE/BLOCK) · Layer 2: behavior analysis แบบ escalate-only
- **จ่ายเงินจริง PromptPay QR + ตรวจสลิปอัตโนมัติ (EasySlip)** — fail-closed บน production · per-payer cap กัน account farming
- **Named ticket กัน scalper** — บัตรระบุชื่อผู้ถือ + QR เช็คอิน + ช่องคืนบัตรกลับเข้าระบบ ([docs/19](docs/19_NAMED_TICKET_PLAN.md))
- **Admin panel** — จัดการคอนเสิร์ต / คุมคิว / refund / check-in / bot log
- **AI chat ช่วยลูกค้า** (Gemini, stateless)

## 🚀 Quick Start (Local)

### Prerequisites
- Node.js **22.11+ LTS** · pnpm **9.15+** · Docker Desktop (Postgres 16 + Redis)

### Setup
```bash
cp .env.example .env    # เติมค่าตามคอมเมนต์ในไฟล์ (dev รันได้โดยไม่มี key จริง = โหมด mock)
pnpm install
pnpm db:up              # Postgres + Redis (MinIO ใน compose ยังไม่ถูกใช้โดยโค้ด — ไม่ต้องสนใจ)
pnpm db:migrate
pnpm db:seed
pnpm dev                # → http://localhost:3000
pnpm check:env          # เช็คว่า env ครบสำหรับโหมดที่ตั้งใจใช้
```

### Services
| Service | Port |
|---|---|
| Next.js dev | 3000 |
| Postgres 16 | 5432 |
| Redis | 6379 |

## 📐 Tech Stack (ของจริงที่ใช้ — รายละเอียดเต็ม: `docs/THESIS_GUIDE.md` §1)

- **Framework:** Next.js 15.5.20 (App Router) + React 19 + TypeScript 5.6
- **Database:** PostgreSQL 16 + Prisma 6.1 (15 models)
- **Cache/Queue/Lock:** Redis ผ่าน ioredis — queue / seat-hold (`SET NX` + TTL) / rate-limit / load-shed เขียนเองทั้งหมด (ไม่ใช้ BullMQ)
- **Auth:** NextAuth v5 (Auth.js) + Google OAuth + argon2id
- **Anti-bot:** Cloudflare Turnstile + FingerprintJS OSS + scoring/behavior เขียนเอง
- **Payment:** PromptPay QR + EasySlip API (slip verification)
- **Email:** Resend (REST fetch) · **AI:** Gemini
- **UI:** Tailwind 4 + shadcn/ui

## 🧪 Tests

| ชุด | คำสั่ง | สถานะล่าสุด (2026-07-16) |
|---|---|---|
| Unit — Vitest 22 ไฟล์ | `pnpm test:run` | ✅ **181/181** |
| Race/concurrency — Postgres+Redis จริง | `pnpm test:race` | ✅ **22 ผ่าน / 0 fail** |
| Typecheck | `pnpm typecheck` | ✅ 0 errors |
| Load — k6 | `pnpm test:load` | รันตามต้องการ |

ตัวเลข verify ล่าสุด + วิธีทวนซ้ำ: [`docs/HANDOFF-security-chapter-for-thesis.md`](docs/HANDOFF-security-chapter-for-thesis.md)

## 🔒 Security

- Threat model การเงิน T1–T10 + fix F1–F8 / H1–H4 / N1–N5: [`docs/15`](docs/15_PAYMENT_SECURITY.md) · audit: [`docs/18`](docs/18_SECURITY_AUDIT.md)
- ผ่านรีวิวความปลอดภัยแบบ cross-vendor (Claude + Codex GPT) ครบทั้ง 7 subsystem (มิ.ย.–ก.ค. 2026) — ปิดครบทุกข้อที่ยืนยันแล้ว
- Backlog ที่เหลือ + การตัดสินใจที่บันทึกไว้ (payment cascade, CSP nonce): [`docs/SECURITY_TODO.md`](docs/SECURITY_TODO.md)

## 📋 สถานะโปรเจ็ค (2026-07-16)

- ✅ ครบทุก phase (11/11) + named-ticket anti-scalper
- ✅ Security hardening ครบ 7 subsystem + race tests กับ DB จริง
- ✅ พร้อม demo / defense — dev-mock รันได้โดยไม่ต้องมี key จริง
- ⚠️ **ขายจริง** ยังติด go-live checklist ([`docs/17`](docs/17_GO_LIVE_CHECKLIST.md)) — rotate keys, env production, HTTPS ฯลฯ
- ☁️ มี QA preview บน Vercel (Hobby) ไว้ทดสอบ E2E — ตัวจริงยังเป็น local-first ตาม constraint เดิม

## ⚠️ หมายเหตุ

- **THB เท่านั้น** — payment ทุกอย่างเป็นบาท
- ไฟล์ `วิจัยระบบแอนติบอท finish.docx` ใน root = งานวิจัยต้นทาง อ่านอย่างเดียว ห้าม commit
