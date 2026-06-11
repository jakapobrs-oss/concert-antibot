# 18 — Security Audit & Fix Checklist (โปรเจ็คจบ)

> รายการช่องโหว่ + แนวทางแก้ จากการตรวจโค้ดทั้งระบบ (auth / queue / anti-bot 2 ชั้น / payment / admin)
> **สร้างเมื่อ:** 2026-06-11
> ต่อเนื่องจาก [15_PAYMENT_SECURITY.md](15_PAYMENT_SECURITY.md) และ [02_RECOMMENDATIONS.md](02_RECOMMENDATIONS.md)
> ใช้เป็น **checklist ติ๊กทีละข้อ** + วัตถุดิบหัวข้อ "Security Limitations & Hardening" ใน thesis

---

## 0. TL;DR

โค้ด "ใส่ใจความปลอดภัยสูงกว่าโปรเจ็คจบทั่วไปมาก" (argon2id, fail-closed, race-safe tx,
slip uniqueness, AdminLayout กัน CVE) แต่ยังมีจุดต้องปิด จัดลำดับ **"คุ้ม+เสี่ยงต่ำ ทำก่อน"**:

**ทำก่อน (ครึ่งวันเสร็จ):** #1 อัปเกรด Next.js · #2 rate-limit login · #9 validate BigInt
**ทำต่อ (แตะ logic):** #3 race ลิมิตตั๋ว · #5 per-payer cap · #6 verify email · #7 payment footgun
**Hardening:** #4 behavior auth · #8 seats userId · #10 CSP

---

## 1. ตารางสรุป (Priority)

| # | ช่องโหว่ | ระดับ | แรง/คุ้ม | ไฟล์หลัก |
|---|---------|:-----:|:--------:|----------|
| 1 | Next.js 15.1.0 ติด CVE-2025-29927 (middleware bypass) | 🔴 สูง | ⭐ ง่ายมาก | `package.json:47` |
| 2 | Login ไม่มี rate-limit → credential stuffing + lockout DoS | 🟠 กลาง | ⭐ ง่าย | `lib/auth.ts:30-74` |
| 3 | ลิมิตตั๋ว/คน เลี่ยงได้ด้วย race (TOCTOU) | 🟠 กลาง | ⭐⭐ ปานกลาง | `app/actions/booking.ts:75-130` |
| 4 | `/api/behavior` ไม่ auth + sessionKey ปลอมได้ | 🟠 กลาง | ⭐⭐ ปานกลาง | `app/api/behavior/route.ts` |
| 5 | per-payer cap ชนใต้ concurrency + เลข mask ชนกัน | 🟠 กลาง | ⭐⭐ ปานกลาง | `lib/order-finalize.ts:60-72`, `lib/payer-key.ts` |
| 6 | User enumeration ตอนสมัคร + ไม่บังคับ verify email | 🟠 กลาง | ⭐ ง่าย | `app/actions/auth.ts:53-56`, `lib/auth.ts` |
| 7 | Dev-mode payment bypass ถ้า deploy ผิด (NODE_ENV) | 🟠 กลาง | ⭐ ง่าย | `lib/easyslip.ts:55-69` |
| 8 | หน้า seats เช็ค `isAdmitted` ไม่ผูก userId | 🟡 ต่ำ | ⭐ ง่าย | `app/(public)/concerts/[slug]/seats/page.tsx:57` |
| 9 | `BigInt()` กับ input ไม่ validate → 500 | 🟡 ต่ำ | ⭐ ง่าย | `app/api/queue/join/route.ts:64` ฯลฯ |
| 10 | ไม่มี CSP + queue/leave,status ไม่ throttle | 🟡 ต่ำ | ⭐⭐ ปานกลาง | `next.config.ts:20` |

---

## 2. รายละเอียด + วิธีแก้ (ติ๊กได้)

### 🔴 #1 — Next.js 15.1.0: CVE-2025-29927 (Middleware Auth Bypass)

- [ ] อัปเกรด Next.js เป็น 15.2.3+ (แนะนำ patch ล่าสุดของ 15.x)

**ปัญหา:** ผู้โจมตีส่ง header `x-middleware-subrequest` เพื่อ "ข้าม middleware ทั้งหมด" ได้ (patch ใน 15.2.3)
**สถานะเรา:** ผลกระทบหลักถูกกันไว้แล้ว — `AdminLayout` (`app/(admin)/layout.tsx`) + หน้า/action เช็ค session/role ซ้ำ
→ impact จริง "ต่ำ" แต่ควรแก้เพราะกรรมการจะเห็น CVE ทันที + อย่าให้ความปลอดภัยพึ่ง guard ซ้ำทุกหน้า

```bash
pnpm up next@latest eslint-config-next@latest
pnpm test:run && pnpm typecheck   # ยืนยันไม่พัง
```

---

### 🟠 #2 — Login ไม่มี rate-limit

- [ ] เพิ่ม `checkRateLimit` ต่อ IP ใน `authorize()`
- [ ] (ทางเลือก) เปลี่ยน hard-lock เป็น backoff/Turnstile หลังผิดหลายครั้ง เพื่อลด lockout DoS

**ปัญหา:** มี per-account lockout (5 ครั้ง→ล็อก 15 นาที) แต่ไม่มี throttle ต่อ IP →
(ก) credential stuffing ยิงหลายบัญชีพร้อมกัน (ข) รู้อีเมลเหยื่อ → จงใจล็อกเหยื่อซ้ำได้ตลอด
(`failedLoginCount` รีเซ็ตเฉพาะตอน login สำเร็จ `lib/auth.ts:60-63`)

```ts
// lib/auth.ts — ใน authorize() ก่อน verifyPassword
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";

const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
const rl = await checkRateLimit({ key: `login:ip:${ip}`, limit: 10, windowMs: 15 * 60_000 });
if (!rl.allowed) return null;
```
> หมายเหตุ: `authorize` รันบน Node runtime (ไม่ใช่ Edge) เรียก redis/rate-limit ได้ปกติ

---

### 🟠 #3 — ลิมิตตั๋ว/คน เลี่ยงได้ด้วย race (TOCTOU)

- [ ] ย้ายการนับ+เช็คลิมิตเข้า transaction เดียวกับการสร้าง order **หรือ** เช็คซ้ำใน `finalizePaidOrder`

**ปัญหา:** `holdAndCreateOrder` (`booking.ts:75-93`) อ่าน `committed` → เช็ค → สร้าง order แบบไม่ atomic
admitted token 1 ใบเรียก action ได้หลายครั้ง ยิงพร้อมกัน → ทุก request อ่านค่าเดิม → ผ่านหมด → เกิน `maxTicketsPerUser`
(Redis lock กันได้แค่ "ที่นั่งเดียวกัน" คนละที่นั่งผ่านหมด) backstop เหลือแค่ per-payer cap (10) ซึ่งหลวมกว่าลิมิตต่อคน (4)

**แนวทาง:** เพิ่มการเช็ค committed-count ซ้ำใน transaction ของ `finalizePaidOrder`
(เป็น tx อยู่แล้ว — `order-finalize.ts:60`) เพื่อให้ "ลิมิตต่อคน" ถูกบังคับจริงแม้ race
ทางเลือกที่เข้มกว่า: ใช้ Redis counter ต่อ `user:concert` ตอน hold (atomic INCR + ตรวจเพดาน)

---

### 🟠 #4 — `/api/behavior` ไม่ auth + ปลอม sessionKey ได้

- [ ] ผูก `sessionKey` กับ signed HttpOnly cookie ที่ server ออกให้ (แทนค่า client ส่งมาตรงๆ)
- [ ] เพิ่ม global rate-limit + ตั้ง retention/cleanup ของตาราง `behavior_sessions`

**ปัญหา:** endpoint ไม่ต้อง login + upsert ด้วย `sessionKey` (=fingerprint) จาก client (`route.ts:45`) →
(ก) รู้ fingerprint เหยื่อ → ยัด `isLikelyBot=true` → เหยื่อโดน CHALLENGE (จำกัดผลเพราะ escalate-only — ดีแล้ว)
(ข) ปั๊ม BehaviorSession ปลอมไม่จำกัด → สถิติ thesis เพี้ยน + DB บวม
> ดีไซน์ escalate-only ทำให้บอท "ลดคะแนนตัวเอง" ไม่ได้ — เก็บหลักการนี้ไว้

---

### 🟠 #5 — per-payer cap (หัวใจ anti-scalping ของ thesis)

- [ ] ตั้ง `isolationLevel: 'Serializable'` ใน `$transaction` ของ `finalizePaidOrder` (กัน concurrency ออกตั๋วเกิน cap)
- [ ] ทำคีย์ผู้จ่ายให้ชนยากขึ้น (bank code + เลข mask + ชื่อ) **หรือ** บันทึกข้อจำกัดใน thesis

**(ก) Concurrency:** นับตั๋ว payerKey แล้วออกตั๋วใน tx เดียว แต่ ReadCommitted →
สองสลิปผู้จ่ายเดียวกันเข้าพร้อมกันอาจอ่าน `priorPaid` เดิมทั้งคู่ → เกิน cap ที่ขอบ (`order-finalize.ts:60-72`)

**(ข) เลข mask ชนกัน:** `computePayerKey` ใช้ `digitsOnly` (`payer-key.ts:20`) — `"xxx-x-x1234-5"`→`"12345"`
คนละบัญชีจริงเลขท้ายเหมือนกัน = payerKey เดียวกัน → ลูกค้าจริงคนที่ 2 โอนแล้วโดน `PAYER_LIMIT`
→ เข้า path "ต้องคืนเงินด้วยมือ" (เก็บเงินแต่ไม่ได้ตั๋ว = เรื่องเงินจริง)

```ts
// lib/order-finalize.ts — เปลี่ยนเป็น
await prisma.$transaction(async (tx) => { /* ...เดิม... */ },
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```

---

### 🟠 #6 — User enumeration + ไม่บังคับ verify email

- [ ] เปลี่ยน message สมัครให้เป็นกลาง (ไม่บอกว่าอีเมลซ้ำ)
- [ ] บังคับ `emailVerified` ก่อนเข้าคิว/ซื้อ (เพิ่มต้นทุนการปั๊มบัญชี)

**ปัญหา:** สมัครซ้ำคืน `"อีเมลนี้ถูกใช้แล้ว"` (`auth.ts:53-56`) → รู้ว่าอีเมลไหนลงทะเบียนแล้ว;
`authorize()` ไม่เช็ค `emailVerified` เลย → สมัครด้วยอีเมลมั่วแล้วใช้ได้ทันที (ติดแค่ 5/ชม./IP)
ขัดกับ threat model anti-scalping ของเราเอง

```
// แทน "อีเมลนี้ถูกใช้แล้ว" →
"ถ้าอีเมลนี้ยังไม่ถูกใช้ เราได้ส่งลิงก์ยืนยันให้แล้ว — กรุณาตรวจกล่องอีเมล"
```

---

### 🟠 #7 — Dev-mode payment bypass (footgun ตอน deploy)

- [ ] ทำให้ fail-closed อิงจาก "การมี EASYSLIP_API_KEY" เป็นหลัก (ไม่ใช่อิง NODE_ENV)
- [ ] เพิ่ม startup assert: ถ้าเครื่องจริงไม่ได้ตั้ง `NODE_ENV=production` ให้ crash

**ปัญหา:** ถ้า deploy โดยไม่ตั้ง `EASYSLIP_API_KEY` และ `NODE_ENV` ไม่ใช่ `"production"`
(default = `"development"` ที่ `env.ts:49`) → `verifySlip` mock ผ่านทุกสลิป (`easyslip.ts:55-69`) = แจกตั๋วฟรี
ความปลอดภัยตอนนี้ผูกกับ `NODE_ENV` ล้วนๆ

---

### 🟡 #8 — หน้า seats เช็ค `isAdmitted` ไม่ผูก userId

- [ ] ส่ง `userId` เข้า `isAdmitted(qt, concertId, userId)` ให้สอดคล้องกับ `holdAndCreateOrder`

**ปัญหา:** `seats/page.tsx:57` เรียก `isAdmitted(qt, concert.id.toString())` ไม่ส่ง userId
→ ใครถือ admitted token ของคอนเสิร์ตนั้นก็ดูผังที่นั่งได้ (การ "ซื้อ" ยังกันอยู่ที่ action — impact ต่ำ)
แต่หน้านี้ไม่ require login ด้วย ควรเพิ่ม `auth()` + ผูก userId เพื่อ defense-in-depth

---

### 🟡 #9 — `BigInt(input)` กับ input ไม่ validate → 500

- [ ] validate ให้เป็นตัวเลขก่อน (`z.string().regex(/^\d+$/)`) หรือ try/catch รอบ `BigInt()`

**ปัญหา:** หลายจุดรับ string ที่ validate แค่ `.min(1)` เช่น `api/queue/join/route.ts:64`
ส่ง `{"concertId":"abc"}` → `BigInt("abc")` throw → 500 ที่ไม่ได้จัดการ
จุดที่ควรไล่แก้: queue join, booking (`holdSchema`/`slipSchema`), checkout/tickets page params

---

### 🟡 #10 — ไม่มี CSP + queue endpoint ไม่ throttle

- [ ] เพิ่ม Content-Security-Policy (allowlist Turnstile + Next inline) ใน `next.config.ts:headers()`
- [ ] เพิ่ม rate-limit ให้ `/api/queue/status` และ `/api/queue/leave`

**ปัญหา:** CSP ยังไม่ใส่ (คอมเมนต์ยอมรับไว้แล้ว `next.config.ts:20`) — หน้า payment ควรมี;
`/api/queue/status` ยิง Redis หลายครั้งต่อ call และ `/api/queue/leave` ลบ token ได้โดยไม่ auth (ติดแค่ต้องรู้ token)

---

## 3. Anti-Bot Effectiveness — เขียนหัวข้อ "Limitations" ใน thesis

> ไม่ใช่บั๊ก แต่เป็นขีดจำกัดเชิงออกแบบที่ "ควรอภิปรายตรงๆ" (กรรมการชอบงานที่รู้ขีดจำกัดตัวเอง)

- [ ] **Layer 1 = Turnstile เป็นด่านจริงด่านเดียว** — UA/header heuristic เลี่ยงง่าย (ปลอม UA+header ครบ = 0 คะแนน); บอทเชิงพาณิชย์ใช้ CAPTCHA-solving service ผ่าน Turnstile ได้
- [ ] **Layer 2 แทบไม่บล็อกแบบ real-time** — `flushBehavior()` ถูกเรียกตอน ADMITTED (`waiting-room.tsx:73`) = *หลัง* ประเมิน join ไปแล้ว + escalate-only + บอทแค่ "ไม่ส่ง behavior" ก็รอด → Layer 2 มีค่าเป็น "เก็บ dataset" มากกว่าบล็อกสด
- [ ] **Rate-limit เป็น per-IP** — botnet/proxy หมุน IP เลี่ยงได้
- [ ] **ไม่มี anti-bot ซ้ำหลังเข้าคิว** — field `checkpoint` ส่อว่าตั้งใจมี `seat_select` แต่ยังไม่ทำ
- [ ] **จุดแข็งที่ควรชู:** ด่านที่ "ปลอมไม่ได้จริง" = **per-payer cap ที่ชั้นจ่ายเงิน** (บอทปั๊ม account ฟรีได้ แต่บัญชีธนาคารจริงปั๊มไม่ไหว) — argument ที่แข็งสุด ควรเน้น + แก้ #5 ให้รัดกุม

---

## 4. สิ่งที่ทำได้ดีอยู่แล้ว (ตอบ defense ได้)

argon2id ตาม OWASP · fail-closed ทั้ง Turnstile/EasySlip/receiver-check · slipRef unique กันสลิปซ้ำ ·
slip freshness กันสลิปเก่า · race-safe finalize/cancel/sweeper ด้วย conditional `updateMany` ·
AdminLayout guard กัน CVE-2025-29927 · ไม่มี secret หลุดใน git · ไม่มี XSS sink · security headers พื้นฐานครบ

---

## 5. ลำดับลงมือแนะนำ

1. **รอบที่ 1 (quick wins):** #1 → #2 → #9 → #7 → #6  *(ไม่แตะ logic ซับซ้อน, เสร็จเร็ว)*
2. **รอบที่ 2 (core logic):** #3 → #5  *(แตะ transaction — เขียน/รัน test ทุกครั้ง: `pnpm test:run`)*
3. **รอบที่ 3 (hardening):** #4 → #8 → #10
4. ทุกครั้งหลังแก้: `pnpm typecheck && pnpm test:run` แล้วค่อย commit ทีละข้อ (commit message อ้าง #ข้อ)
