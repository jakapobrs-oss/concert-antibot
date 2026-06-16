# 18 — Security Audit & Fix Checklist (โปรเจ็คจบ)

> รายการช่องโหว่ + แนวทางแก้ จากการตรวจโค้ดทั้งระบบ (auth / queue / anti-bot 2 ชั้น / payment / admin)
> **สร้างเมื่อ:** 2026-06-11 · **ระดับ:** thesis-grade (มี Repro + Fix + Verify ต่อข้อ)
> ต่อเนื่องจาก [15_PAYMENT_SECURITY.md](15_PAYMENT_SECURITY.md) และ [02_RECOMMENDATIONS.md](02_RECOMMENDATIONS.md)
> ใช้เป็น **checklist ติ๊กทีละข้อ** + วัตถุดิบหัวข้อ "Security Limitations & Hardening" / appendix ใน thesis

---

## 0. TL;DR

โค้ด "ใส่ใจความปลอดภัยสูงกว่าโปรเจ็คจบทั่วไปมาก" (argon2id, fail-closed, race-safe tx,
slip uniqueness, AdminLayout กัน CVE) แต่ยังมีจุดต้องปิด จัดลำดับ **"คุ้ม+เสี่ยงต่ำ ทำก่อน"**:

**ทำก่อน (ครึ่งวันเสร็จ):** #1 อัปเกรด Next.js · #2 rate-limit login · #9 validate BigInt · #7 payment footgun · #6 verify email
**ทำต่อ (แตะ logic):** #3 race ลิมิตตั๋ว · #5 per-payer cap
**Hardening:** #4 behavior auth · #8 seats userId · #10 CSP

> **วิธีใช้ไฟล์:** แต่ละข้อมี 4 บล็อก — **ปัญหา → 🔬 Repro (เจาะให้เห็น) → 🔧 Fix (code) → ✅ Verify (เทสต์ยืนยัน)**
> Repro/Verify ใช้แคปหน้าจอ/ใส่ตารางผลในเล่มได้เลย (ก่อน-หลังแก้)

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
| 9 | `BigInt()` กับ input ไม่ validate → 500 (ครบทุกจุดด้านล่าง) | 🟡 ต่ำ | ⭐ ง่าย | `account/tickets`, `checkout`, booking ฯลฯ |
| 10 | ไม่มี CSP + queue/leave,status ไม่ throttle | 🟡 ต่ำ | ⭐⭐ ปานกลาง | `next.config.ts:20` |

---

## 2. รายละเอียด + Repro + Fix + Verify

### 🔴 #1 — Next.js 15.1.0: CVE-2025-29927 (Middleware Auth Bypass)

- [ ] อัปเกรด Next.js เป็น 15.2.3+ (แนะนำ patch ล่าสุดของ 15.x)

**ปัญหา:** ผู้โจมตีส่ง header `x-middleware-subrequest` เพื่อ "ข้าม middleware ทั้งหมด" ได้ (patch ใน 15.2.3)
ผลกระทบหลักถูกกันไว้แล้วด้วย `AdminLayout` (`app/(admin)/layout.tsx`) + หน้า/action เช็ค session/role ซ้ำ
→ impact จริง "ต่ำ" แต่ควรแก้เพราะกรรมการเห็น CVE ทันที + อย่าให้ความปลอดภัยพึ่ง guard ซ้ำทุกหน้า

**🔬 Repro (ก่อนแก้):**
```bash
# header bypass ของ CVE-2025-29927 (ค่าซ้ำ middleware เท่ากับ MAX_RECURSION_DEPTH=5)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H 'x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware' \
  http://localhost:3000/admin
# โปรเจ็คเรา: ยัง redirect/ออก เพราะ AdminLayout เช็คซ้ำ (ดี) — แต่ middleware ถูกข้ามจริง
```

**🔧 Fix:**
```bash
pnpm up next@latest eslint-config-next@latest
```

**✅ Verify:**
```bash
pnpm why next        # ต้อง >= 15.2.3
pnpm typecheck && pnpm test:run
# รัน Repro ซ้ำ — middleware ต้องทำงานตามปกติ (ไม่ถูกข้าม)
```
**Ref:** GHSA-f82v-jwr5-mffw · https://nvd.nist.gov/vuln/detail/CVE-2025-29927

---

### 🟠 #2 — Login ไม่มี rate-limit

- [ ] เพิ่ม `checkRateLimit` ต่อ IP ใน `authorize()`
- [ ] (ทางเลือก) เปลี่ยน hard-lock เป็น backoff/Turnstile หลังผิดหลายครั้ง เพื่อลด lockout DoS

**ปัญหา:** มี per-account lockout (5 ครั้ง→ล็อก 15 นาที `lib/auth.ts:47-57`) แต่ไม่มี throttle ต่อ IP →
(ก) credential stuffing ยิงหลายบัญชีพร้อมกัน (ข) รู้อีเมลเหยื่อ → จงใจล็อกเหยื่อซ้ำได้ตลอด
(`failedLoginCount` รีเซ็ตเฉพาะตอน login สำเร็จ `lib/auth.ts:60-63`)

**🔬 Repro:**
```bash
# lockout DoS: ยิงรหัสผิด 5 ครั้งใส่อีเมลเหยื่อ → บัญชีโดนล็อก 15 นาที (เหยื่อ login ไม่ได้)
for i in $(seq 1 5); do
  curl -s -X POST http://localhost:3000/api/auth/callback/credentials \
    -d "email=victim@example.com&password=wrong$i" >/dev/null
done
# credential stuffing: รันชุดบนกับ "หลายอีเมล" จาก IP เดียว — ไม่มีอะไรหยุดยั้ง (ไม่มี IP throttle)
```

**🔧 Fix** — `lib/auth.ts` ใน `authorize()` ก่อน `verifyPassword`:
```ts
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";

const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
const rl = await checkRateLimit({ key: `login:ip:${ip}`, limit: 10, windowMs: 15 * 60_000 });
if (!rl.allowed) return null; // ตอบเป็นกลาง ไม่บอกว่าโดน throttle (กัน oracle)
```
> `authorize` รันบน Node runtime → เรียก redis/rate-limit ได้ปกติ

**✅ Verify:** เพิ่ม integration test — ยิง credentials ผิดจาก IP เดียว 11 ครั้ง (คนละอีเมล) ครั้งที่ 11 ต้องคืน `null` แม้บัญชียังไม่ล็อก; และ test lockout เดิมต้องยังผ่าน
**Ref:** OWASP — Credential Stuffing / Authentication Cheat Sheet

---

### 🟠 #3 — ลิมิตตั๋ว/คน เลี่ยงได้ด้วย race (TOCTOU)

- [ ] กัน 2 request ของ user เดียวกันทำ hold พร้อมกัน (Redis lock ต่อ user) **หรือ** เช็ค committed-count ซ้ำใน `finalizePaidOrder`

**ปัญหา:** `holdAndCreateOrder` (`booking.ts:75-93`) อ่าน `committed` → เช็ค → สร้าง order แบบไม่ atomic
admitted token 1 ใบเรียก action ได้หลายครั้ง ยิงพร้อมกัน → ทุก request อ่านค่าเดิม → ผ่านหมด → เกิน `maxTicketsPerUser`
(Redis seat-lock กันได้แค่ "ที่นั่งเดียวกัน" คนละที่นั่งผ่านหมด) backstop เหลือแค่ per-payer cap (10) ซึ่งหลวมกว่าลิมิตต่อคน (4)

**🔬 Repro** (เลียนแบบ `scripts/test-n1-race.ts`):
```ts
// ยิง holdAndCreateOrder พร้อมกัน N ครั้ง ด้วย token เดียว แต่ seatIds คนละชุด
await Promise.all([
  holdAndCreateOrder({ concertId, seatIds: ["1","2","3","4"], queueToken }),
  holdAndCreateOrder({ concertId, seatIds: ["5","6","7","8"], queueToken }),
]);
// ผล: ถือ 8 ที่นั่ง > maxTicketsPerUser(4)  ← บั๊ก
```

**🔧 Fix (แนะนำ — Redis lock ต่อ user, สไตล์เดียวกับ seat-hold):** ใน `holdAndCreateOrder` หลัง `isAdmitted` ผ่าน
```ts
import { redis } from "@/lib/redis";

const userLock = `hold-lock:${concertId}:${userId}`;
if ((await redis.set(userLock, "1", "PX", 10_000, "NX")) !== "OK") {
  return { ok: false, error: "กำลังดำเนินการคำขอก่อนหน้า กรุณารอสักครู่" };
}
try {
  // ...โค้ดเดิมทั้งหมด: นับ committed → เช็คลิมิต → holdSeats → สร้าง order...
} finally {
  await redis.del(userLock);
}
```
> ทางเลือกที่ทนกว่า (กันแม้ข้าม instance): ย้าย count-check + order.create เข้า `prisma.$transaction`
> เดียวกัน หรือเพิ่ม guard committed-count ใน `finalizePaidOrder` (เป็น backstop หลังจ่ายเงิน)

**✅ Verify:** เพิ่ม test คล้าย N1 — ยิงพร้อมกันแล้ว assert ยอดที่นั่งที่จองได้ ≤ `maxTicketsPerUser` เสมอ

---

### 🟠 #4 — `/api/behavior` ไม่ auth + ปลอม sessionKey ได้

- [ ] ผูก `sessionKey` กับ signed HttpOnly cookie ที่ server ออกให้ (แทนค่า client ส่งมาตรงๆ)
- [ ] เพิ่ม global rate-limit + ตั้ง retention/cleanup ของตาราง `behavior_sessions`

**ปัญหา:** endpoint ไม่ต้อง login + upsert ด้วย `sessionKey` (=fingerprint) จาก client (`route.ts:45`) →
(ก) รู้ fingerprint เหยื่อ → ยัด `isLikelyBot=true` → เหยื่อโดน CHALLENGE
(ข) ปั๊ม BehaviorSession ปลอมไม่จำกัด → สถิติ thesis เพี้ยน + DB บวม
> ดีไซน์ escalate-only ทำให้บอท "ลดคะแนนตัวเอง" ไม่ได้ — เก็บหลักการนี้ไว้ จุดที่ต้องอุดคือ "เขียนแทนคนอื่น"

**🔬 Repro:**
```bash
# ยัดคะแนน "เป็นบอท" ให้ fingerprint ของคนอื่น (รู้ค่า fp เหยื่อ) → เหยื่อโดน CHALLENGE รอบถัดไป
curl -s -X POST http://localhost:3000/api/behavior -H 'Content-Type: application/json' \
  -d '{"sessionKey":"VICTIM_FP","mouseMoveCount":0,"keyPressCount":0,"mouseTimingVariance":0,"mousePathEntropy":0,"dwellTimeMs":0}'
```

**🔧 Fix** — ออก cookie ฝั่ง server (เช่นตอนเข้าหน้า queue) แล้วใน `route.ts` เชื่อ cookie แทน body:
```ts
// อ่าน sessionKey จาก cookie ที่ server set ไว้ (httpOnly) — ห้ามเชื่อค่าจาก body ล้วน ๆ
const bound = req.cookies.get("bsid")?.value;
if (!bound || bound !== f.sessionKey) {
  return NextResponse.json({ error: "session ไม่ถูกต้อง" }, { status: 403 });
}
```
> ถ้ายังไม่อยากแตะ flow มาก: อย่างน้อยตั้ง cleanup job ลบ `behavior_sessions` เก่า + ลด rate-limit ลง

**✅ Verify:** ยิง Repro ด้วย sessionKey ที่ไม่ตรง cookie → ต้องได้ 403; flow ปกติ (cookie ตรง) ยัง upsert ได้

---

### 🟠 #5 — per-payer cap (หัวใจ anti-scalping ของ thesis)

- [ ] ตั้ง `isolationLevel: 'Serializable'` ใน `$transaction` ของ `finalizePaidOrder`
- [ ] ทำคีย์ผู้จ่ายให้ชนยากขึ้น (bank + เลข mask + ชื่อ) **หรือ** บันทึกข้อจำกัดใน thesis

**(ก) Concurrency:** นับตั๋ว payerKey แล้วออกตั๋วใน tx เดียว แต่ ReadCommitted →
สองสลิปผู้จ่ายเดียวกันเข้าพร้อมกันอาจอ่าน `priorPaid` เดิมทั้งคู่ → เกิน cap ที่ขอบ (`order-finalize.ts:60-72`)
**(ข) เลข mask ชนกัน:** `computePayerKey` ใช้ `digitsOnly` (`payer-key.ts:20`) — `"xxx-x-x1234-5"`→`"12345"`
คนละบัญชีจริงเลขท้ายเหมือนกัน = payerKey เดียวกัน → ลูกค้าจริงคนที่ 2 โอนแล้วโดน `PAYER_LIMIT`
→ เข้า path "ต้องคืนเงินด้วยมือ" (เก็บเงินแต่ไม่ได้ตั๋ว)

**🔬 Repro (concurrency):** ยิง `submitSlip` 2 order พร้อมกัน ที่ verify ออกมา payerKey เดียวกัน + ตั้ง limit ต่ำ (เช่น 1) → ได้ตั๋วทั้งคู่
**🔬 Repro (collision):** unit test `computePayerKey({senderAccount:"xxx-x-x1234-5"})` กับ `{senderAccount:"yyy-y-y1234-5"}` → ได้ `acct:12345` เท่ากัน

**🔧 Fix** — `lib/order-finalize.ts`:
```ts
import { Prisma } from "@prisma/client";

await prisma.$transaction(async (tx) => { /* ...เดิม... */ },
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
// + ดัก P2034 (serialization failure) ใน catch → retry/คืน DUPLICATE_SLIP
```

**✅ Verify:** test concurrency assert ออกตั๋วรวม ≤ limit เสมอ; unit test collision ของ `computePayerKey`

---

### 🟠 #6 — User enumeration + ไม่บังคับ verify email

- [ ] เปลี่ยน message สมัครให้เป็นกลาง (ไม่บอกว่าอีเมลซ้ำ)
- [ ] บังคับ `emailVerified` ก่อนเข้าคิว/ซื้อ (เพิ่มต้นทุนการปั๊มบัญชี)

**ปัญหา:** สมัครซ้ำคืน `"อีเมลนี้ถูกใช้แล้ว"` (`auth.ts:53-56`) → รู้ว่าอีเมลไหนลงทะเบียนแล้ว;
`authorize()` ไม่เช็ค `emailVerified` เลย → สมัครด้วยอีเมลมั่วแล้วใช้ได้ทันที (ติดแค่ 5/ชม./IP) ขัด threat model เราเอง

**🔬 Repro:** POST register ด้วยอีเมลที่มีอยู่ → ได้ข้อความยืนยันว่า "ถูกใช้แล้ว" (oracle); สมัครอีเมลมั่ว → join queue/ซื้อได้ทันทีโดยไม่ยืนยันอีเมล

**🔧 Fix:**
```ts
// app/actions/auth.ts — แทน { error: "อีเมลนี้ถูกใช้แล้ว" }
if (exists) return { ok: true, userId: "" }; // เงียบ — message กลาง "ถ้ายังไม่ถูกใช้ เราส่งลิงก์แล้ว"

// app/actions/booking.ts (holdAndCreateOrder) หลังได้ session
const u = await prisma.user.findUnique({ where: { id: BigInt(userId) }, select: { emailVerified: true } });
if (!u?.emailVerified) return { ok: false, error: "กรุณายืนยันอีเมลก่อนจองตั๋ว" };
```

**✅ Verify:** register อีเมลซ้ำ → message เหมือนกับกรณีอีเมลใหม่; user ที่ `emailVerified=null` กด hold → ถูกปฏิเสธ

---

### 🟠 #7 — Dev-mode payment bypass (footgun ตอน deploy)

- [ ] ทำให้ fail-closed อิงจาก "การมี EASYSLIP_API_KEY" เป็นหลัก (ไม่ใช่อิง NODE_ENV)
- [ ] เพิ่ม startup assert: เครื่องจริงต้องตั้ง `NODE_ENV=production`

**ปัญหา:** deploy โดยไม่ตั้ง `EASYSLIP_API_KEY` + `NODE_ENV` ไม่ใช่ `"production"` (default=`development` `env.ts:49`)
→ `verifySlip` mock ผ่านทุกสลิป (`easyslip.ts:55-69`) = แจกตั๋วฟรี ความปลอดภัยผูกกับ `NODE_ENV` ล้วน ๆ

**🔬 Repro:** `unset NODE_ENV; unset EASYSLIP_API_KEY; pnpm start` → กดจ่ายด้วยรูปอะไรก็ได้ → ออกตั๋ว (เพราะ mock)

**🔧 Fix** — `lib/easyslip.ts`: ให้ mock ทำได้เฉพาะเมื่อ "ตั้งใจเปิด dev" จริง ๆ เท่านั้น
```ts
// ต้องมี flag ชัดเจน เช่น ALLOW_MOCK_SLIP=true ถึง mock ได้ — ไม่งั้น fail-closed เสมอ
if (!isEasySlipConfigured) {
  if (process.env.ALLOW_MOCK_SLIP === "true") { /* mock เดิม + เตือนดัง */ }
  return { success: false, devMode: false, error: "ระบบยืนยันการชำระเงินยังไม่พร้อม" };
}
```

**✅ Verify:** ไม่ตั้งทั้ง key และ flag → `verifySlip` คืน `success:false` (ไม่ออกตั๋ว) ไม่ว่า NODE_ENV เป็นอะไร

---

### 🟡 #8 — หน้า seats เช็ค `isAdmitted` ไม่ผูก userId

- [ ] เพิ่ม `auth()` + ส่ง `userId` เข้า `isAdmitted(qt, concertId, userId)` ให้ตรงกับ `holdAndCreateOrder`

**ปัญหา:** `seats/page.tsx:57` เรียก `isAdmitted(qt, concert.id.toString())` ไม่ส่ง userId
→ ใครถือ admitted token ของคอนเสิร์ตนั้นก็เปิดผังที่นั่งได้ (ซื้อยังกันที่ action — impact ต่ำ) และหน้านี้ไม่ require login

**🔬 Repro:** เอา `qt` ที่ admit แล้ว เปิด `/concerts/<slug>/seats?qt=<token>` แบบไม่ล็อกอิน/คนละ user → เห็นผังที่นั่ง

**🔧 Fix** — `seats/page.tsx`:
```ts
import { auth } from "@/lib/auth";
const session = await auth();
const userId = (session?.user as { id?: string } | undefined)?.id;
if (!userId) redirect(`/login?callbackUrl=/concerts/${slug}/queue`);
const admitted = qt ? await isAdmitted(qt, concert.id.toString(), userId) : false;
```

**✅ Verify:** เปิดหน้า seats ด้วย token ที่ไม่ใช่ของ session ปัจจุบัน → ถูก redirect ไปห้องรอ

---

### 🟡 #9 — `BigInt(input)` กับ input ไม่ validate → 500 (รายการครบ)

- [ ] validate ให้เป็นตัวเลขก่อน (`z.string().regex(/^\d+$/)`) หรือใช้ helper `toId()` ครอบ `BigInt()`

**ปัญหา:** `BigInt("abc")` throw → 500 ที่ไม่ได้จัดการ จุดที่รับ **input จากผู้ใช้** (ไม่นับ `BigInt(userId)` ที่มาจาก session = ปลอดภัย):

| จุด | ไฟล์:บรรทัด | validate ปัจจุบัน | repro |
|---|---|---|---|
| tickets `order` param | `account/tickets/page.tsx:29` | ❌ ไม่มีเลย | `/account/tickets?order=abc` → 500 |
| checkout `orderId` param | `checkout/[orderId]/page.tsx:23` | ❌ ไม่มีเลย | `/checkout/abc` → 500 |
| cancelOrder `orderId` | `booking.ts:312` | ❌ ไม่ผ่าน schema | ส่ง orderId ไม่ใช่ตัวเลข → 500 |
| queue join `concertId` | `api/queue/join/route.ts:64` | ⚠️ แค่ `.min(1)` | `{"concertId":"abc"}` → 500 |
| hold `concertId`/`seatIds` | `booking.ts:60,96,134` | ⚠️ แค่ `.min(1)` | seatId ไม่ใช่ตัวเลข → 500 |
| submitSlip `orderId` | `booking.ts:202` | ⚠️ แค่ `.min(1)` | — |
| admin concert `id` | `admin/concerts/[id]/page.tsx:21`, `concert.ts:91` | ❌ (admin เท่านั้น) | — |

**🔬 Repro:** (ล็อกอินแล้ว) เปิด `http://localhost:3000/account/tickets?order=abc` → หน้า 500

**🔧 Fix** — helper กลาง + ใช้แทน `BigInt()` ทุกจุดข้างบน:
```ts
// lib/id.ts
export function toId(v: unknown): bigint | null {
  return typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null;
}
// ใช้: const id = toId(orderId); if (id === null) notFound();   // หรือ return 400
// และในทุก schema เปลี่ยน z.string().min(1) → z.string().regex(/^\d+$/)
```

**✅ Verify:** เปิด URL ใน Repro → ต้องได้ 404/400 (ไม่ใช่ 500); flow ปกติยังทำงาน

---

### 🟡 #10 — ไม่มี CSP + queue endpoint ไม่ throttle

- [ ] เพิ่ม Content-Security-Policy ใน `next.config.ts:headers()`
- [ ] เพิ่ม rate-limit ให้ `/api/queue/status` และ `/api/queue/leave`

**ปัญหา:** CSP ยังไม่ใส่ (`next.config.ts:20`) — หน้า payment ควรมี; `/api/queue/status` ยิง Redis หลายครั้ง/call, `/api/queue/leave` ลบ token ได้โดยไม่ auth (ติดแค่ต้องรู้ token)

**🔧 Fix (CSP)** — เติมใน array `headers` ของ `next.config.ts` (allowlist Turnstile + data:/blob: สำหรับ QR + MinIO):
```ts
{
  key: "Content-Security-Policy",
  value: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",   // Turnstile widget
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http://localhost:9000", // QR เป็น data URL + MinIO
    "connect-src 'self' https://challenges.cloudflare.com",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; "),
}
```
> `'unsafe-inline'` เป็นการประนีประนอม (Next ฉีด inline script) — เวอร์ชันเข้มกว่าใช้ nonce เป็น follow-up

**🔧 Fix (throttle)** — เพิ่ม `checkRateLimit({ key: \`queue_status:ip:${ip}\`, limit: 60, windowMs: 60_000 })` ใน status route

**✅ Verify:** `curl -I http://localhost:3000/checkout/1` เห็น header `Content-Security-Policy`; ยิง status รัว ๆ เกิน limit → 429

---

## 3. Anti-Bot Effectiveness — หัวข้อ "Limitations" ใน thesis

> ไม่ใช่บั๊ก แต่เป็นขีดจำกัดเชิงออกแบบที่ "ควรอภิปรายตรงๆ" (กรรมการชอบงานที่รู้ขีดจำกัดตัวเอง)

- [ ] **Layer 1 = Turnstile เป็นด่านจริงด่านเดียว** — UA/header heuristic เลี่ยงง่าย (ปลอม UA+header ครบ = 0 คะแนน); บอทเชิงพาณิชย์ใช้ CAPTCHA-solving service ผ่าน Turnstile ได้
- [ ] **Layer 2 แทบไม่บล็อกแบบ real-time** — `flushBehavior()` ถูกเรียกตอน ADMITTED (`waiting-room.tsx:73`) = *หลัง* ประเมิน join + escalate-only + บอทแค่ "ไม่ส่ง behavior" ก็รอด → มีค่าเป็น "เก็บ dataset" มากกว่าบล็อกสด
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
4. ทุกครั้งหลังแก้: `pnpm typecheck && pnpm test:run` แล้ว commit ทีละข้อ (commit message อ้าง #ข้อ + แนบผล Repro/Verify)

---

## 6. References

- **CVE-2025-29927** (Next.js middleware bypass): https://nvd.nist.gov/vuln/detail/CVE-2025-29927 · GHSA-f82v-jwr5-mffw
- **OWASP Cheat Sheets:** Authentication · Credential Stuffing Prevention · Content Security Policy · Mass Assignment · Input Validation — https://cheatsheetseries.owasp.org/
- **OWASP ASVS v4** (Application Security Verification Standard) — ใช้อ้างอิงเกณฑ์ในเล่ม
- **argon2 params (OWASP Password Storage):** ยืนยันค่าใน `lib/password.ts` ตรงตาม baseline
- **Prisma transaction isolation:** https://www.prisma.io/docs/orm/prisma-client/queries/transactions
