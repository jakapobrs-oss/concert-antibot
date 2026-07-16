# CLAUDE.md — concert-antibot

> File roadmap สร้างจากการสำรวจจริง 2026-07-13 (Explore agent อ่านตรง filesystem ไม่ใช่จากความจำ session เก่า)
> เป้าหมาย: ให้ session ใหม่หาของถูกจุดทันที ไม่ต้อง grep/read มั่วทั้ง repo — **อ่านไฟล์นี้ก่อนเริ่มสำรวจเสมอ**
> ถ้าโครงสร้างเปลี่ยนไปมาก (เพิ่ม subsystem ใหม่/ย้ายไฟล์ใหญ่) ให้ปรับปรุงไฟล์นี้ด้วย

ระบบจองบัตรคอนเสิร์ตออนไลน์ + ป้องกันบอท (anti-bot) + ความปลอดภัยการจ่ายเงินจริง (real-money). GitHub: `jakapobrs-oss/concert-antibot` (branch `master`).

## Tech stack

| ชั้น | ตัวที่ใช้จริง |
|---|---|
| Framework | Next.js **15.5.20** (App Router; bump จาก 15.1.0 ปิด CVE 2026-07-14), React 19.0.0, TypeScript 5.6.3, Node ≥22.11 |
| Package manager | **pnpm 9.15.0** (ไม่มี npm/yarn lockfile) |
| DB/ORM | **PostgreSQL 16** ผ่าน **Prisma 6.1.0** — schema เดียวที่ `prisma/schema.prisma` (446 บรรทัด, **15 models**) |
| Cache/Queue/Lock | **Redis** ผ่าน `ioredis` — hand-rolled ทั้งหมด (ไม่ใช่ BullMQ), ใช้ทำ queue/seat-lock/rate-limit/load-shed |
| Payment | `promptpay-qr`+`qrcode` (สร้าง QR) + EasySlip REST client มือเขียน (`lib/easyslip.ts`) — **ไม่มี Stripe/Omise** แม้เอกสารเก่าบางไฟล์จะพูดถึง |
| Anti-bot | Cloudflare Turnstile (REST, ไม่มี SDK) + `@fingerprintjs/fingerprintjs` (client, ไม่ต้อง API key) + scoring มือเขียน |
| AI chat | `@google/generative-ai` (Gemini `gemini-3.5-flash`) — **stateless**, ไม่มี DB table เก็บ chat history |
| Auth | `next-auth` 5.0.0-beta (Auth.js v5) + `@auth/prisma-adapter` + `argon2` (argon2id) |
| Validation | `zod` ทุกจุด (env/API body/server action) |
| Email | Resend ผ่าน raw `fetch` — ตั้งใจไม่ใช้ SDK |
| Test | Vitest (unit) + `tsx` scripts มือเขียน (race/integration) + k6 (load) + playwright-core (e2e, ไม่ใช่ `@playwright/test`) |
| Verify tooling | มี local skill `testsprite-onboard`/`testsprite-verify` ใน `.claude/skills/` |

**สำคัญ: ไม่มี `src/`** — `app/`, `lib/`, `components/`, `types/` อยู่ที่ root ตรงๆ (`concert-antibot/app/...` ไม่ใช่ `.../src/app/...`)

## แผนที่ 7 subsystem → ไฟล์จริง

| Subsystem | อยู่ที่ |
|---|---|
| **1. Payment** | `lib/{order-finalize,easyslip,promptpay,slip-match,slip-date,slip-freshness,slip-image,payer-key,order-sweeper,ticket-limit,entry-code,holder-policy,booking-guards}.ts` · `app/actions/{booking,tickets}.ts` · `app/(public)/checkout/[orderId]/` · `app/(public)/account/tickets/` · `app/(admin)/admin/{refunds,checkin}/` · Prisma `Order/OrderItem/Payment/Ticket/TicketReturn` · tests `tests/unit/{easyslip,slip-*,payer-key,ticket-limit,entry-code,holder-policy,order-sweeper}.test.ts` · race `scripts/test-n1-race.ts`, `scripts/test-f1-f3.ts` · manual real-money test `scripts/test-concert.mjs` (สร้างคอนเสิร์ต 1 บาทจริง ระวังก่อนรัน) |
| **2. Queue & Seat-hold** | `lib/{queue,queue-control,seat-hold,seat-availability,admit-policy,load-shed}.ts` · `app/api/queue/*` · `app/actions/admin-queue.ts` · `components/{waiting-room,seat-map,admin-queue-panel}.tsx` · `app/(public)/concerts/[slug]/{queue,seats}/` · `app/(admin)/admin/queue/` · Prisma `QueueToken`+`Seat.status` (**seat-hold จริงอยู่ใน Redis `SET NX` TTL 300s ไม่ใช่ DB table**) · tests `tests/unit/{fairness,join-order,admit-capacity}.test.ts` · race scripts `test-f4/test-queue-ghost/test-queue-rejoin/test-queue-status-dos/test-seat-hold-atomic/test-load-shed/load-test-join.ts` |
| **3. Anti-bot** | `lib/{antibot,behavior,turnstile,rate-limit,use-behavior-tracker,use-fingerprint}.ts` · `app/api/behavior/route.ts` · `components/turnstile-widget.tsx` · `app/(admin)/admin/bot-log/` · Prisma `BotEvent`+`BehaviorSession` · tests `tests/unit/{antibot,antibot-part3,behavior}.test.ts` — **เป็น 2 ชั้นจริง (Layer-1 scoring + Layer-2 behavior escalate) ไม่ใช่ 8 ชั้นตามที่ root README ยังเขียนผิดอยู่** |
| **4. Auth** | `lib/{auth,credentials-auth,password}.ts` · `auth.config.ts` (Edge-safe, แยกจาก `lib/auth.ts` เพื่อกัน argon2 หลุดเข้า Edge runtime) · `middleware.ts` · `app/actions/auth.ts` · `app/(auth)/*` · Prisma `User/Account/Session/VerificationToken` |
| **5. Admin & Cron** | `lib/{admin-guard,admin-stats}.ts` · `app/(admin)/*` · `app/api/cron/sweep/` (Vercel Cron รายชั่วโมง) · `scripts/sweep-orders.ts` |
| **6. AI-Chat** | `lib/gemini.ts` · `app/api/chat/`, `app/api/admin/chat/` · `components/{chat-widget,chat-context,admin-chat-panel}.tsx` — client ส่ง `history[]` กลับมาเองทุกครั้ง (zod-bounded), server ไม่ persist อะไรเลย |
| **7. Infra** | `lib/{env,env-schema,prisma,redis,json,format,get-ip,email}.ts` · `next.config.ts` · `docker-compose.yml` · `.github/workflows/ci.yml` |
| **(cross-cutting) Named-ticket / anti-scalper** | `lib/{holder-policy,entry-code}.ts` · `components/{holder-assign,ticket-entry-qr,ticket-return-button,checkin-client,refund-actions}.tsx` · `app/actions/tickets.ts` · Prisma `TicketReturn`+`Ticket.holderName/qrSecret/returnedAt` — งานล่าสุด (2026-07-04), **ไม่อยู่ในกรอบ 7-subsystem เดิม** |
| **(cosmetic) UI kit + design tooling** | `components/ui/*` (shadcn-style primitives) · `app/prototype/` (demo/simulation, **ไม่ต่อ Redis จริง อย่าเข้าใจผิดว่าเป็น admission code จริง** — ของจริงคือ `lib/admit-policy.ts`+`lib/queue.ts`) · `.impeccable/`, `.shots/`, `scripts/shoot-design.ts` |

## Docs — เช็ค staleness ก่อนเชื่อ

`docs/` มี 24 ไฟล์ (20 เลข + 3 ชื่อ + `diagrams/`). **`THESIS_GUIDE.md` ถูกอ้างว่าเป็น canonical แต่ตัวมันเองก็ stale ไปแล้ว** (อ้าง 14 models จริง 15, อ้าง 101/11 test จริง ~176 unit + 8 race scripts). ไฟล์ใหม่สุดที่ตัวเลขน่าเชื่อที่สุดคือ `HANDOFF-security-chapter-for-thesis.md` (181/181 unit, 22/0 race — ยังไม่ได้ commit เข้า git).

**กฎปฏิบัติ: อย่าเชื่อตัวเลข model/test count จากเอกสารไหนเลย — เช็คจาก `prisma/schema.prisma` ตรงๆ หรือ grep `tests/unit/*.test.ts`/`scripts/test-*.ts` เอง**

| ไฟล์ | สถานะ |
|---|---|
| `00_README.md` | ดัชนีอ่านตามลำดับ — ยังต้องแก้ 8→2 ชั้น |
| `01_PLAN.md` | master plan (11/11 phase) — เลขต้องอัปเดต |
| `02_RECOMMENDATIONS.md` | roadmap 8-layer ที่เป็น **แค่แผน ไม่เคยสร้างจริง** |
| `03_TOOLS_AND_VERSIONS.md` | มี phantom deps (BullMQ/isbot/Stripe ฯลฯ ที่ไม่เคยลง) |
| `04_ER_DIAGRAM.md` | ⚠️⚠️ **ผิดชัดเจน** — มี 6 ตาราง "ผี" ที่ไม่มีจริง — ใช้ `prisma/schema.prisma` แทน |
| `05_DIAGRAMS.md` | ⚠️⚠️ ยังโชว์ Stripe/SSE/4-layer-antibot ที่ไม่มีจริง |
| `06_RESEARCH_SUMMARY.md` | อ้างอิงงานวิจัยเดิม (พรชนก ยมรัตน์ ม.รังสิต 2567) ที่ระบบนี้ต่อยอด |
| `07_RESPONSIBILITIES.md` | process-only, ยังต้องแก้ 8→2 ชั้น |
| `08_VERIFICATION.md` | **flag ชัดว่า stale/archive** — เขียนก่อนมีโค้ดจริง (2026-05-25), ห้ามเข้าเล่มวิทยานิพนธ์ |
| `09_LOCAL_PRESENTATION.md` | คู่มือรันสาธิต — ต้องแก้ payment เป็น PromptPay |
| `10_PAYMENT_PROVIDERS.md` | ทำไมเลือก PromptPay+EasySlip — ยังแม่นยำ |
| `11_REQUIREMENTS.md` | source of truth ของ requirement ทั้งหมด (rev 3) |
| `12_CHANGELOG.md` | ประวัติ session — ล่าสุดที่เห็นคือ Revision 17 (2026-06-04), **ไม่รวมงาน named-ticket + 7-part Codex review** (commit ถึง 2026-07-10) |
| `13_THESIS_EVALUATION.md` | ⚠️⚠️ flag สำคัญสุด — สถิติ "inversion 96.8%" มาจาก test script self-referential |
| `14_SCREENSHOTS_GUIDE.md` | ต้องแก้ "9/9"→"101"+ route param |
| `15_PAYMENT_SECURITY.md` | threat model T1-T10 + fix F1-F8/H1-H4/N1-N5 — rated current |
| `16_PEAK_LOAD.md` | load-shedding/backoff — rated current |
| `17_GO_LIVE_CHECKLIST.md` | runbook ก่อนขึ้น production |
| `18_SECURITY_AUDIT.md` | 10 vuln + fix — **น่าจะถูกแก้แล้วผ่าน Codex review series ทีหลัง แต่ยังไม่ verify ซ้ำ** |
| `19_NAMED_TICKET_PLAN.md` | anti-scalper design — **เอกสารใหม่สุด (2026-07-04), implement ครบ 3 phase แล้ว** |
| `SECURITY_TODO.md` | backlog ที่ยังไม่ทำ (bot-score ไม่เช็กตอนซื้อ, Turnstile hostname/action ไม่เช็ก ฯลฯ) |
| `HANDOFF-security-chapter-for-thesis.md` | **ตัวเลขล่าสุดที่เชื่อได้สุด** (untracked, ยังไม่ commit) |

Root `README.md` (ไม่ใช่ `docs/00_README.md`) **ยังเขียนผิดว่า "8 ชั้น"** แม้ `package.json` description แก้เป็น "2 ชั้น" แล้ว.

## Test layout

- **Unit**: `tests/unit/*.test.ts` — 22 ไฟล์, ~176 cases, Vitest, mock ล้วนไม่ต้องมี DB/Redis จริง (`pnpm test`)
- **Race/integration**: **ไม่ได้อยู่ใต้ `tests/`** — เป็น `tsx` script เดี่ยวใน `scripts/test-*.ts` (8 ไฟล์) รันกับ Postgres/Redis จริง — CI (`pnpm test:race`) เดินแค่ `test-n1-race.ts`, ที่เหลืออีก 7 ดูจากคอมเมนต์หัวไฟล์ว่าต้องรันมือ
- **Load**: `tests/load/queue.js` (k6) + `tests/load/concurrent-fairness.mjs` (Node/ioredis)
- **E2E**: `scripts/e2e-booking.ts` (playwright-core) — `package.json`'s `test:e2e` (`playwright test`) **น่าจะใช้ไม่ได้แล้ว** เพราะไม่มี `@playwright/test` ติดตั้ง
- CI (`.github/workflows/ci.yml`): job 1 = typecheck+vitest (ไม่ต้องมี service), job 2 = spin postgres:16 จริงแล้ว `pnpm test:race`

## ห้ามอ่านเข้า context (build artifacts / regeneratable)

| Path | ขนาด | เหตุผล |
|---|---|---|
| `node_modules/` | 705 MB | deps |
| `.next/` | 305 MB | build output |
| `thesis-book-prep/` | 39 MB, 162 ไฟล์ | gitignored, ที่ทำเล่มวิทยานิพนธ์ ไม่ใช่ตัวแอป — regenerate ได้จาก script ในตัวมันเอง |
| `.shots/` | 8.8 MB, 34 PNG | screenshot QA, regenerate ได้ |
| `dev*.log` | 28-72K | log dev server เก่า |
| `.impeccable/`, `.claude/`, `.agents/`, `.codex/` | เล็ก | scratch ของ agent tooling ไม่ใช่โค้ดแอป |

`prisma/migrations/` (7 folder เล็กๆ) **ไม่ต้อง exclude** — อ่านได้เต็มถ้าต้องการ ไม่ใหญ่.

## ของที่ห้ามอ่าน/เปิดโดยเด็ดขาด (secrets)

- **`env.zip`** (root, gitignored) — ชื่อบ่งชัดว่าเป็น `.env` zip backup ของระบบเงินจริง — **ห้ามแตะ/แตกไฟล์**
- Docker compose provision **MinIO แต่ไม่มีโค้ดตรงไหนใช้จริง** (grep แล้วไม่เจอ) — สลิปเก็บเป็น base64 ใน Postgres field `Payment.slipImageUrl` (ชื่อ field ชวนเข้าใจผิดว่าเป็น URL) ไม่ใช่ MinIO/S3 จริง — เอกสาร/compose ที่พูดถึง MinIO คือ aspirational ยังไม่ได้ทำจริง

## ไฟล์ root ที่ไม่เกี่ยวกับตัวแอป (ระวังสับสน)

- `ระบบบริหารจัดการร้านอาหาร_เดชธนา-ศักดา_Edit.pdf` (2.3MB) — **เป็นฟอร์แมตอ้างอิงของ ม.รังสิต ไม่ใช่เนื้อหาโปรเจกต์นี้**
- `วิจัยระบบแอนติบอท finish.docx` (904KB) — งานวิจัยเดิมที่ต่อยอด (อ่านได้อย่างเดียว ห้ามแก้ ตาม `docs/00_README.md`)
- `ปริญญานิพนธ์-ระบบจองบัตรคอนเสิร์ต.docx` (24KB) — ร่างวิทยานิพนธ์ของโปรเจกต์นี้เอง (early draft)

โค้ด comment/doc ส่วนใหญ่เป็นภาษาไทย แต่ identifier (ชื่อ function/variable) เป็นอังกฤษปกติ — ไม่มี vendored third-party source code ที่ไหนเลย (deps ผ่าน npm ทั้งหมด)
