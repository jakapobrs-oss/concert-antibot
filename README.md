# 🎫 Concert Anti-Bot System

> โปรเจ็คจบ ป.ตรี วิทยาการคอมพิวเตอร์
> ระบบจองบัตรคอนเสิร์ตที่มี anti-bot 8 ชั้น + fairness queue
> ขยายต่อจากวิจัย "ระบบแอนติบอทเพื่อวิเคราะห์การป้องกันบอทในการจองบัตรคอนเสิร์ต"

---

## 📚 เริ่มอ่านจากนี่
- [`docs/00_README.md`](docs/00_README.md) — index ทั้งหมด
- [`docs/01_PLAN.md`](docs/01_PLAN.md) — master plan + progress tracker
- [`docs/11_REQUIREMENTS.md`](docs/11_REQUIREMENTS.md) — single source of truth
- [`docs/12_CHANGELOG.md`](docs/12_CHANGELOG.md) — revision history

---

## 🚀 Quick Start (Local)

### Prerequisites
- Node.js **22.11+ LTS**
- pnpm **9.15+** (`npm install -g pnpm`)
- Docker Desktop (สำหรับ Postgres + Redis + MinIO)

### Setup
```bash
# 1. คัดลอก .env.example เป็น .env แล้วเติมค่า
cp .env.example .env

# 2. รัน Docker services (Postgres + Redis + MinIO)
pnpm db:up

# 3. ติดตั้ง dependencies (ทำใน Phase 1.2 ของ session ถัดไป)
pnpm install

# 4. รัน Prisma migration
pnpm db:migrate

# 5. รัน dev server
pnpm dev
```

เปิด http://localhost:3000

### Services
| Service | Port | URL |
|---|---|---|
| Next.js dev | 3000 | http://localhost:3000 |
| Postgres | 5432 | `postgresql://concert:***@localhost:5432/concert_antibot` |
| Redis | 6379 | `redis://localhost:6379` |
| MinIO API | 9000 | http://localhost:9000 |
| MinIO Console | 9001 | http://localhost:9001 |

---

## 📐 Tech Stack (ดู `docs/03_TOOLS_AND_VERSIONS.md`)
- **Framework:** Next.js 15.1 + React 19 + TypeScript 5.6
- **Database:** PostgreSQL 16.6 + Prisma 6.1 (BIGSERIAL ids)
- **Cache/Queue:** Redis 7.4 + BullMQ
- **Auth:** NextAuth v5 + Google OAuth + argon2id
- **UI:** Tailwind 4 + shadcn/ui
- **Anti-bot:** Cloudflare Turnstile + FingerprintJS OSS + isbot
- **Payment:** PromptPay QR + EasySlip API (ฟรี + เงินเข้าจริง)

**Total cost = 0 บาท/เดือน** ✅

---

## 🏗 Folder Structure
```
.
├── docs/              ← เอกสารทั้งหมด (อ่านก่อนเริ่ม)
├── app/               ← Next.js App Router (Phase 1.2+)
├── components/        ← React components
├── lib/               ← shared utilities
├── prisma/            ← schema + migrations + seed
├── public/            ← static assets
├── tests/             ← unit + e2e + load
├── scripts/           ← maintenance scripts
├── docker-compose.yml
├── .env.example
└── package.json
```

---

## 📋 Progress
- ✅ Phase 0 — Planning & Docs (13 files in `docs/`)
- ✅ Phase 1 — Setup (config, layout, lib, Prisma client)
- ✅ Phase 2 — Auth (NextAuth v5 + Google + Email/Password + argon2id)
- ✅ Phase 3 — Concert CRUD + public listing + seat map UI
- ⚪ Phase 4-10 — รอลำดับ (Queue, Anti-bot, Payment, Logging, Test)

> ⚠️ Phase 1-3 = **code เขียนเสร็จแล้ว** แต่ยังต้องรัน `pnpm install` + `docker compose up` +
> `pnpm db:migrate` + `pnpm db:seed` เพื่อ verify (ดู Setup ด้านบน)

ดู `docs/01_PLAN.md §4` + `docs/12_CHANGELOG.md` (Revision 4) สำหรับรายละเอียด

---

## ⚠️ หมายเหตุ
- **Local-only** — ไม่ deploy cloud (ตาม constraint)
- **THB เท่านั้น** — payment ทุกอย่างเป็นบาท
- ไฟล์ `วิจัยระบบแอนติบอท finish.docx` ใน root = อ่านอย่างเดียว, ห้าม commit
