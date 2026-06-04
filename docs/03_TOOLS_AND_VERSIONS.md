# 03 — เครื่องมือและ Version Lock

> ทุก version ตรวจแล้วว่า **เข้ากันได้และเสถียร** ณ Q4 2025 (ตัวเลือก LTS / Stable เท่านั้น)
> ห้ามอัปเดต major version โดยไม่ทดสอบใหม่
> ดู rationale ในแต่ละช่องว่าทำไมเลือก version นี้
> 🇹🇭 ทุกที่ที่เกี่ยวกับเงิน = **THB (บาท)** เป็น default

---

## 💰 Cost Tier Legend

ทุก tool ในไฟล์นี้แบ่งเป็น 3 tier:

| Tier | ความหมาย | ใช้กับโปรเจ็คนี้? |
|---|---|---|
| 🟢 **Tier 1** | ฟรี 100% ตลอดไป (open source, self-host) | ✅ ต้องใช้ |
| 🟡 **Tier 2** | Free tier (มีจำกัด แต่พอใช้สำหรับ thesis) | ✅ ใช้ ถ้าไม่เกิน limit |
| 🔴 **Tier 3** | จ่ายเงิน (mark เป็น optional) | ⚪ ใช้เฉพาะถ้าอัปเกรด/อนาคต |

> Default: เลือก Tier 1 ก่อนเสมอ → Tier 2 ถ้าจำเป็น → Tier 3 มี optional only

---

## 🆓 Quick Summary: ทุกอย่างใน Primary Stack ฟรีหมด

| ส่วน | ตัวที่ใช้ | Tier |
|---|---|---|
| Framework, DB, Cache, ORM, Auth, UI | open source | 🟢 |
| Cloudflare Turnstile, Tunnel | unlimited free | 🟢 |
| FingerprintJS OSS | open source | 🟢 |
| MinIO (file local), Docker | open source | 🟢 |
| **Payment: PromptPay + EasySlip free** | ฟรี + เงินเข้าจริง | 🟢🟡 |
| Google OAuth | ฟรี | 🟢 |
| Resend (email) | 3000/เดือนฟรี | 🟡 |
| Sentry, UptimeRobot | free tier | 🟡 |

**Total cost ทำโปรเจ็คเดือนนี้ = 0 บาท** ✅

---

## 1. Runtime & Language

| Tool | Version | เหตุผล |
|---|---|---|
| Node.js | **22.11.0 LTS** (Jod) | LTS active จนถึง 2027-04, Next.js 15 require >= 18.18 |
| pnpm | **9.15.x** | เร็ว, disk space ต่ำ, lockfile ดีกว่า npm |
| TypeScript | **5.6.3** | stable ก่อน 5.7, รองรับ Next 15 ดีที่สุด |

---

## 2. Web Framework

| Tool | Version | เหตุผล |
|---|---|---|
| Next.js | **15.1.x** | App Router stable, Server Actions, Turbopack dev |
| React | **19.0.0** | มาพร้อม Next 15, รองรับ `use()` hook |
| React DOM | **19.0.0** | match React |

> **ทางเลือก optional:** ถ้าทีมไม่ถนัด Next App Router ใช้ Next 14.2 Pages Router ก็ได้ (ยัง maintain)

---

## 3. Database & ORM

| Tool | Version | เหตุผล |
|---|---|---|
| PostgreSQL | **16.6** | Stable LTS, รองรับ JSONB, partial index, BIGSERIAL |
| Prisma | **6.1.0** | รองรับ Postgres 16 ดีสุด, มี Accelerate optional |
| @prisma/client | **6.1.0** | match Prisma CLI |

**ทำไม Postgres ไม่ใช่ MySQL?**
- BIGSERIAL = id ตัวเลข auto-increment ตามที่ user ขอ (MySQL ก็มี BIGINT AUTO_INCREMENT)
- JSONB type สำหรับเก็บ behavior event payload (ดีกว่า MySQL JSON)
- partial index ลด index size
- SELECT FOR UPDATE SKIP LOCKED ดีกว่าสำหรับ queue/seat hold
- **แต่ถ้าอยากใช้ MySQL ตามวิจัยเดิม** → ใช้ MySQL 8.4.3 LTS + Prisma ได้เลย เปลี่ยนแค่ provider

---

## 4. Cache / Queue / Rate Limit

| Tool | Version | เหตุผล |
|---|---|---|
| Redis | **7.4.x** | LTS, รองรับ SETNX + EXPIRE + pub/sub |
| ioredis | **5.4.x** | client ที่ stable ที่สุดบน Node |
| @upstash/ratelimit | **2.0.x** | sliding window, edge-compatible |
| @upstash/redis | **1.34.x** | ถ้าใช้ Upstash serverless |

---

## 5. Authentication

| Tool | Version | เหตุผล |
|---|---|---|
| next-auth (Auth.js) | **5.0.0-beta.25** | v5 stable enough for prod, รองรับ Next 15 |
| @auth/prisma-adapter | **2.7.x** | ผูก Prisma schema |
| argon2 | **0.41.x** | password hashing — modern, ดีกว่า bcrypt |
| jose | **5.9.x** | JWT verify (ถ้าต้องการ) |

---

## 6. Anti-Bot & Security

| Tool | Version | เหตุผล |
|---|---|---|
| Cloudflare Turnstile | (cloud service) | ฟรี, ไม่ track user, จัดการ CAPTCHA invisible |
| @fingerprintjs/fingerprintjs | **4.5.x** (OSS) | browser fingerprint open-source |
| isbot | **5.1.x** | detect crawler จาก User-Agent |
| helmet | (ผ่าน Next config) | security headers |
| zod | **3.23.x** | input validation ทุก API |

---

## 7. UI / Styling

| Tool | Version | เหตุผล |
|---|---|---|
| Tailwind CSS | **4.0.0** (stable Q4 2025) | ใหม่, เร็ว, CSS-first config |
| shadcn/ui | (latest, copy-paste) | accessible components, customizable |
| lucide-react | **0.469.x** | icons |
| sonner | **1.7.x** | toast notifications |
| framer-motion | **11.15.x** | animations (optional) |

---

## 8. Realtime

| Option | Version | เหตุผล |
|---|---|---|
| Server-Sent Events (SSE) | native | ใช้ Next route handler streaming, เพียงพอสำหรับ queue update |
| (optional) Socket.IO | **4.8.x** | ถ้าต้อง bi-directional |
| (optional) Pusher Channels | (cloud) | ถ้าไม่อยาก self-host |

---

## 9. Email / OTP

| Tool | Version | เหตุผล |
|---|---|---|
| Resend | **4.0.x** SDK | dev ดีมาก, ฟรี 3000/month |
| react-email | **3.0.x** | สร้าง email template ด้วย React |
| (optional) Twilio | **5.4.x** | ถ้าต้องการ SMS OTP |

---

## 10. Payment (ฟรี + เงินเข้าจริง — ดูเต็มใน [10_PAYMENT_PROVIDERS.md](10_PAYMENT_PROVIDERS.md))

### Primary Path (🟢 + 🟡 ฟรี 100%)
| Tool | Version | Tier | เหตุผล |
|---|---|---|---|
| **promptpay-qr** | **0.5.x** | 🟢 | generate PromptPay payload, ฟรี open source |
| **qrcode** | **1.5.x** | 🟢 | render QR เป็น PNG/SVG |
| **EasySlip API** | (cloud) | 🟡 | verify slip ฟรี 500 calls/เดือน — TH-native |
| (alt) SlipOK API | (cloud) | 🟡 | fallback ฟรี 100/วัน |

**คุณสมบัติ:**
- 💰 ฟรี 100% (ไม่มี % หัก, ไม่มีรายเดือน)
- 🇹🇭 เงินเข้าบัญชี user จริง (ผูกกับเบอร์/บัตรปชช.)
- ✅ ทดสอบ end-to-end ได้ฟรี โดยโอน 1 บาทตัวเอง

### Optional (🔴 เพิ่มถ้าต้องการบัตรเครดิต)
| Tool | Version | Cost |
|---|---|---|
| omise (Node SDK) | **0.13.x** | sandbox ฟรี, live 3.65% + 11 บ./tx |
| omise-js | latest | tokenize card |
| stripe | **17.x** | sandbox ฟรี, live 3.65% + 10 บ./tx |

> Default ของโปรเจ็คนี้: **PromptPay-only** — ตัด Omise/Stripe ออก (เพิ่มถ้าจำเป็น)

---

## 11. Testing

| Tool | Version | เหตุผล |
|---|---|---|
| Vitest | **2.1.x** | เร็ว, รองรับ ESM, native TS |
| Playwright | **1.49.x** | E2E browser testing |
| @testing-library/react | **16.1.x** | component test |
| k6 | **0.55.x** | load test, scriptable JS |
| MSW | **2.7.x** | mock API in test |

---

## 12. DevOps

| Tool | Version | เหตุผล |
|---|---|---|
| Docker Engine | **27.4.x** | stable |
| docker-compose | **v2 plugin** | included in modern docker |
| GitHub Actions | (cloud) | CI |
| Sentry | **8.45.x** SDK | error tracking (optional) |
| pino | **9.5.x** | structured logging |

---

## 13. Dev Tools

| Tool | Version | เหตุผล |
|---|---|---|
| ESLint | **9.17.x** | flat config |
| Prettier | **3.4.x** | format |
| Husky | **9.1.x** | git hooks |
| lint-staged | **15.2.x** | pre-commit |
| Commitlint | **19.6.x** | conventional commits |

---

## 13b. File Storage (รูปคอนเสิร์ต, QR, attachment)

| Tool | Version / Plan | เหตุผล |
|---|---|---|
| **MinIO** (local docker) | **2024.12.x** | ⭐ ใช้ตัวนี้ — S3-compatible, รันบน laptop ได้ ฟรี |
| Cloudflare R2 | (cloud) | สำหรับอนาคตถ้า deploy |
| AWS S3 / Cloudinary | (cloud) | สำหรับอนาคตถ้า deploy |
| @aws-sdk/client-s3 | **3.700.x** | client ใช้ได้กับ MinIO + R2 + S3 (เปลี่ยน endpoint อย่างเดียว) |
| sharp | **0.33.x** | resize/optimize รูปก่อน upload |

> **เลือก MinIO** เพราะรัน local ได้ทันที, code เหมือน S3 100% ถ้าวันหลังย้ายไปได้เลย

---

## 13c. QR Code & Ticket PDF

| Tool | Version | เหตุผล |
|---|---|---|
| qrcode | **1.5.x** | generate QR string → PNG/SVG |
| @react-pdf/renderer | **4.1.x** | สร้าง PDF ticket (optional) |
| pdf-lib | **1.17.x** | manipulate PDF |

---

## 13d. Background Jobs / Cron

| Tool | Version | ใช้ทำอะไร |
|---|---|---|
| BullMQ | **5.34.x** | queue jobs ผ่าน Redis (send email, expire seats, refund) |
| node-cron | **3.0.x** | simple cron (cleanup logs daily) |
| (alternative) Vercel Cron | (cloud) | ถ้า deploy บน Vercel |
| (alternative) GitHub Actions schedule | (cloud) | trigger external endpoint |

> **แนะนำ:** BullMQ ดีที่สุดเพราะใช้ Redis ที่มีอยู่แล้ว

---

## 13e. Hosting / Deployment

> ⚠️ **โปรเจ็คนี้ไม่ deploy** (รัน local เท่านั้น ตาม [09_LOCAL_PRESENTATION.md](09_LOCAL_PRESENTATION.md))
> ข้อมูลด้านล่างเก็บไว้สำหรับ **อนาคต** ถ้าอยาก deploy ขายจริง

ขึ้นกับงบและ scale ที่ต้องการ:

| ตัวเลือก | ราคา/เดือน | ข้อดี | ข้อเสีย |
|---|---|---|---|
| **Vercel** (Pro) | $20+ | deploy 1 คลิก, edge, auto-scale | แพงเมื่อโหลดเยอะ, ต้องแยก DB |
| **Railway** | $5+ usage | all-in-one (DB+Redis+app), ง่าย | scale จำกัด |
| **Fly.io** | $5+ usage | global edge, docker-native | learning curve |
| **Hetzner Cloud** (VPS) | €4+ | คุ้มสุด, 8GB RAM €4 | ต้องตั้งเองหมด |
| **DigitalOcean** | $6+ | UI ดี, droplet+managed DB | แพงกว่า Hetzner |
| **Contabo** | €4+ | spec สูงราคาถูกมาก | network ช้าจาก SEA |

> **แนะนำสำหรับโครงงาน:** Hetzner VPS €4/เดือน + Docker Compose (Postgres+Redis+Next ในเครื่องเดียว) → คุ้มและสมจริง
> **ถ้าอยาก deploy เร็ว:** Vercel + Neon (Postgres) + Upstash (Redis) — มี free tier ครบ

---

## 13f. Reverse Proxy + TLS (prod)

| Tool | Version | เหตุผล |
|---|---|---|
| **Caddy** | **2.8.x** | auto HTTPS ผ่าน Let's Encrypt, config สั้น — **แนะนำ** |
| Nginx | **1.27.x** | classic, มี module เยอะ |
| Traefik | **3.2.x** | docker-aware, dashboard |
| Cloudflare Tunnel | (cloud) | proxy ผ่าน CF, ไม่ต้องเปิด port |

---

## 13g. DNS / Domain

| Tool | ราคา/ปี | เหตุผล |
|---|---|---|
| **Cloudflare Registrar** | at-cost | ไม่บวกเพิ่ม + DNS ฟรี — **แนะนำ** |
| Namecheap | $10-15 | popular, UI ดี |
| Porkbun | $9-11 | ราคาดี, support ดี |

> Domain ตัวอย่าง: `concertbook.local` (dev), `<ชื่อโปรเจ็ค>.dev` หรือ `.app` (prod)

---

## 13h. Monitoring + Logging

| Tool | Free tier | เหตุผล |
|---|---|---|
| **Sentry** | 5k errors/month | error tracking — **แนะนำ** |
| **UptimeRobot** | 50 monitors | ping ทุก 5 นาที |
| BetterStack | 10 monitors + log mgmt | UI สวย |
| Healthchecks.io | 20 checks | cron monitoring (ดี+ฟรี) |
| Grafana Cloud | 50GB log, 10k metrics | full stack obs |
| (self-host) Prometheus + Grafana | ฟรี | ถ้ามี VPS |

---

## 13i. Database Backup

| Tool | ใช้ทำอะไร |
|---|---|
| **pg_dump + cron** | dump รายวัน → upload R2 — basic ที่ทำเองได้ |
| **WAL-G** | continuous WAL archive ไป S3 — สำหรับ point-in-time recovery |
| **pgBackRest** | enterprise-grade incremental backup |
| **Neon / Supabase** built-in | ถ้าใช้ managed Postgres ได้ฟรี |

> **แนะนำ:** pg_dump รายวัน + WAL-G ถ้าต้องการ PITR

---

## 13j. Container Registry

| Tool | Free tier | เหตุผล |
|---|---|---|
| **GitHub Container Registry (GHCR)** | unlimited public, 500MB private | ใช้คู่กับ GitHub Actions ดีสุด |
| Docker Hub | 1 private repo ฟรี | classic แต่ rate limit |
| Cloudflare Registry | ฟรี | เพิ่งออก, ใช้คู่ R2 ดี |

---

## 13k. Secrets Management

| Tool | เหตุผล |
|---|---|
| **`.env.local` + `.env.example`** | dev — pattern มาตรฐาน Next.js |
| **Doppler** (cloud, ฟรี 5 users) | sync secrets ระหว่าง dev / prod |
| **1Password Secrets Automation** | ถ้าใช้ 1Password อยู่แล้ว |
| **HashiCorp Vault** | enterprise — overkill สำหรับโครงงาน |

> สำหรับโครงงาน: ใช้ `.env.local` พอ + เก็บ backup ที่ปลอดภัย

---

## 13l. SMS / Push Notification

| Tool | Free tier | เหตุผล |
|---|---|---|
| Twilio | $15 trial credit | global SMS |
| **MessageBird** | $5 free | TH-friendly |
| ThaiBulkSMS | จ่ายต่อข้อความ | สำหรับเบอร์ไทยเท่านั้น (ถูกสุด) |
| Web Push (VAPID) | ฟรี | browser notification |

---

## 14. Compatibility Matrix (ทดสอบเข้ากันได้)

```
Node 22.11 LTS
 ├── Next.js 15.1 ✅
 │    ├── React 19.0 ✅
 │    ├── Turbopack (dev) ✅
 │    └── TypeScript 5.6 ✅
 ├── Prisma 6.1 ✅
 │    └── PostgreSQL 16.6 ✅
 ├── NextAuth 5.0-beta ✅
 │    └── @auth/prisma-adapter 2.7 ✅
 ├── ioredis 5.4 ✅
 │    └── Redis 7.4 ✅
 └── Tailwind 4.0 ✅ (PostCSS 8.4)
```

**❌ Combinations ห้ามใช้:**
- Next.js 15 + React 18 → use React 19
- Prisma 5 + Next.js 15 turbopack → upgrade Prisma 6
- NextAuth v4 + Next 15 App Router → use v5 (Auth.js)

---

## 15. package.json — เวอร์ชั่นที่ต้อง pin

```json
{
  "engines": {
    "node": "22.11.0",
    "pnpm": "9.15.0"
  },
  "dependencies": {
    "next": "15.1.3",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "@prisma/client": "6.1.0",
    "next-auth": "5.0.0-beta.25",
    "@auth/prisma-adapter": "2.7.4",
    "argon2": "0.41.1",
    "ioredis": "5.4.2",
    "@upstash/ratelimit": "2.0.5",
    "zod": "3.23.8",
    "@fingerprintjs/fingerprintjs": "4.5.1",
    "isbot": "5.1.17",
    "pino": "9.5.0",
    "sonner": "1.7.1",
    "lucide-react": "0.469.0",
    "qrcode": "1.5.4",
    "sharp": "0.33.5",
    "bullmq": "5.34.0",
    "@aws-sdk/client-s3": "3.717.0",
    "resend": "4.0.1",
    "react-email": "3.0.4",
    "promptpay-qr": "0.5.0"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "prisma": "6.1.0",
    "tailwindcss": "4.0.0",
    "vitest": "2.1.8",
    "@playwright/test": "1.49.1",
    "eslint": "9.17.0",
    "prettier": "3.4.2"
  }
}
```

> **กฎ:** อัปเดต patch ได้ (`x.y.Z`), minor ระวัง, major ต้องทดสอบใหม่ทั้งหมด

---

## 16. 💰 Cost Audit — ตารางสรุปค่าใช้จ่ายทั้งโปรเจ็ค

| รายการ | Tier | ค่าใช้จ่าย/เดือน | จำเป็น? |
|---|---|---|---|
| Node, Next, React, TypeScript, Prisma | 🟢 | 0 บ. | ✅ ใช่ |
| PostgreSQL, Redis, MinIO (Docker local) | 🟢 | 0 บ. | ✅ ใช่ |
| Tailwind, shadcn, lucide | 🟢 | 0 บ. | ✅ ใช่ |
| NextAuth + argon2 | 🟢 | 0 บ. | ✅ ใช่ |
| Cloudflare Turnstile | 🟢 | 0 บ. unlimited | ✅ ใช่ |
| Cloudflare Tunnel (demo HTTPS) | 🟢 | 0 บ. | ✅ ใช่ |
| FingerprintJS OSS | 🟢 | 0 บ. | ✅ ใช่ |
| promptpay-qr + qrcode | 🟢 | 0 บ. | ✅ ใช่ |
| Google OAuth (Google Cloud) | 🟢 | 0 บ. | ✅ ใช่ |
| GitHub (public repo) | 🟢 | 0 บ. | ✅ ใช่ |
| **EasySlip API** | 🟡 | 0 บ. (500/เดือน free) | ✅ ใช่ |
| Resend (email + OTP) | 🟡 | 0 บ. (3000/เดือน free) | ✅ ใช่ |
| Sentry (error tracking) | 🟡 | 0 บ. (5k/เดือน free) | ⚪ optional |
| UptimeRobot | 🟡 | 0 บ. (50 monitors free) | ⚪ optional (ไม่ deploy) |
| **รวม (essential)** | | **0 บ./เดือน** | |
| --- | --- | --- | --- |
| Omise card (live) | 🔴 | 3.65% + 11 บ./tx | ⚪ ไม่ใช่ |
| Stripe live | 🔴 | 3.65% + 10 บ./tx | ⚪ ไม่ใช่ |
| VPS Hetzner | 🔴 | ~150 บ./เดือน | ⚪ ไม่ใช่ (local only) |
| Vercel Pro | 🔴 | ~700 บ./เดือน | ⚪ ไม่ใช่ |
| Domain | 🔴 | ~400 บ./ปี | ⚪ ไม่ใช่ |
| Cloudflare R2 (prod) | 🔴 | ~10 บ./เดือน | ⚪ ไม่ใช่ (MinIO local) |
| Twilio SMS | 🔴 | ~0.50 บ./ข้อความ | ⚪ optional |

**สรุป Total = 0 บาท/เดือน** สำหรับโปรเจ็คตามที่ user ต้องการ ✅

---

## 17. Optional ที่ดี (ถ้ามีงบ แต่ไม่จำเป็น)

ถ้า user **อยาก** เพิ่มก็ดี แต่ไม่ใส่ก็ไม่กระทบโปรเจ็ค:

| ของดี | Cost | ทำไมดี | สำคัญแค่ไหน |
|---|---|---|---|
| Cloudflare Tunnel ถาวร (named) | ฟรี + domain | URL คงที่สำหรับ demo | ⚪ nice |
| Domain .com / .dev | ~400 บ./ปี | ดูเป็นมืออาชีพ | ⚪ ไม่จำเป็น |
| GitHub Copilot | ~300 บ./เดือน | code เร็วขึ้น | ⚪ มี Claude แทน |
| Sentry paid | ~900 บ./เดือน | error tracking ดีขึ้น | ⚪ free tier พอ |
| Doppler (secrets) | 0-200 บ. | sync env ระหว่างเครื่อง | ⚪ .env พอ |
