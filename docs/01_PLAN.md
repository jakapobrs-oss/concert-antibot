# 01 — แผนหลักของโปรเจ็คจบ (Master Plan)

> **โปรเจ็ค:** ระบบจองบัตรคอนเสิร์ตที่มี Anti-Bot และให้ความเป็นธรรมกับผู้ใช้จริง
> **อ้างอิงวิจัย:** วิจัยระบบแอนติบอท finish.docx (พรชนก ยมรัตน์, ม.รังสิต, 2567)
> **อัปเดตล่าสุด:** 2026-05-25 (revision 2 — local-only + multi-device + real payment)
> **สถานะรวม:** 🟢 เสร็จครบ 11/11 phases — verified รันจริง + production build ผ่าน (2026-06-02)

## Constraints (ตาม user requirement ล่าสุด)
- 🏠 **Local only** — รัน laptop ตัวเอง, ไม่ deploy cloud (รายละเอียดใน [09_LOCAL_PRESENTATION.md](09_LOCAL_PRESENTATION.md))
- 📱 **Multi-device** — รองรับ iPhone, iPad, Android, Desktop (responsive mobile-first)
- 💰 **Real payment** — ใช้ provider จริง (sandbox/live), หลายช่องทาง (รายละเอียดใน [10_PAYMENT_PROVIDERS.md](10_PAYMENT_PROVIDERS.md))

---

## 1. เป้าหมายโครงงาน (Goal)

สร้างเว็บจองบัตรคอนเสิร์ตที่:
1. **ป้องกันบอท** ด้วยหลายชั้น (multi-layer defense)
2. **ยุติธรรม** — ผู้ใช้จริงที่กดพร้อมกันมีโอกาสเท่ากัน ไม่มีลำเอียง
3. **ใช้งานได้จริง** (production-grade) ไม่ใช่แค่ proof-of-concept ในเอกสาร
4. **UI ใช้งานง่าย** สไตล์คล้าย The Concert แต่ไม่ลอกเลียน

---

## 2. ส่วนที่ขยายจากวิจัยเดิม

วิจัยเดิมพูดถึง 5 โมดูล (Request Handling, Behavior Analysis, CAPTCHA, Authentication, Logging) แต่ **ขาดเรื่องสำคัญสำหรับการใช้งานจริง** ที่โปรเจ็คนี้จะเพิ่ม:

| สิ่งที่ขาด | เหตุผลที่ต้องเพิ่ม |
|---|---|
| Virtual Waiting Room / Queue | กันคนแห่กดพร้อมกัน → fairness ผ่าน FIFO + randomized batch |
| Distributed Lock / Seat Hold | กัน race condition: 2 คนกดที่นั่งเดียวกัน |
| Payment Flow | จองบัตรต้องมีระบบจ่ายเงิน (mock ก่อนได้) |
| Google OAuth | ตาม requirement |
| Real CAPTCHA Provider | Cloudflare Turnstile / hCaptcha (privacy-friendly) |
| Browser Fingerprinting | FingerprintJS Open Source |
| Rate Limiting | Upstash Redis / Redis sliding window |
| WebSocket/SSE | อัปเดตคิว, ที่นั่งคงเหลือ real-time |
| Load Test | k6 หรือ Artillery — พิสูจน์ว่ารับ 10k concurrent ได้ |
| Security baseline | CSRF, XSS, SQLi via ORM, secure cookies |

---

## 3. Tech Stack (เลือกแล้ว — เหตุผลในไฟล์ 03)

### 3.1 ตัวหลัก
- **Framework:** Next.js 15 (App Router) + TypeScript 5.6
- **Database:** PostgreSQL 16 (ใช้ BIGSERIAL/BIGINT เป็น id default ตามที่ user ขอ)
- **ORM:** Prisma 6.x
- **Cache/Queue/Rate Limit:** Redis 7.4 (ใช้ Upstash หรือ self-host)
- **Auth:** NextAuth.js v5 (Auth.js) — รองรับ credentials + Google OAuth
- **UI:** Tailwind CSS 4.x + shadcn/ui
- **CAPTCHA:** Cloudflare Turnstile (ฟรี, ไม่ track user)
- **Fingerprinting:** @fingerprintjs/fingerprintjs (open source)
- **Realtime:** SSE (Server-Sent Events) — เบา + เพียงพอสำหรับคิว
- **Email/OTP:** Resend (dev) → SMTP (prod)
- **Container:** Docker + docker-compose
- **Test:** Vitest + Playwright + k6 (load)

### 3.2 ตัวเลือก optional (ถ้าอยากเปลี่ยน)
- ถ้าอยากใช้ MySQL ตามวิจัยเดิม → ใช้ MySQL 8.4 LTS + Prisma ได้เหมือนกัน
- ถ้าไม่ชอบ Next.js → Remix v2 หรือ Nuxt 3 (Vue) ก็ใช้ได้
- ถ้าอยากแยก backend → NestJS 10 + Next.js เป็น frontend
- ถ้าอยาก deploy เร็ว → Vercel + Neon (Postgres) + Upstash (Redis)

> 👉 **คำแนะนำ:** เริ่มด้วย Next.js + Postgres + Prisma จะเร็วที่สุด เพราะ all-in-one และตลาดงานใหญ่

---

## 4. แผนการทำงาน (Phases)

| Phase | ชื่อ | งานหลัก | สถานะ |
|---|---|---|---|
| 0 | Planning & Docs | สร้าง plan, ER, diagrams, tools list | 🟢 เสร็จ |
| 1 | Setup | git init, Next.js scaffold, Docker, DB schema, env | 🟢 เสร็จ + verified (install/migrate/seed/docker รันจริง) |
| 2 | Auth | NextAuth + Google OAuth + Email/Password + verification | 🟢 เสร็จ + verified (login/RBAC/lock ทดสอบผ่าน HTTP จริง) |
| 3 | Core: Concert/Ticket CRUD | Admin CRUD + Public listing + Seat map | 🟢 เสร็จ + verified (CRUD บน Postgres + seat map render จริง) |
| 4 | Queue System | Virtual waiting room + token-based ordering + Redis | 🟢 เสร็จ + verified (fairness time-bucket+random พิสูจน์จริง, queue gate ทำงาน) |
| 5 | Anti-Bot Layer 1 | Turnstile + fingerprint + UA/Header check | 🟢 เสร็จ + verified (scoring 3 ระดับ ALLOW/CHALLENGE/BLOCK ทดสอบจริง) |
| 6 | Anti-Bot Layer 2 | Behavior analysis (mouse/keystroke entropy) + rate limit | 🟢 เสร็จ + verified (จับ bot-linear score 70, rate limit 429 ทดสอบจริง) |
| 7 | Seat Hold + Payment (Real) | Distributed lock (Redis SETNX) + PromptPay QR + EasySlip verify + issue tickets | 🟢 เสร็จ + verified (race guard winners=1, full booking flow ทดสอบจริง) |
| 8 | Logging & Admin Dashboard | Bot detection log viewer + sales report + queue monitor | 🟢 เสร็จ + verified (dashboard/bot-log/sales render จริง + RBAC) |
| 9 | Testing | Unit (Vitest 9/9) + Load test (fairness 96.8% inversion, no double-booking 1/2000) | 🟢 เสร็จ + verified (unit + load 500/2000 คน ผ่าน) |
| 10 | Documentation | Thesis evaluation (doc 13) + screenshots guide (doc 14) + build verify | 🟢 เสร็จ (build ผ่าน 22 routes, docs ครบ) |

**Legend:** ⚪ ยังไม่เริ่ม • 🟡 กำลังทำ • 🟢 เสร็จ • 🔴 ติดปัญหา

---

## 5. Checklist ความเสถียร (Stability Gate)

ก่อนผ่านแต่ละ phase ต้อง pass checklist นี้:

- [ ] ทุก dependency lock version ที่ระบุไว้ใน `03_TOOLS_AND_VERSIONS.md`
- [ ] `pnpm install` ไม่มี warning เรื่อง peer dep
- [ ] `tsc --noEmit` clean ไม่มี error
- [ ] `next build` สำเร็จไม่มี warning
- [ ] Migration `prisma migrate dev` รันได้ทั้ง up และ down
- [ ] Docker compose up แล้วเข้าหน้าเว็บได้ใน < 30 วินาที
- [ ] Test pass ทั้งหมด

---

## 6. ข้อตรวจสอบความถูกต้องของแผน (Self-Review)

| คำถาม | คำตอบ |
|---|---|
| แผนนี้ตอบ "fairness" ยังไง? | ✅ Queue FIFO + randomized batch per 1 second window + token-based seat hold |
| มีตัวกัน race condition มั้ย? | ✅ Redis SETNX + Postgres SELECT FOR UPDATE + TTL |
| มี anti-bot จริง ไม่ใช่แค่ CAPTCHA? | ✅ 4 ชั้น: header → fingerprint → behavior → CAPTCHA escalation |
| รองรับโหลด concert sale (peak) ได้? | ✅ Edge cache + queue gate + Redis rate limit + load test ก่อน production |
| Database id เป็นตัวเลข? | ✅ ใช้ BIGSERIAL (Postgres) / BIGINT AUTO_INCREMENT (MySQL) |
| มี Google login? | ✅ NextAuth Google Provider |
| UI สไตล์ The Concert? | ✅ Phase 3 จะใช้ shadcn/ui + Tailwind, mockup ก่อน implement |
| Version ทั้งหมดเข้ากันได้? | ✅ ดูใน 03 ทุกอันเช็คแล้วว่า compatible (Q4 2025 stable) |

---

## 7. Risks & Mitigation

| ความเสี่ยง | กระทบ | วิธีลดความเสี่ยง |
|---|---|---|
| Queue/Realtime ทำงานพลาดตอนคนเยอะ | สูง | Load test ตั้งแต่ Phase 4, ใช้ Redis cluster ถ้าเกิน 50k users |
| Bot ฉลาด ผ่าน Turnstile ได้ | กลาง | หลายชั้น defense — ถ้าผ่าน 1 ชั้นยังเจอชั้นอื่น |
| User จริงโดน flag เป็น bot (false positive) | สูง | มี escalation: ทำ CAPTCHA → OTP แทนการ block ทันที |
| Payment gateway integrate ช้า | กลาง | Phase 7 ทำ mock ก่อน, integrate Stripe/Omise ทีหลัง |
| ไม่จบ timeline | สูง | แบ่ง phase ชัด, ทุก phase ต้อง demo ได้ |

---

## 8. ขั้นถัดไป (Next Action)

1. ✅ Plan ครบ (this file + 02, 03, 04, 05)
2. ⏸ **รอ user permission ก่อนเริ่ม Phase 1 (Setup)** — ตามกฎข้อ 7
3. เมื่อ approve → `git init`, scaffold Next.js, push initial commit

---

## 9. ไฟล์อ้างอิงในโฟลเดอร์นี้

- [00_README.md](00_README.md) — index
- [01_PLAN.md](01_PLAN.md) — ไฟล์นี้
- [02_RECOMMENDATIONS.md](02_RECOMMENDATIONS.md) — สิ่งที่แนะนำเพิ่ม
- [03_TOOLS_AND_VERSIONS.md](03_TOOLS_AND_VERSIONS.md) — เครื่องมือ + version lock
- [04_ER_DIAGRAM.md](04_ER_DIAGRAM.md) — ER diagram (Mermaid)
- [05_DIAGRAMS.md](05_DIAGRAMS.md) — Use case, Sequence, Architecture, Data flow
- [06_RESEARCH_SUMMARY.md](06_RESEARCH_SUMMARY.md) — สรุปวิจัยที่อ่าน
- [07_RESPONSIBILITIES.md](07_RESPONSIBILITIES.md) — Claude vs User
- [08_VERIFICATION.md](08_VERIFICATION.md) — audit report
- [09_LOCAL_PRESENTATION.md](09_LOCAL_PRESENTATION.md) — รัน local + multi-device demo
- [10_PAYMENT_PROVIDERS.md](10_PAYMENT_PROVIDERS.md) — Payment integration (Omise + multi-channel)
