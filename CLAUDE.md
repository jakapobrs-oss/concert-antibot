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
| DB/ORM | **PostgreSQL 16** ผ่าน **Prisma 6.1.0** — schema เดียวที่ `prisma/schema.prisma` (701 บรรทัด, **21 models** · 14 enums — เช็ค 2026-08-25 หลัง merge สาย presale; migration 15 ตัว) |
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
| **2. Queue & Seat-hold** | `lib/{queue,queue-control,seat-hold,seat-availability,admit-policy,load-shed}.ts` · `app/api/queue/*` · `app/actions/admin-queue.ts` · `components/{waiting-room,seat-map,admin-queue-panel}.tsx` · `app/(public)/concerts/[slug]/{queue,seats}/` · `app/(admin)/admin/queue/` · Prisma `QueueToken`+`Seat.status` (**seat-hold จริงอยู่ใน Redis `SET NX` TTL 300s ไม่ใช่ DB table**) · **สิทธิ์หลังผ่านคิวเป็น sliding window** (2026-08-25): `refreshAdmitted` ต่อครั้งละ 5 นาที เพดานแข็ง 15 นาทีนับจาก `admittedAt` (`computeAdmitExtension` ใน `admit-policy.ts`) ใช้แค่หน้าเลือกที่นั่ง + API ที่นั่งรายโซน — **ทางเงินยังเป็น `isAdmitted` เช็คอย่างเดียว อย่าเปลี่ยน** · tests `tests/unit/{fairness,join-order,admit-capacity,admit-extension}.test.ts` · race scripts `test-f4/test-queue-ghost/test-queue-rejoin/test-queue-status-dos/test-seat-hold-atomic/test-load-shed/load-test-join.ts` |
| **3. Anti-bot** | `lib/{antibot,antibot-purchase,behavior,turnstile,rate-limit,use-behavior-tracker,use-fingerprint}.ts` · `app/api/behavior/route.ts` · `components/turnstile-widget.tsx` · `app/(admin)/admin/bot-log/` · Prisma `BotEvent`+`BehaviorSession` · tests `tests/unit/{antibot,antibot-part3,antibot-purchase,behavior}.test.ts` + `pnpm test:purchase-antibot` (เบราว์เซอร์จริง) — **เป็น 2 ชั้นจริง (Layer-1 scoring + Layer-2 behavior escalate) ไม่ใช่ 8 ชั้นตามที่ root README ยังเขียนผิดอยู่** · ตรวจ **2 จุด**: ตอนเข้าคิว (`app/api/queue/join`) และตอนกดซื้อ (`app/actions/booking.ts` → `assessPurchaseForUser`, checkpoint `purchase`) — ⚠️ กติกาสองจุดนี้ **ไม่เหมือนกันโดยตั้งใจ**: ตอนกดซื้อ "ไม่ส่ง Turnstile token" = 0 คะแนน ไม่ใช่ +40 (ไม่งั้นคนซื้อจริงโดนเด้งยกแผง) — ดู `docs/SECURITY_TODO.md` ข้อ 1 · Turnstile token ผูกกับด่าน: widget ต้องระบุ `action` (`queue_join`/`purchase` จาก `lib/turnstile-actions.ts`) และ server เทียบ `action` + `hostname` กับ `Host` ของคำขอ (คีย์จริงเท่านั้น, test key ข้าม) — ข้อ 2 ✅ 2026-08-26 · **production ต้องใช้คีย์ Turnstile จริง**: test key ของ Cloudflare (`1x0000…`) ถูกปฏิเสธ (`test-key-on-production`) + boot-warn ใน `lib/env.ts`, error code ลง `bot_events.signals.turnstileErrors` (rev 28 — prod เคยใช้ test key 43 วันโดยไม่รู้ตัว) |
| **4. Auth** | `lib/{auth,credentials-auth,password}.ts` · `auth.config.ts` (Edge-safe, แยกจาก `lib/auth.ts` เพื่อกัน argon2 หลุดเข้า Edge runtime) · `middleware.ts` · `app/actions/auth.ts` · `app/(auth)/*` · Prisma `User/Account/Session/VerificationToken` · **ลืมรหัสผ่าน + ขอลิงก์ยืนยันใหม่ (rev 35)**: `lib/password-reset.ts` (pure — token รีเซ็ตใช้ตาราง `VerificationToken` เดิม identifier `pwreset:<email>` อายุ 30 นาที ใช้ครั้งเดียว; `verifyEmail` ปฏิเสธ token ชนิดนี้) · `app/actions/password.ts` (`requestPasswordResetAction`/`peekResetToken`/`resetPasswordAction`/`resendVerificationAction` — rate-limit IP+อีเมล, ตอบข้อความกลางเสมอ, รีเซ็ตสำเร็จ = ปลดล็อกบัญชี + ถือว่ายืนยันอีเมล) · หน้า `app/(auth)/{forgot,reset,verify/resend}/` + `components/{forgot-password,reset-password,resend-verification}-form.tsx` · **อีเมลใบเสร็จหลังจ่าย**: `lib/email-templates.ts` (pure, escape HTML) + `lib/order-notify.ts` เรียกจาก `submitSlip` ผ่าน `after()` — ไม่มี QR ในอีเมลโดยตั้งใจ · tests `password-reset`, `email-templates` |
| **5. Admin & Cron** | `lib/{admin-guard,admin-stats}.ts` · `app/(admin)/*` · `app/api/cron/sweep/` (Vercel Cron รายวัน — `vercel.json` `0 0 * * *` ลิมิต Hobby) · `scripts/sweep-orders.ts` |
| **6. AI-Chat** | `lib/gemini.ts` · `app/api/chat/`, `app/api/admin/chat/` · `components/{chat-widget,chat-context,admin-chat-panel}.tsx` — client ส่ง `history[]` กลับมาเองทุกครั้ง (zod-bounded), server ไม่ persist อะไรเลย |
| **7. Infra** | `lib/{env,env-schema,prisma,redis,json,format,local-datetime,get-ip,email,email-signup-gate,seed-policy,canonical-host}.ts` (`local-datetime` = ตีความ datetime-local จากฟอร์มแอดมินเป็นเวลาไทย — rev 29 · `email-signup-gate` = production ไม่มี Resend → ปิดรับสมัครด้วยอีเมล fail-closed + ส่งเมลไม่ออกถอนบัญชี — rev 30; **`EMAIL_VERIFICATION=skip`** = โหมดส่งงาน/เดโม สมัครแล้วใช้ได้ทันทีไม่ส่งเมล (โค้ดยืนยันอีเมลยังอยู่ครบ แค่ไม่ถูกเรียก; boot-warn `[AUTH]`; ตั้ง `required` ก่อนขายจริง) — rev 32 · `canonical-host` = middleware 308 ทุกโฮสต์ `*.vercel.app` ที่ไม่ใช่ `NEXTAUTH_URL` ไปโฮสต์หลัก (cookie Auth.js/Turnstile ผูกโฮสต์ — เปิดจาก URL ของ deployment แล้ว Google sign-in ล้ม) — rev 33 · `seed-policy` = `prisma/seed.ts` บน deploy ที่โฮสต์ (Vercel ทุก env / NODE_ENV=production) ไม่สร้าง `admin@local`/`user@local` รหัสสาธารณะ + ล็อกของเดิม (passwordHash null, role USER) + แอดมินจริงจาก `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` เท่านั้น — rev 31; **เครื่อง dev ยังได้บัญชีเดโมตามเดิม**) · `next.config.ts` · `docker-compose.yml` · `.github/workflows/ci.yml` · `scripts/push-env-to-vercel.mjs` (ก๊อป env จาก `.env` ขึ้น Vercel โดยไม่พิมพ์ค่า) |
| **(cross-cutting) Named-ticket / anti-scalper** | `lib/{holder-policy,entry-code}.ts` · `components/{holder-assign,ticket-entry-qr,ticket-return-button,checkin-client,refund-actions}.tsx` · `app/actions/tickets.ts` · Prisma `TicketReturn`+`Ticket.holderName/qrSecret/returnedAt` — งานล่าสุด (2026-07-04), **ไม่อยู่ในกรอบ 7-subsystem เดิม** |
| **(cross-cutting) ผังที่นั่งจากรูปจริง** | `lib/seatmap/{seat-rows,zone-sheet,zone-sheet-xlsx,guard,polygon,render-hints,best-available,row-spec-suggest}.ts` · `app/actions/seatmap.ts` · `app/api/admin/seatmap/template/` · `app/api/concerts/[id]/zones/[zoneId]/seats/` (โหลดผังรายโซนหลังด่าน login+คิว+rate-limit) · `app/(admin)/admin/concerts/[id]/seatmap/` · `components/{seatmap-editor,seat-map-svg}.tsx` · Prisma `Concert.layoutImage*`+`Concert.stagePolygon`+`Zone.{polygon,tier,stageSide,isStanding,rowSpec}` · tests สายผัง 109 unit + `scripts/test-seatmap{,-buyer}.ts` (43+27) · doc `docs/25_SEATMAP.md` — ปรับใหญ่ 2026-08-21, เพิ่มโซนยืน/best-available/rowSpec 2026-08-24, **2026-08-25 ผัง 2 ชั้น (ผังรวม→ผังโซน) + กริดเว้าตามกรอบ (`rowInsetFractions`) + "เสนอที่นั่งต่อแถวจากกรอบ" (`suggestRowSpec` = วัดกรอบที่แอดมินวาด ไม่ใช่ CV อ่านรูป) — merge เข้า master พร้อมสาย presale 2026-08-25** (docs/25 §8.3). **เป็นผัง "ระดับโซน" แล้ว ไม่ใช่ผังที่นั่งรายตัว** — `lib/seatmap/generate.ts` (โปรยจุด + หมุนกริด) **ถูกลบทั้งไฟล์ อย่าเสนอให้ทำกลับมา**; ข้อมูลโซนนำเข้าจากไฟล์ Excel (`exceljs`); `Seat.x/y` ยังอยู่ใน schema แต่ **ไม่มีโค้ดไหนใช้แล้ว**. **`components/seat-map.tsx` ตัวเดิมไม่ถูกแก้เลย** เป็นทางถอยเมื่อคอนเสิร์ตยังไม่มีผังรูป |
| **(cross-cutting) เอกสารผู้ใช้/PDPA + หน้า error + แชร์ลิงก์** | `lib/{legal-info,consent}.ts` · `components/legal-page.tsx` · `app/(public)/{privacy,terms,ticket-terms}/` (ตัวเลขดึงจาก env: SEAT_HOLD_TTL/RETURN_CUTOFF/HOLDER_MIN_AGE; `REFUND_DAYS`=14 และ `SUPPORT_EMAIL` ยังรอทีมยืนยัน) · checkbox ยินยอมใน `components/register-form.tsx` + **server ตรวจซ้ำ** ใน `app/actions/auth.ts` (`hasAcceptedTerms`) + หมายเหตุใต้ปุ่ม Google (`google-signin-button.tsx`) · แจ้งเก็บ fingerprint ที่หน้า queue · บรรทัดเงื่อนไขบัตรบน checkout · ลิงก์ในฟุตเตอร์ · `app/{not-found,error,global-error}.tsx` + `loading.tsx` (concerts, [slug], checkout) · `app/{icon,apple-icon,opengraph-image,brand-mark}.tsx` วาดด้วย `next/og` (Satori: ห้ามใส่สีทึบใน `background` shorthand → แยก `backgroundColor`; ข้อความในรูปเป็นอังกฤษเพราะฟอนต์ตั้งต้นไม่มีไทย) + `metadataBase/openGraph` ใน `app/layout.tsx` + `generateMetadata` ต่อคอนเสิร์ต (โปสเตอร์เป็น og:image) · `app/{robots,sitemap}.ts` — rev 34 (2026-08-27). ⚠️ dev server: เขียนไฟล์ใหม่หลายไฟล์พร้อมกันแล้ว import ชี้ไฟล์ที่ยังไม่มี = static worker ของ `next dev` ตาย 2 ครั้งแล้ว**ค้างถาวร** (`/concerts/[slug]` 500 "Jest worker … exceeding retry limit") — แก้ด้วยรีสตาร์ท dev server เท่านั้น |
| **(cross-cutting) Membership / สมาชิก** | `lib/membership.ts` · `app/actions/{membership,admin-membership}.ts` · `app/(public)/account/membership/` · `app/(admin)/admin/memberships/` · `components/{membership-join-button,admin-membership-actions}.tsx` · Prisma `Membership` · tests `tests/unit/{membership,admin-membership-action}.test.ts` (57 เคส) · doc `docs/20_MEMBERSHIP.md` — **สิทธิ์เดียว = เข้ารอบขายก่อน ไม่แซงคิว/ไม่ลดราคา/ไม่เพิ่มเพดานตั๋ว** |
| **(cross-cutting) Subscription / แพ็กเกจสมาชิก** | `lib/subscription.ts` · `app/actions/membership.ts` (subscribe/cancel) · `components/subscription-plans.tsx` · Prisma `Subscription` · tests `tests/unit/subscription.test.ts` (32 เคส) · doc `docs/22_SUBSCRIPTION.md` — **ledger แยกจาก `Membership` ที่เป็นสิทธิ์จริง · ยังไม่เก็บเงิน (ทุกแพ็กเกจ 0 บาท)** |
| **(cross-cutting) Storefront UX / หน้าร้าน** | `lib/{order-view,countdown,concert-filter}.ts` · `app/(public)/account/orders/` · `components/{order-actions,countdown,concert-browser}.tsx` · tests `tests/unit/storefront.test.ts` (26 เคส) · doc `docs/24_STOREFRONT_UX.md` — **ไม่มี migration · order ค้างจ่ายกลับไปจ่ายต่อได้ · นับถอยหลังแล้ว refetch ให้ server ตัดสิน** |
| **(cross-cutting) Sold out / บัตรหมด** | `lib/sold-out.ts` (นิยาม pure `isSoldOut`/`isTemporarilyFull` อยู่ `lib/admit-policy.ts`) · **ทางออกของคิวเมื่อหมด** (2026-08-26, docs/23 §8): status route บันทึก snapshot `queue:{id}:seats` ผ่าน `recordSeatAvailability()` ใน `lib/queue.ts` → `getQueueStatus` ตอบ `SOLD_OUT` / `WAITING`+`seatsFull` → `waiting-room.tsx` หยุด poll + ปุ่มกลับ; ประตู `resolveEntryForUser` เช็คบัตรหมดทุกคอนเสิร์ตรวมไม่มีรอบ · hook ใน `lib/order-finalize.ts` (หลังออกตั๋ว) · ด่านใน `app/api/queue/join` + `lib/sale-round.ts` (`DenyReason = SOLD_OUT`) · UI `components/sale-round-panel.tsx` + หน้าคอนเสิร์ต · preset `createStandardRounds` ใน `app/actions/admin-sale-round.ts` · tests `tests/unit/sold-out.test.ts` (14 เคส) · doc `docs/23_SOLD_OUT.md` — **soldOut = ไม่เหลือทั้ง AVAILABLE และ HELD · พลิกสถานะทิศทางเดียว** |
| **(cross-cutting) Presale rounds / รอบพรีเซล** | `lib/{sale-round,pre-registration,access-code}.ts` · `app/actions/{sale-round,admin-sale-round}.ts` · `app/api/concerts/[id]/rounds/` · `components/{sale-round-panel,admin-sale-rounds}.tsx` · Prisma `SaleRound`+`PreRegistration`+`AccessCode`+`AccessCodeRedemption` · tests `tests/unit/{sale-round,access-code}.test.ts` (48 เคส) · doc `docs/21_PRESALE_ROUNDS.md` — ด่านรอบต่อเข้า `app/api/queue/join` + `app/actions/booking.ts` + `lib/order-finalize.ts` แล้ว · **คอนเสิร์ตที่ไม่มีรอบ = พฤติกรรมเดิม** |
| **(ops) health / backup / error log** | `app/api/health/route.ts` + `lib/health.ts` (GET 200/503 `{ok,db,redis}` ไม่ต้อง auth, timeout 3 วิ, rate-limit 30/นาที/IP) · `.github/workflows/backup-neon.yml` (pg_dump รายวัน 03:30 ไทย → gpg AES-256 → artifact 30 วัน; ต้องมี GitHub Secrets `NEON_DATABASE_URL_UNPOOLED` + `BACKUP_PASSPHRASE`; restore runbook docs/17 §7.3) · `instrumentation.ts` (`onRequestError` → JSON log `server_error` + digest + `x-vercel-id`) · `app/prototype/layout.tsx` (404 บน production) · tests `tests/unit/health.test.ts` — rev 36 (2026-08-27) · **matcher ของ middleware ตัดแค่ `/api/auth`** — `/api/*` อื่นผ่าน middleware; canonical-host redirect ยกเว้น `/api/` ในฟังก์ชันเอง |
| **(cosmetic) UI kit + design tooling** | `components/ui/*` (shadcn-style primitives) · `app/prototype/` (demo/simulation, **ไม่ต่อ Redis จริง อย่าเข้าใจผิดว่าเป็น admission code จริง** — ของจริงคือ `lib/admit-policy.ts`+`lib/queue.ts`) · `.impeccable/`, `.shots/`, `scripts/shoot-design.ts` |

## Docs — เช็ค staleness ก่อนเชื่อ

`docs/` มี 30 รายการ (26 เลข + 3 ชื่อ + `diagrams/`). **`THESIS_GUIDE.md` ถูกอ้างว่าเป็น canonical แต่ตัวมันเองก็ stale ไปแล้ว** (อ้าง 14 models จริง 21, อ้าง 101/11 test จริง 537 unit + 12 scripts). ไฟล์ใหม่สุดที่ตัวเลขน่าเชื่อที่สุดคือ `HANDOFF-security-chapter-for-thesis.md` (181/181 unit, 22/0 race — ยังไม่ได้ commit เข้า git).

**กฎปฏิบัติ: อย่าเชื่อตัวเลข model/test count จากเอกสารไหนเลย — เช็คจาก `prisma/schema.prisma` ตรงๆ หรือ grep `tests/unit/*.test.ts`/`scripts/test-*.ts` เอง**

| ไฟล์ | สถานะ |
|---|---|
| `00_README.md` | ดัชนีอ่านตามลำดับ — ยังต้องแก้ 8→2 ชั้น |
| `01_PLAN.md` | master plan (11/11 phase) — เลขต้องอัปเดต |
| `02_RECOMMENDATIONS.md` | roadmap 8-layer ที่เป็น **แค่แผน ไม่เคยสร้างจริง** |
| `03_TOOLS_AND_VERSIONS.md` | มี phantom deps (BullMQ/isbot/Stripe ฯลฯ ที่ไม่เคยลง) |
| `04_ER_DIAGRAM.md` | ✅ อัปเดต 2026-08-25 หลัง merge — ตรง schema จริง (21 models/14 enums; union คอลัมน์ผังรายโซน + ตาราง presale/subscription) |
| `05_DIAGRAMS.md` | ⚠️⚠️ ยังโชว์ Stripe/SSE/4-layer-antibot ที่ไม่มีจริง |
| `06_RESEARCH_SUMMARY.md` | อ้างอิงงานวิจัยเดิม (พรชนก ยมรัตน์ ม.รังสิต 2567) ที่ระบบนี้ต่อยอด |
| `07_RESPONSIBILITIES.md` | process-only, ยังต้องแก้ 8→2 ชั้น |
| `08_VERIFICATION.md` | **flag ชัดว่า stale/archive** — เขียนก่อนมีโค้ดจริง (2026-05-25), ห้ามเข้าเล่มวิทยานิพนธ์ |
| `09_LOCAL_PRESENTATION.md` | คู่มือรันสาธิต — ต้องแก้ payment เป็น PromptPay |
| `10_PAYMENT_PROVIDERS.md` | ทำไมเลือก PromptPay+EasySlip — ยังแม่นยำ |
| `11_REQUIREMENTS.md` | source of truth ของ requirement ทั้งหมด (rev 9 — 2026-08-25 merge: §2.7–2.11 สมาชิก/พรีเซล/ซับสคริปชั่น/บัตรหมด/UX ฉบับ presale + §2.2.3 ผังรายโซน + §2.12 คืนบัตร/ขายต่อ) |
| `12_CHANGELOG.md` | ประวัติ session — ล่าสุดคือ Revision 30 (2026-08-26 ค่ำ: production ไม่มี Resend → ปิดรับสมัครด้วยอีเมล + ถอนบัญชีเมื่อส่งเมลไม่ออก + `scripts/push-env-to-vercel.mjs`); 29 = ฟอร์มสร้างคอนเสิร์ตอ่าน datetime-local เป็น UTC → `lib/local-datetime.ts`; 28 = prod ใช้ Turnstile test key มา 43 วัน → guard fail-closed + ห้องรอมี feedback; 27 = SECURITY_TODO #2–#4; 26 = คิวมีทางออกเมื่อบัตรหมด; 25 = merge สาย presale (2026-08-25). เลข 18–22 มีสองชุด (สาย seatmap ด้านบน / สาย presale ใต้ป้ายแยก) เพราะเขียนคู่ขนาน. **มีช่องว่าง rev 17→18** ไม่รวมงาน named-ticket + 7-part Codex review (commit ถึง 2026-07-10) |
| `13_THESIS_EVALUATION.md` | ⚠️⚠️ flag สำคัญสุด — สถิติ "inversion 96.8%" มาจาก test script self-referential |
| `14_SCREENSHOTS_GUIDE.md` | ต้องแก้ "9/9"→"101"+ route param |
| `15_PAYMENT_SECURITY.md` | threat model T1-T10 + fix F1-F8/H1-H4/N1-N5 — rated current |
| `16_PEAK_LOAD.md` | load-shedding/backoff — rated current |
| `17_GO_LIVE_CHECKLIST.md` | runbook ก่อนขึ้น production |
| `18_SECURITY_AUDIT.md` | 10 vuln + fix — **น่าจะถูกแก้แล้วผ่าน Codex review series ทีหลัง แต่ยังไม่ verify ซ้ำ** |
| `19_NAMED_TICKET_PLAN.md` | anti-scalper design — implement ครบ 3 phase แล้ว (2026-07-04) |
| `20_MEMBERSHIP.md` | ระบบสมาชิก + สัญญา `getActiveMembership()` (2026-08-20) |
| `21_PRESALE_ROUNDS.md` | รอบพรีเซล 4 ชั้น + ลงทะเบียนล่วงหน้า + โค้ดสิทธิ์ ตามแพลตฟอร์มจริง (2026-08-20) |
| `22_SUBSCRIPTION.md` | แพ็กเกจสมาชิก (ledger แยกจากสถานะสิทธิ์) + รอยต่อเปิดเก็บเงินทีหลัง (2026-08-20) |
| `23_SOLD_OUT.md` | บัตรหมดอัตโนมัติ + รอบทั่วไปไม่เปิดขายเมื่อหมดตั้งแต่รอบสมาชิก (2026-08-20) · §8 ทางออกของคิวเมื่อบัตรหมด (2026-08-26) |
| `24_STOREFRONT_UX.md` | **เอกสารใหม่สุด (2026-08-21)** — คำสั่งซื้อของฉัน (จ่ายต่อ/ยกเลิก) + นับถอยหลังเปิดขาย + ค้นหางาน |
| `25_SEATMAP.md` | ผังที่นั่งจากรูปสถานที่จริง — **เขียนใหม่ 2026-08-21 ตัวเลขทดสอบมาจากการรันจริง** (§2.1 บอกว่าอะไรถูกถอดออกและทำไม) · §8.3 = รอบ 2026-08-25 · §9 มีข้อจำกัด "โซนเอียงกริดหมุนตามไม่ได้" ที่ตั้งใจยอม |
| `SECURITY_TODO.md` | backlog ความปลอดภัย — ระดับ Medium ปิดครบแล้ว: ข้อ 1 (bot-score ตอนซื้อ) 2026-08-25 · ข้อ 2 (Turnstile action+hostname) / 3 (payerKey `ธนาคาร:ชื่อ`) / 4 (เทียบยอดเป็นสตางค์) 2026-08-26 (rev 27); เหลือระดับ Low #5–#10 |
| `HANDOFF-security-chapter-for-thesis.md` | **ตัวเลขล่าสุดที่เชื่อได้สุด** (untracked, ยังไม่ commit) |

Root `README.md` (ไม่ใช่ `docs/00_README.md`) **ยังเขียนผิดว่า "8 ชั้น"** แม้ `package.json` description แก้เป็น "2 ชั้น" แล้ว.

## Test layout

- **Unit**: `tests/unit/*.test.ts` — 51 ไฟล์, 639 cases (รันจริง 2026-08-27 หลังรวม rev 31–36 — เพิ่ม `queue-soldout-gate`, `turnstile`, `money`, `local-datetime`, `email-signup-gate`, `seed-policy`, `credentials-auth-verify-flag`, `canonical-host`, `consent`, `password-reset`, `email-templates`, `health`; rev 28 +4, rev 29 +6, rev 30 +4, rev 31 +11 seed-policy, rev 32 +6 email-signup-gate/+4 credentials-auth-verify-flag, rev 33 +7 canonical-host, rev 34 +6 consent, rev 35 +11 password-reset/+8 email-templates, rev 36 health), Vitest, mock ล้วนไม่ต้องมี DB/Redis จริง (`pnpm test:run` — **ห้าม `pnpm test` = watch ค้าง**)
- **Race/integration**: **ไม่ได้อยู่ใต้ `tests/`** — เป็น `tsx` script เดี่ยวใน `scripts/test-*.ts` (14 ไฟล์) รันกับ Postgres/Redis จริง — CI (`pnpm test:race`) เดินแค่ `test-n1-race.ts`, ที่เหลือดูจากคอมเมนต์หัวไฟล์ว่าต้องรันมือ (Redis ล้วน: `npx tsx --env-file=.env scripts/test-queue-{ghost,rejoin,status-dos,soldout}.ts` — รันทุกครั้งที่แตะ `lib/queue.ts`)
  - 5 ไฟล์เป็น **เทสบนเบราว์เซอร์จริง** ต้องมี dev server รันอยู่ + DB seed (`pnpm db:seed` ให้มี `user@local`) + ส่ง `E2E_BASE` ถ้าไม่ใช่พอร์ต 3000: `pnpm test:seatmap` (แอดมิน 43 เช็ค) · `pnpm test:seatmap-buyer` (คนซื้อ 27 เช็ค) · `pnpm test:sale-round` (ด่านรอบพรีเซล 10 เช็ค — เขียนใหม่หลัง merge 2026-08-25) · `pnpm test:purchase-antibot` (ด่านบอทตอนซื้อ 7 เช็ค) · `pnpm test:queue-soldout-ui` (ห้องรอเมื่อบัตรหมด 5 เช็ค + 2 ขั้น "ระหว่างรอ" ที่**ข้ามเมื่อ dev ใช้ Turnstile คีย์จริง** — คำขอเข้าคิวครั้งแรกไม่มี token = CHALLENGE เสมอ สคริปต์ผ่าน Turnstile จริงไม่ได้โดยตั้งใจ)
  - ⚠️ ทางเดินห้องรอ (`/concerts/[slug]/queue`) **automate ไม่ได้กับคีย์จริง** — เทสเบราว์เซอร์ทุกตัวเลี่ยงด้วยการเตรียม token ผ่าน `joinQueue()`+`admitNext()` แล้วเริ่มที่หน้าเลือกที่นั่ง
- **Load**: `tests/load/queue.js` (k6) + `tests/load/concurrent-fairness.mjs` (Node/ioredis)
- **E2E**: `scripts/e2e-booking.ts` (playwright-core) — `pnpm test:e2e` ชี้มาที่ไฟล์นี้แล้ว (2026-08-26; เดิมเป็น `playwright test` ที่รันไม่ได้เพราะไม่มี `@playwright/test`)
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

`prisma/migrations/` (15 folder เล็กๆ — 8 master + 5 seatmap + 2 presale, ลง Neon ครบแล้ว ห้ามลบ) **ไม่ต้อง exclude** — อ่านได้เต็มถ้าต้องการ ไม่ใหญ่.

## ของที่ห้ามอ่าน/เปิดโดยเด็ดขาด (secrets)

- **`env.zip`** (root, gitignored) — ชื่อบ่งชัดว่าเป็น `.env` zip backup ของระบบเงินจริง — **ห้ามแตะ/แตกไฟล์**
- Docker compose provision **MinIO แต่ไม่มีโค้ดตรงไหนใช้จริง** (grep แล้วไม่เจอ) — สลิปเก็บเป็น base64 ใน Postgres field `Payment.slipImageUrl` (ชื่อ field ชวนเข้าใจผิดว่าเป็น URL) ไม่ใช่ MinIO/S3 จริง — เอกสาร/compose ที่พูดถึง MinIO คือ aspirational ยังไม่ได้ทำจริง

## ไฟล์ root ที่ไม่เกี่ยวกับตัวแอป (ระวังสับสน)

- `ระบบบริหารจัดการร้านอาหาร_เดชธนา-ศักดา_Edit.pdf` (2.3MB) — **เป็นฟอร์แมตอ้างอิงของ ม.รังสิต ไม่ใช่เนื้อหาโปรเจกต์นี้**
- `วิจัยระบบแอนติบอท finish.docx` (904KB) — งานวิจัยเดิมที่ต่อยอด (อ่านได้อย่างเดียว ห้ามแก้ ตาม `docs/00_README.md`)
- `ปริญญานิพนธ์-ระบบจองบัตรคอนเสิร์ต.docx` (24KB) — ร่างวิทยานิพนธ์ของโปรเจกต์นี้เอง (early draft)

## ⚠️ กับดักที่เคยเสียเวลาไล่ (2026-08-21)

**เขียน path ของ Windows ในไฟล์ `.md` ด้วย `/` เสมอ** — Tailwind v4 สแกนไฟล์ `.md` ในโปรเจกต์ด้วย และตีความ backslash ตามด้วยเลขฐาน 16 หกหลัก (เช่นส่วนหนึ่งของ UUID ใน path) เป็น CSS escape → `String.fromCodePoint` เกินช่วง → `app/globals.css` คอมไพล์ไม่ผ่าน → **ทั้งเว็บขึ้น 500 โดย error ไม่ได้ชี้ไปที่ไฟล์ `.md` เลย**
วิธีเช็คเร็ว: `node -e "const postcss=require('postcss'),tw=require('@tailwindcss/postcss'),fs=require('fs');postcss([tw({base:process.cwd()})]).process(fs.readFileSync('app/globals.css','utf8'),{from:'app/globals.css'}).then(r=>console.log('OK',r.css.length)).catch(e=>console.error('ERR',e.message))"`

โค้ด comment/doc ส่วนใหญ่เป็นภาษาไทย แต่ identifier (ชื่อ function/variable) เป็นอังกฤษปกติ — ไม่มี vendored third-party source code ที่ไหนเลย (deps ผ่าน npm ทั้งหมด)
