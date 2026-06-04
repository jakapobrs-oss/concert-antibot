# 02 — สิ่งที่แนะนำเพิ่ม / สิ่งที่ขาดในวิจัยเดิม

> เปรียบเทียบ "วิจัยที่ส่งไปแล้ว" กับ "สิ่งที่ต้องมีในระบบจริง"
> ใช้เพื่ออัปเดต thesis ตอนทำเสร็จ + ตัดสินใจ scope

---

## A. Anti-Bot — เพิ่มหลายชั้น (Defense in Depth)

วิจัยเดิมพูดถึง CAPTCHA + behavior + 2FA แต่ระบบจริงต้องมีหลายชั้น เรียงจาก "ผู้ใช้ไม่รู้สึก" → "ผู้ใช้ต้องทำ":

| ชั้น | เทคนิค | ผู้ใช้รู้สึก? | เครื่องมือ |
|---|---|---|---|
| 1 | Edge Filter: IP reputation, ASN, GeoIP, rate limit | ไม่ | Cloudflare / Vercel Edge / Upstash Ratelimit |
| 2 | Header & TLS Fingerprint (JA3/JA4) | ไม่ | Custom middleware |
| 3 | Browser Fingerprint + Headless Detection | ไม่ | FingerprintJS Open Source + custom checks (webdriver, plugins, canvas) |
| 4 | Behavior Score (mouse entropy, typing rhythm, scroll) | ไม่ | Custom JS collector → score backend |
| 5 | Invisible Challenge | บางครั้ง | Cloudflare Turnstile (managed mode) |
| 6 | Visible CAPTCHA | ใช่ | Turnstile (interactive) หรือ hCaptcha |
| 7 | Step-up: OTP/Email | ใช่ | Resend + 6-digit code |
| 8 | Account-level: Block + appeal | ใช่ | Admin dashboard |

**Key idea:** ผู้ใช้ปกติเจอแค่ชั้น 1-5 เท่านั้น คนน่าสงสัยถึงค่อย escalate ขึ้น

---

## B. Fairness Layer — สิ่งที่วิจัยเดิม "ไม่มี" เลย แต่สำคัญที่สุด

> เพราะคำขอที่ user ระบุคือ "ทุกคนต้องมีสิทธิ์เท่ากัน ไม่มีลำเอียง" — ส่วนนี้คือหัวใจ

### B.1 Virtual Waiting Room
- ทุกคนที่กดเข้าหน้าจองตอนเปิดขายจะถูก redirect ไปหน้า "รอคิว"
- ได้ token + ตำแหน่งในคิว
- ระบบปล่อยทีละ batch (เช่น 500 คน / 5 วินาที) เข้าหน้าจองจริง
- ทุกคนเห็น countdown + position
- **Anti-cheat:** queue token ผูกกับ session + fingerprint + IP, copy ไปใช้ที่อื่นไม่ได้

### B.2 Randomized Batch Release
- ภายในแต่ละ batch สุ่มลำดับใหม่ ไม่ใช่ first-come-first-served เป๊ะ ๆ
- เหตุผล: คนที่ network เร็วกว่าไม่ได้เปรียบเกินไป

### B.3 Seat Hold with TTL
- กดเลือกที่นั่ง → lock 5 นาที (SETNX ใน Redis + TTL)
- หมดเวลา → ปล่อยกลับเข้า pool, ต้องเข้าคิวใหม่
- ป้องกันคนกักที่นั่งไว้ขาย/เก็บ

### B.4 One Account = N Tickets Limit
- ผูกกับ verified email + phone (OTP)
- ตั้ง limit ต่อ event เช่น 4 ใบ
- ตรวจซ้ำกัน: ห้าม account เดียวใช้หลาย session

### B.5 No Pre-warming
- หน้าจอจองจริงเปิดทำงานเฉพาะตอนเวลาที่กำหนด (server-side check)
- กดก่อนเวลา = ส่งกลับคิว
- กัน bot ที่ warm browser ไว้ก่อน

---

## C. Database — เพิ่ม Fields ที่วิจัยเดิมไม่มี

วิจัยเดิมมี 7 ตาราง (User, Admin, Ticket, Concert, Bot Detection Log, CAPTCHA Test, Report) แต่ field น้อยไป ต้องเพิ่ม:

### User
- `password_hash` (argon2id)
- `email_verified_at`, `phone_verified_at`
- `google_sub` (สำหรับ OAuth)
- `failed_login_count`, `locked_until`
- `created_at`, `updated_at`, `last_login_at`
- `trust_score` (0-100, ใช้ตอนตัดสินใจว่า escalate มั้ย)

### Concert
- `sale_start_at`, `sale_end_at` (สำคัญ — เปิดขายตอนไหน)
- `status` (draft / scheduled / on_sale / sold_out / ended)
- `cover_image_url`, `description`

### Seat (table ใหม่ที่วิจัยไม่มี)
- `seat_id`, `concert_id`, `zone`, `row`, `number`, `price`, `status` (available/held/sold)

### Ticket
- `ticket_id`, `seat_id`, `user_id`, `order_id`, `qr_code`, `issued_at`

### Order (ใหม่)
- `order_id`, `user_id`, `total_amount`, `status` (pending/paid/cancelled/refunded)
- `payment_method`, `payment_ref`, `paid_at`

### QueueToken (ใหม่)
- `token_id`, `user_id` (nullable), `session_id`, `concert_id`
- `position`, `entered_queue_at`, `released_at`, `expires_at`

### SeatHold (ใหม่)
- `hold_id`, `seat_id`, `user_id`, `expires_at`

### BehaviorEvent (แทน CAPTCHA Test เดิม)
- `event_id`, `user_id` (nullable), `session_id`, `ts`, `event_type`, `payload_json`
- เก็บ raw event เพื่อให้ ML วิเคราะห์ post-mortem

### BotDetectionLog (ขยายจากเดิม)
- เพิ่ม: `ip`, `user_agent`, `fingerprint_id`, `score`, `action_taken` (allow/challenge/block)

### Session (ใหม่ — NextAuth จะสร้างให้)
- จัดการ session token, expires, device

> รายละเอียดเต็มอยู่ใน [04_ER_DIAGRAM.md](04_ER_DIAGRAM.md)

---

## D. UI/UX — แนะนำหน้าจอที่ต้องมี (อ้างอิงสไตล์ The Concert)

| Route | หน้า | หมายเหตุ |
|---|---|---|
| `/` | Landing — list concerts ใกล้เปิด | hero + grid |
| `/concert/[slug]` | รายละเอียดคอนเสิร์ต + countdown | นับถอยหลังถึงเวลาขาย |
| `/login`, `/register` | Auth (email + Google) | NextAuth UI |
| `/queue/[concertId]` | หน้าคิว | SSE update position |
| `/book/[concertId]` | เลือกที่นั่ง | seat map + hold timer |
| `/checkout` | สรุป + จ่ายเงิน | **Omise multi-channel จริง** ([10](10_PAYMENT_PROVIDERS.md)) |
| `/my-tickets` | บัตรของฉัน + QR | |
| `/admin` | dashboard | concerts CRUD, bot logs, stats |

**Design:** เน้นสว่าง สี accent หลัก 1 สี (เช่น สีม่วง/ฟ้า), card-based grid, **mobile-first + responsive ทุก device** (ดูรายละเอียดใน [09_LOCAL_PRESENTATION.md §6](09_LOCAL_PRESENTATION.md))

**Responsive requirement:**
- iPhone SE (320px) → Desktop (1920px+)
- iPad portrait + landscape
- Touch target ≥ 44x44px
- PWA-enabled (Add to Home Screen)
- ทดสอบบน device จริงทุกครั้ง

---

## E. ความปลอดภัย (Security Baseline)

- HTTPS only (HSTS)
- httpOnly + Secure + SameSite=Lax cookies
- CSRF: NextAuth handle ให้
- SQL injection: ใช้ Prisma ORM (parameterized)
- XSS: React escape ให้, แต่ห้าม `dangerouslySetInnerHTML`
- Rate limit: ทุก auth endpoint
- Password: argon2id (ไม่ใช้ bcrypt-only)
- Secrets: ใช้ `.env.local`, ห้าม commit
- Content Security Policy header
- Audit log สำหรับ admin action

---

## F. DevOps / Production-Ready

- Docker compose (postgres + redis + app)
- `.env.example` template
- Health check endpoint `/api/health`
- Structured logging (pino)
- Sentry (error tracking) — optional
- CI: GitHub Actions (lint + typecheck + test + build)
- Backup script สำหรับ Postgres
- Migration rollback plan

---

## G. การวัดผล (Evaluation — สำหรับเขียน thesis chapter 4)

จุดที่วิจัยเดิมยอมรับเองว่า "ขาด" คือ ตัวอย่างหน้าจอ + การทดสอบประสิทธิภาพ ฉะนั้นต้องมี:

### G.1 Load Test (k6)
- 1k, 5k, 10k concurrent users กดเข้าหน้าจองพร้อมกัน
- วัด: success rate, p95 latency, queue throughput, DB connection pool usage

### G.2 Bot Test
- เขียน bot จำลอง (Puppeteer + curl) ทดสอบทุกชั้น defense
- รายงาน: ผ่านกี่ชั้น, ใช้เวลานานเท่าไหร่กว่าจะถูก block

### G.3 Fairness Test
- จำลอง 1000 user ที่ network speed ต่างกัน (50ms - 500ms)
- วัดว่าโอกาสได้ตั๋วเป็นสัดส่วนเดียวกันหรือไม่ (chi-square)

### G.4 User Test
- เชิญ ~30 คนทดลองใช้
- วัด SUS (System Usability Scale) + เวลาทำ task

---

## H. ของแถม (Nice to Have)

- Email/SMS notification ตอนจองสำเร็จ
- Refund flow
- Resale market (regulated)
- Multilingual (TH/EN)
- Dark mode
- Analytics dashboard (Plausible / PostHog)
- Mobile app wrapper (Capacitor) — เผื่ออนาคต
