# 17 — Go-Live Checklist (Production Readiness)

> รวมทุกอย่างที่ต้องทำ "ก่อนเปิดขายตั๋วกับคนจริง" ไว้ที่เดียว
> ต่อยอดจาก [15_PAYMENT_SECURITY.md](15_PAYMENT_SECURITY.md) §9 — เพิ่ม blocker ใหม่ที่เจอจาก adversarial audit (2026-06-04)
> **อัปเดตล่าสุด:** 2026-06-04
>
> **สถานะโปรเจกต์:** 11/11 phases + F1–F8 + H1–H4 เสร็จ · `tsc` 0 errors · unit **62/62** ผ่าน · fix ทุกตัว wire เข้า request path จริง
> **Demo/defend thesis:** ✅ พร้อม (dev-mock รัน local ได้โดยไม่ต้องมี key จริง)
> **ขายตั๋วจริง:** ❌ ยัง — ติด go-live blocker ด้านล่าง

---

## ⛔ 0. ทำทันที ก่อนแตะอะไรทั้งหมด (5 นาที กันความเสียหายที่กู้ไม่ได้)

- [ ] **Rotate `EASYSLIP_API_KEY`** — key live ของจริงนั่งอยู่ใน `.env` ที่หน้าตาเหมือน template
  - ออก key ใหม่จาก EasySlip dashboard → ใส่ลง `.env` (อย่า paste ที่อื่น)
  - ลบ comment หัวไฟล์ที่ทำให้ `.env` ดูเหมือน template ออก (กันเผลอ share/commit)
  - `.env` อยู่ใน `.gitignore` แล้ว (verify: `git check-ignore .env` ต้องคืน `.env`)
  - **ทำไมด่วน:** repo ยัง 0 commit — ถ้าเผลอ `git add -A` ครั้งแรกตอน key ยังหน้าตา template = หลุดทั้ง key

---

## 🔑 1. Credentials ที่ต้องขอจากบริการภายนอก (ผมทำแทนไม่ได้)

| บริการ | env ที่ต้องตั้ง | ขอจาก | ผลถ้าไม่ตั้งบน production |
|---|---|---|---|
| **Cloudflare Turnstile** | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | dash.cloudflare.com → Turnstile | H1 fail-closed → **block ผู้ใช้จริงทุกคน** |
| **Resend** (อีเมล) | `RESEND_API_KEY`, `EMAIL_FROM` (โดเมนที่ verify แล้ว) | resend.com | สมัครได้แต่ไม่ส่งเมลยืนยัน (โค้ดส่งจริงแล้ว รอแค่ key) |
| **Google OAuth** (optional) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | console.cloud.google.com | ปุ่ม Google login ปิดเงียบ (credentials login ยังใช้ได้) |
| **EasySlip** | `EASYSLIP_API_KEY` (rotate ตาม §0) | easyslip.com | payment fail-closed (ปฏิเสธทุกการจ่าย) |
| **PromptPay** | `PROMPTPAY_ID` (เบอร์/เลขบัตรที่รับเงิน) | บัญชีพร้อมเพย์ของคุณ | สร้าง QR + ตรวจ receiver ไม่ได้ |

> Google redirect URI: ตั้งใน Google Console เป็น `https://<โดเมนจริง>/api/auth/callback/google`
> EMAIL_FROM ต้องเป็นโดเมนที่ verify ใน Resend แล้ว ไม่งั้นส่งไม่ออก (`noreply@localhost` ใช้ได้แค่ dev)

---

## ⚙️ 2. Config ตอน deploy (ทำเองได้ ไม่ต้อง account)

- [ ] **`NODE_ENV=production`** — ตอนนี้ `.env` = development → fail-closed/HSTS/secure-cookie/boot-guard **ตายหมด** (ระบบรันโหมด dev-mock: slip ผ่าน mock, CAPTCHA fail-open)
- [ ] **`NEXTAUTH_URL=https://<โดเมนจริง>`** — ตอนนี้ฮาร์ดโค้ด `http://localhost:3000` → ใช้สร้างลิงก์ยืนยันอีเมล + OAuth callback + cookie host (ถ้าไม่แก้ ลิงก์ verify จะชี้ localhost + Google redirect mismatch)
- [ ] เปลี่ยน infra credentials ที่เป็น default (`POSTGRES_PASSWORD=dev_only_change_me`, `MINIO_ROOT_PASSWORD=minioadmin_change_me`) เป็นรหัสจริง
- [ ] ⚠️ **ลำดับสำคัญ:** ตั้ง Turnstile key **ก่อน/พร้อม** flip `NODE_ENV=production` ไม่งั้น H1 จะ block ผู้ใช้ทุกคนทันที

---

## 🚀 3. Infra / Ops (ทำเองได้)

- [ ] **HTTPS + reverse proxy** (nginx/Caddy terminate TLS) — ไม่มี TLS → secure-cookie ไม่ติด, HSTS ไร้ผล
- [ ] **App process** — `docker-compose.yml` มีแค่ postgres/redis/minio **ไม่มี app container**
  - เลือก: `pnpm build && pnpm start` ใต้ pm2/systemd (restart-on-crash) หรือทำ Dockerfile + healthcheck
- [ ] **Schedule order-sweeper cron** — `F3` sweep แบบ on-read ครอบเฉพาะคอนเสิร์ตที่มีคนจองใหม่
  - คอนเสิร์ตเงียบ → ที่นั่ง `HELD` ค้างถาวร ไม่มีใครปลด
  - ตั้ง cron/systemd-timer รัน `pnpm sweep` ทุก ~1 นาที
- [ ] **ใช้ `pnpm db:deploy`** (เพิ่งเพิ่มให้ = `prisma migrate deploy`) ตอน deploy — **อย่าใช้ `db:migrate`** (`migrate dev` reset/prompt ได้ = อันตรายกับ prod DB)

---

## 🛡️ 4. Code fixes ที่ควรปิดก่อนรับ traffic จริง (จาก adversarial audit 2026-06-04)

> เรื่อง "เงิน" ปลอดภัยในเชิง threat model T1–T10/F1–F8 แล้ว แต่ audit เจอ **race เชิง concurrency** ที่ unit test (pure-logic) มองไม่เห็น
> รายละเอียดเต็มอยู่ในรายงาน audit — สรุป action ที่นี่

| # | ระดับ | ปัญหา | ที่ | แนวทางแก้ |
|---|:---:|------|-----|-----------|
| **N1** | 🔴 HIGH | `submitSlip` write-transaction ไม่มี status guard → ระหว่างรอ EasySlip ถ้า sweeper/cancel คั่นกลาง อาจ flip CANCELLED order กลับเป็น PAID + ออกตั๋วซ้ำที่นั่ง | `app/actions/booking.ts` (~:250–283) | เปลี่ยนเป็น **interactive** `$transaction(async tx => …)` + conditional write `order.updateMany({where:{id,status:'PENDING',expiresAt:{gt:now}}})` แล้ว rollback ถ้า `count===0`; guard `status:'HELD'` บน seat update |
| **N3** | 🟡 MED | `cancelOrder` writes ไม่ guard กับ submitSlip ที่กำลังวิ่ง → สถานะขัดกัน (order CANCELLED แต่ตั๋ว live + payment SUCCESS) | `booking.ts` (~:299–325) | guard `status:'PENDING'` ใน interactive tx แบบเดียวกับ N1 |
| **N5** | 🟡 MED | admin read pages (dashboard/sales/bot-log) พึ่ง **middleware อย่างเดียว** ไม่มี server-side role check ในตัว page (CVE-2025-29927 class) | `app/(admin)/*` | เพิ่ม `app/(admin)/layout.tsx` หรือ `requireAdmin()` ในแต่ละ page: `const s=await auth(); if(s?.user?.role!=='ADMIN') redirect('/')` |
| **N4** | 🟡 MED | Layer 2 behavior scoring เก็บคะแนนแล้ว **ไม่ถูก enforce ที่ไหนเลย** → "anti-bot Layer 2" = security theater ตอนนี้ | `analyzeBehavior` ไม่ถูกอ่านใน gate | wire score เข้า gate จริง **หรือ** เขียน thesis ให้ตรงว่า Layer 2 = dataset-collection อย่างเดียว |
| **N2** | 🟢 LOW | ไม่ validate `currency` ของสลิป (THB-only by PromptPay แต่ verifier ไม่ assert) | `lib/easyslip.ts:97` | อ่าน `d.amount?.currency` reject ถ้า `!== 'THB'` |
| **N7** | 🟢 LOW | ไม่มี CSP header บนหน้า checkout | `next.config.ts` | เพิ่ม CSP `default-src 'self'` + Turnstile origins + Next nonce |
| **N8** | 🟢 LOW | `BOT_SCORE_THRESHOLD` เป็น dead config (engine ฮาร์ดโค้ด 40/70 ไม่อ่าน env) | `lib/antibot.ts` | wire เข้า engine หรือลบ env + แก้ comment |
| **N11** | 🟢 LOW | `allowDangerousEmailAccountLinking:true` — Google auto-link เข้า local account email เดียวกัน | `lib/auth.ts:83` | เป็น conscious decision ได้ถ้าจะเปิด Google — แค่ comment กำกับ |

---

## ✅ 5. สิ่งที่โค้ดทำให้แล้วรอบนี้ (2026-06-04)

- ✅ **Resend ส่งอีเมลจริง** — `lib/email.ts` (REST API ผ่าน fetch, ไม่เพิ่ม dependency) + wire `app/actions/auth.ts` (เดิมเป็น `console.log` stub). ใส่ `RESEND_API_KEY` + `EMAIL_FROM` แล้วส่งจริงทันที (`tsc` 0 errors)
- ✅ **`pnpm db:deploy`** script (`prisma migrate deploy`) สำหรับ production migration
- ✅ **`.gitignore`** กัน `*.exe` / `*.zip` / `.claude` lock+local settings (กัน junk 631MB หลุดเข้า history)

---

## 🔮 6. Future work (ถ้าจะสเกลใหญ่ — ไม่จำเป็นสำหรับ thesis)

- **Level 3 gateway webhook** (ดู [15 §6](15_PAYMENT_SECURITY.md)) — เลิกเชื่อสลิปลูกค้า ให้ธนาคาร/เกตเวย์ยืนยันเงินเข้าเอง (checklist 9 ข้อใน §6.4)
- **EasySlip availability fallback** (T9) — manual admin-verify หรือ provider สำรอง (SlipOK) + monitor quota 500/เดือน
- **Stateful bot reputation** — สะสมคะแนน CHALLENGE/fail ต่อ IP+fingerprint เพื่อ escalate → BLOCK
- **JWT role revocation** — ลด session maxAge หรือ re-fetch role ใน jwt callback ถ้าต้อง revoke ทันที

---

## 📋 ลำดับแนะนำ (TL;DR)

1. **§0** rotate EasySlip key (เดี๋ยวนี้)
2. **§4 N1** ปิด transaction race (ก่อน demo ที่มีคนกดพร้อมกัน)
3. ขอ credentials (§1) → ตั้ง config (§2) → infra (§3)
4. **N5** admin guard + ตัดสินใจ **N4** (enforce หรือ document)
5. เปิด soft-launch จำนวนน้อย → ดู log → ค่อยขยาย
