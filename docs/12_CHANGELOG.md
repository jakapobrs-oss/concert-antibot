# 12 — Changelog (Session History)

> บันทึกทุกการเปลี่ยนแปลงของแผน + เหตุผล
> ใช้เป็น **session continuity** — เปิด session ใหม่อ่านไฟล์นี้แล้วเข้าใจทุกอย่าง

---

## [Revision 40 — สวิตช์ผู้ให้บริการตรวจสลิป `SLIP_PROVIDER` + adapter SlipOK (ฟรี 100 สลิป/เดือน) — EasySlip เป็นตัวสำรอง] — 2026-08-27

**ที่มา:** rev 39 พบแอปทดลอง EasySlip หมดอายุ ต่ออายุต้องเสียเงิน (Start ฿99/250 สลิป) — user ถามหาเจ้าที่ฟรี → เทียบ 6 เจ้า (EasySlip · SlipOK · Thunder · Slip2Go · Check Slip · RDCW): **ฟรีถาวรมีแค่ SlipOK** (OK BASIC 100 สลิป/เดือน ต่ออายุเอง เกิน ฿1/สลิป) ที่เหลือเป็นทดลองครั้งเดียว → user เลือก SlipOK + ให้ทำสวิตช์ไว้เลย

**ทำ**
- `lib/slip-policy.ts` (ใหม่ — ด่านกลางทุกเจ้า): `SlipVerifyResult`/`SlipVerifyParams`/`ParsedSlip`/`SlipProviderAdapter` · `applySlipPolicy()` (บัญชีปลายทาง `PROMPTPAY_ID` + ชื่อผู้รับ `PAYMENTS_RECEIVER_NAME` + ต้องมี transRef — ย้ายมาจาก easyslip.ts ไม่เปลี่ยนกติกา) · `runSlipVerification()` (ต้องแนบสลิป → ตั้งค่าครบ? → ตรวจจริง / production fail-closed / dev mock) · `decodeSlipImage()`
- `lib/slipok.ts` (ใหม่): `POST https://api.slipok.com/api/line/apikey/{branchId}` header `x-authorization`, multipart `files` + `amount` (ให้ SlipOK เทียบยอดซ้ำ → 1013 พร้อมยอดในสลิป) + `log` (default false — ระบบกันซ้ำด้วย `slipRef` UNIQUE อยู่แล้ว และถ้าเปิด การส่งสลิปเดิมซ้ำหลังระบบล้มกลางทางจะถูก SlipOK ปฏิเสธ) · แกะ `transDate "YYYYMMDD"+transTime` เป็นเวลาไทย (`parseSlipOkDateTime`) · ปลายทางใช้ `receiver.proxy.value` (พร้อมเพย์ masked) · รหัส error แยก **system** (1001–1004 → "ไม่ใช่ความผิดของสลิป ติดต่อผู้ดูแล") / **transient** (1009 รอ 15 นาที · 1010 บอกธนาคาร+นาทีที่ต้องรอ) / **slip** (1005–1008, 1011–1014 บอกวิธีแก้) + log `[PAYMENT][SLIPOK]` · `fetchSlipOkQuotaStatus()` (`GET …/quota` → quota+specialQuota, overQuota) + `slipOkHealthWarnings()`
- `lib/slip-verify.ts` (ใหม่ — จุดเข้าเดียว): `verifySlip()` เลือก adapter ตาม `env.SLIP_PROVIDER` · `isSlipVerifierConfigured` · `getSlipProviderStatus()` (การ์ดแดชบอร์ด: label/line/tone/hint ของเจ้าที่เปิดใช้) · `warnSlipProviderHealth()` (boot-warn) — `app/actions/booking.ts` import จากไฟล์นี้แทน easyslip · `instrumentation.ts` + แดชบอร์ดแอดมินใช้สถานะรวม (การ์ดเปลี่ยนหัวเป็น "ตรวจสลิปอัตโนมัติ (SlipOK|EasySlip)")
- `lib/easyslip.ts`: เหลือแค่คุยกับ EasySlip + แกะคำตอบ → `applySlipPolicy` · export `easySlipAdapter` · `verifySlip` เดิมยังอยู่ (เทส/สคริปต์เก่าไม่พัง)
- env: `SLIP_PROVIDER` (easyslip|slipok, default easyslip) · `SLIPOK_API_KEY` · `SLIPOK_BRANCH_ID` · `SLIPOK_LOG` (default false) — `lib/env.ts` boot-warn ตรวจคีย์ของ "เจ้าที่เปิดใช้" เท่านั้น (`isSlipVerifierConfigured`/`slipVerifierMissingEnv`) · `scripts/check-env.ts` PROD_FAIL_MISSING เปลี่ยนตาม provider · `.env.example` อธิบายวิธีเอา API key + ไอดีสาขาจากเมนู API ในไลน์ SlipOK
- ⚠️ ยังไม่ได้ยิง SlipOK จริง (user ยังไม่ได้สมัคร/ยังไม่มีคีย์) — shape ยืนยันจากเอกสาร v1.8 + SDK ชุมชน (`PrakritManStudio/slipok-sdk` types) · ขั้นถัดไปเมื่อได้คีย์: ตั้ง `SLIP_PROVIDER=slipok`+คีย์ใน `.env` → `pnpm check:env` → โอนจริง 1 ครั้งบน dev/preview ก่อน push env ขึ้น prod

**หลักฐาน:** unit **56 ไฟล์ 691/691** (ใหม่: `slipok` 15 · `slip-verify` 6 · ของเดิม `easyslip`/`easyslip-errors` ผ่านโดยไม่แก้) · tsc 0 · lint 0 error · `next build` local ผ่าน

## [Revision 39 — โอนจริงครั้งแรกบน prod: แอป EasySlip หมดอายุแต่ระบบโทษ "สลิปไม่ถูกต้อง" · คอนเสิร์ตชื่อไทยล้วนได้ slug ว่าง กดเข้าไม่ได้ทั้งที่ขึ้น "กำลังขาย"] — 2026-08-27

**ที่มา:** user เทสโอนจริง 2 บาทเข้าคอน `test` (#47) → "ตรวจสอบสลิปไม่สำเร็จ — สลิปอาจไม่ถูกต้อง" ทั้งที่สลิปถูกทุกอย่าง · สร้างคอน "คอนพี่เจี๊ยบ" (#48) แล้วขึ้น "กำลังขาย" แต่กดจากหน้ารายการแล้วเด้งกลับหน้าเดิม (user เดาว่า "คงยังไม่ถึงเวลา")

**ต้นเหตุ (พิสูจน์แล้ว ไม่ใช่เดา)**
1. **EasySlip แอปหมดอายุ** — `GET /api/v1/me` ด้วยคีย์จริง → `{"application":"Concert","maxQuota":50,"expiredAt":"2026-06-10T20:19:03+07:00"}` (แอปฟรีอายุ ~7 วันจากวันสร้าง 3 มิ.ย. rev 16) · `POST /verify` ทุกรูปแบบ (JSON/multipart) → `{"status":403,"message":"application_expired"}` · `lib/easyslip.ts` เดิม map ทุก non-200 เป็น "สลิปอาจไม่ถูกต้อง" และ**ไม่ log `data.message`** → Vercel log ของ `POST /checkout/5` มีแค่ boot-warn ไล่ไม่ได้ · หมายเหตุ: `.env.example` เขียน "500/เดือนฟรี" แต่แอปจริงโควต้า 50
2. **slug ว่าง** — `slugify()` ใน `app/actions/concert.ts` ตัดทุกอักขระนอก `[A-Za-z0-9_]` → ชื่อไทยล้วนได้ `""` (prod HTML: `{"id":"48","title":"คอนพี่เจี๊ยบ","slug":""}`) → การ์ด `<Link href="/concerts/">` ถูก Next normalize เป็น `/concerts` = หน้ารายการเดิม; ปุ่ม "ดูหน้าเว็บ" ในแอดมินก็ชี้ `/concerts` เหมือนกัน · **ไม่ใช่เรื่องเวลา** (saleStartAt 09:00 ผ่านแล้ว มี 6 โซน 1,042 ที่นั่ง ไม่มีรอบ)
   - พลอยเจอ: `deriveDisplayStatus` ไม่ดู `eventAt` → #48 งาน 10:00 วันนี้ แต่ saleEndAt พรุ่งนี้ = ขึ้น "กำลังขาย" ทั้งวันหลังงานจบ · แถบตัววิ่งหน้าแรก + ตัวนับ "กำลังขาย" หน้ารายการยังใช้ status ดิบ (คอน "A" ไม่มีโซนโผล่ในแถบ "กำลังขาย — A") · หน้าแอดมินโชว์ป้ายที่ตั้ง (ON_SALE = "กำลังขาย") โดยไม่บอกว่าผู้ชมเห็นอะไร

**ทำ**
- `lib/easyslip.ts`: map รหัส error เป็น 2 กลุ่ม — `EASYSLIP_SYSTEM_ERRORS` (unauthorized/application_expired/quota_exceeded/…) → "ระบบตรวจสอบสลิปขัดข้องชั่วคราว ไม่ใช่ความผิดของสลิปคุณ — ติดต่อผู้ดูแล (รหัส: …)" · `EASYSLIP_SLIP_ERRORS` (invalid_image/slip_not_found/duplicate_slip/image_size_too_large/slip_pending/…) → บอกวิธีแก้ที่ผู้ใช้ทำได้ · `console.error("[PAYMENT][EASYSLIP] … code=…")` ทุกครั้ง + `errorCode` ใน result · ส่งรูปเป็น **multipart ฟิลด์ `file` ไบนารี** (`decodeSlipImage` ตัด prefix data URL) แทน JSON `{image}` ตามเอกสาร v1 · `AbortSignal.timeout(20s)` · `fetchEasySlipAccountStatus()` (/me → expiredAt/daysLeft/quota ไม่ throw) + `easySlipHealthWarnings()`
- แดชบอร์ดแอดมิน (`app/(admin)/admin/page.tsx`): การ์ด "ตรวจสลิปอัตโนมัติ (EasySlip)" แดง (หมดอายุ/คีย์ใช้ไม่ได้/ไม่ตั้ง) · เหลือง (เหลือ ≤7 วัน หรือโควต้า ≤10) · เขียว + วิธีต่ออายุ; ใส่ใน context ของ Gemini ด้วย · `instrumentation.ts` `register()` เตือน `🚨 [PAYMENT][EASYSLIP]` ตอน cold start บน production (best-effort ไม่บล็อก boot)
- `lib/slug.ts` (pure, ใหม่): `slugifyTitle` (พฤติกรรมเดิมสำหรับอังกฤษ) + `resolveConcertSlug` — ไทยล้วน → `concert-<id>` · ชื่อซ้ำ → `<slug>-<id>` (deterministic แทน timestamp) · `createConcert` สร้างใน `$transaction` (slug ชั่วคราว → ตั้งจริงจาก id) · migration `20260827031500_fix_empty_concert_slug` ซ่อมแถว slug ว่างเป็น `concert-<id>` (#48 → `/concerts/concert-48`; รันเองตอน deploy ผ่าน buildCommand)
- `lib/concert-display.ts`: รับ `eventAt` (optional) — วันงานผ่านแล้ว = ENDED ทุกสถานะ · `publicStatusHint()` → หน้าแอดมิน list + detail โชว์ "⚠ ผู้ชมเห็นเป็น 'เร็ว ๆ นี้' — เปิดขาย …" เมื่อป้ายที่ตั้งกับที่ผู้ชมเห็นไม่ตรงกัน · ส่ง `eventAt` จากการ์ด/หน้ารายละเอียด/หน้าคิว · หน้าแรก (ticker) + หน้ารายการ (ตัวนับหัวเรื่อง) ใช้ derived status

**ค้าง user (โค้ดทำแทนไม่ได้):** ต่ออายุ/สร้างแอป EasySlip ใหม่ที่ easyslip.com → ใส่คีย์ใหม่ลง `.env` → `node scripts/push-env-to-vercel.mjs EASYSLIP_API_KEY` → redeploy → โอนจริง 1 ครั้ง · ⚠️ รูปแบบ multipart ยัง**ไม่ได้พิสูจน์กับคีย์ที่ใช้ได้** (คีย์หมดอายุตอบ 403 ก่อนอ่าน body) — ถ้าหลังต่ออายุยังไม่ผ่าน ดูรหัสใน Vercel log `[PAYMENT][EASYSLIP]` (ตอนนี้มีให้ดูแล้ว) · `pnpm db:deploy` บนเครื่อง dev ให้ migration ใหม่ลง local (session นี้ถูก classifier บล็อก)

**หลักฐาน:** unit **54 ไฟล์ 669/669** (ใหม่: `slug` 7 · `easyslip-errors` 9 · `concert-display` +5) · tsc 0 · lint 0 error · `next build` local ผ่าน · ต้นเหตุยืนยันจากการยิง EasySlip จริง (`/me` + `/verify` 4 รูปแบบ) และ HTML/JSON ของ prod

## [Revision 38 — คำตอบทีม: ช่องทางติดต่อ PDPA = อีเมลแอดมิน · คืนเงิน 14 วันยืนยัน · ไม่ลบ log อัตโนมัติ · LICENSE สงวนลิขสิทธิ์] — 2026-08-27

**ที่มา:** คำถามค้างจาก rev 34 — user ตอบ 27 ส.ค.: (1) ติดต่อผ่านเมลแอดมินได้เลย (2) คืนเงิน 14 วัน ใช่ (3) ไม่ลบ log บอทอัตโนมัติ (4) สงวนสิทธิ์ไว้ก่อน อาจเปลี่ยนทีหลัง (5) โลโก้ใช้ text-mark ตั๋วแดงต่อ

**ทำ**
- `lib/legal-info.ts` `getSupportEmail()`: `SUPPORT_EMAIL` → fallback **`SEED_ADMIN_EMAIL`** (เพิ่มใน `lib/env-schema.ts` แบบ optional) → prod โชว์อีเมลแอดมินในหน้า /privacy ทันทีโดยไม่ต้องตั้ง env เพิ่ม · `REFUND_DAYS` 14 = ยืนยันแล้ว (ตัดหมายเหตุ "รอทีม")
- `LICENSE` (ใหม่): สงวนลิขสิทธิ์ ไทย+อังกฤษ ชื่อผู้จัดทำ 3 คน + มหาวิทยาลัย · `package.json` `"license": "UNLICENSED"` · README หัวข้อสัญญาอนุญาตชี้ไฟล์
- นโยบายความเป็นส่วนตัว §5 คงข้อความเดิม ("ยังไม่ลบอัตโนมัติ ขอลบได้") — ตรงกับการตัดสินใจ ไม่ต้องแก้

**หลักฐาน:** tsc 0 · lint 0 error · `next build` local ผ่าน · prod /privacy โชว์อีเมลแอดมิน (เช็คหลัง deploy)

**เพิ่ม (backup-neon รันแรก):** user ตั้ง secrets `NEON_DATABASE_URL_UNPOOLED` + `BACKUP_PASSPHRASE` แล้ว → รัน workflow มือครั้งแรกล้ม "pg_dump: aborting because of server version mismatch (server 17.11, pg_dump 16.15)" — runner Ubuntu 24.04 มี `/usr/bin/pg_dump` เป็น wrapper ที่เลือก 16 แม้ลง client 17 แล้ว → แก้ `.github/workflows/backup-neon.yml` เรียก `/usr/lib/postgresql/17/bin/pg_dump` ตรง ๆ (+ เช็คว่ามีไฟล์) แล้วรันซ้ำ

## [Revision 37 — CI รัน lint + next build · แก้ Medium 4 ข้อจาก user-test 26 ส.ค.] — 2026-08-27

**ที่มา:** deploy 34dxrztan (rev 35) ล้มที่ webpack ทั้งที่ tsc/vitest ผ่าน — CI ไม่เคยรัน `next build` · user-test 2026-08-26 เหลือ Medium 4 ข้อที่ยังไม่แก้

**ทำ**
- **CI** (`.github/workflows/ci.yml`): job verify เพิ่ม `pnpm lint` · job integration เพิ่ม service Redis + `REDIS_URL` และ step `pnpm exec next build` หลัง migrate (build ต้องมี DB เพราะ `app/sitemap.ts` prerender query concerts; env ที่ขาดบน CI แค่ boot-warn ไม่ throw)
- **#72 Bot log ตัวกรองไม่ทำงาน** — `<Link><Button/></Link>` (button ซ้อนใน a) กดแล้ว URL ไม่เปลี่ยน → เปลี่ยนเป็น `<Link>` ที่แต่งเหมือนปุ่มโดยตรง (`app/(admin)/admin/bot-log/page.tsx`)
- **#102 ยกเลิกคำสั่งซื้อไม่มี confirm/ไม่บอกผล** — `components/checkout-client.tsx` กดครั้งแรกโชว์กล่องยืนยัน (บอกที่นั่งที่จะหลุด) → ยืนยัน → ไป `/concerts/<slug>?cancelled=1` ซึ่งหน้ารายละเอียดโชว์แถบ "ยกเลิกคำสั่งซื้อแล้ว ที่นั่งถูกปล่อยคืน"; ยกเลิกไม่สำเร็จ = ข้อความ error แทนเด้งเงียบ (ยังไม่แก้: การ์ดออเดอร์ที่ยกเลิกแสดงที่นั่ง "—" เพราะ OrderItem ถูกลบตอนยกเลิกตามออกแบบ F3)
- **#40 คอนเสิร์ต "A" ฿∞ / กำลังขาย** — `lib/concert-display.ts` (pure): `deriveDisplayStatus()` เทียบ status ใน DB กับความจริง (ไม่มีโซน = **ยังไม่พร้อมขาย** · เลย `saleEndAt` = **ปิดการขาย** · ก่อน `saleStartAt` = เร็ว ๆ นี้) + `minZonePrice()` คืน null เมื่อไม่มีโซน → การ์ดโชว์ "รอประกาศราคา" · ใช้ทั้งการ์ด (`concert-card.tsx` + ส่ง `saleEndAt` ผ่าน `concert-browser`/`concerts/page.tsx`) · หน้ารายละเอียด (ป้าย + แผง CTA) · หน้าคิว (เปิดห้องรอเฉพาะขายอยู่จริง ไม่งั้นบอกเหตุผลตรง ๆ แทน "บัตรหมดแล้ว")
- **#35 ปุ่ม "ให้สิทธิ์" ครั้งแรกเงียบ** — `GrantMembershipForm` เรียก `router.refresh()` ซ้อนกับ `revalidatePath` ของ server action → refresh 2 รอบติดกันทำให้ผลลัพธ์หาย/ช่องว่าง → ตัด `router.refresh()` ออก (action revalidate ให้อยู่แล้ว)

**หลักฐาน:** unit `concert-display` 8 → vitest **52 ไฟล์ 647/647** · tsc 0 · lint 0 error · `next build` local ผ่าน · CI รอบแรกหลัง push ต้องเขียวทั้ง 2 job (มี build แล้ว)

## [Revision 36 — Ops: `/api/health` + backup Neon รายวัน (เข้ารหัส) + error log มี request id + ปิด /prototype บน prod + ยกเว้น /api จาก canonical-host] — 2026-08-27

**ที่มา:** gap map 2026-08-27 ขั้น 4 (ops) — user สั่งแบ่งงานให้ session นี้ผ่าน peer (`claude-workspace-83` ทำขั้น 3 = rev 35 คู่ขนาน)

**เพิ่ม**
- `GET /api/health` (`app/api/health/route.ts` + `lib/health.ts` pure): Postgres `SELECT 1` + Redis `PING` → 200/503 `{ ok, db, redis }` ไม่เปิดเผยรายละเอียด · timeout 3 วิ/ตัว (`withTimeout`) · rate-limit 30/นาที/IP — ถ้า Redis ล่มจน rate-limit ทำงานไม่ได้ ข้ามแล้วรายงาน `redis:"fail"` แทน · docs/17 §7.1 ขั้นผูก UptimeRobot/Better Stack (บัญชี user)
- `.github/workflows/backup-neon.yml`: pg_dump (client 17 จาก PGDG) `--format=custom --no-owner --no-privileges` → **gpg AES-256 symmetric** → artifact 30 วัน, รัน 03:30 ไทย + manual — **repo เป็น public จึงห้ามอัปโหลด dump เปล่า** · ต้องการ GitHub Secrets `NEON_DATABASE_URL_UNPOOLED` + `BACKUP_PASSPHRASE` (user ตั้ง) · runbook restore + ซ้อมลง Neon branch ใน docs/17 §7.3
- `instrumentation.ts` `onRequestError`: log JSON `kind:"server_error"` + digest + method/path + `x-vercel-id` (ไม่ log body/cookie) — ไม่ลง Sentry (ต้องเพิ่ม dependency/บัญชี → ถาม user ก่อน)
- `app/prototype/layout.tsx`: production → `notFound()` (ของจำลองเคยเปิดสาธารณะบน prod)
- `.env.example` บล็อก ops: `CRON_SECRET` `TRUSTED_PROXY_HOPS` `MAX_INFLIGHT_JOINS` `QUEUE_SYNC_AUDIT` `BOT_SCORE_THRESHOLD` `PER_PAYER_TICKET_LIMIT` `PAYMENTS_RECEIVER_CHECK` `PAYMENTS_FRESHNESS_CHECK` (โค้ดอ่านอยู่แล้วแต่ไม่เคยอยู่ในไฟล์)

**แก้**
- `lib/canonical-host.ts`: ยกเว้น `/api/*` จาก 308 — rev 33 เขียนว่า "matcher ตัด /api/* อยู่แล้ว" ซึ่ง**ผิด** (matcher ตัดแค่ `/api/auth`) → cron `/api/cron/sweep` ที่ Vercel เรียกผ่าน URL ของ deployment อาจโดน 308 (cron รอบ 07:00 ไทย 27 ส.ค. ยังไม่ถึงตอนแก้) · เทส +1
- `docs/SECURITY_TODO.md` #7 (ghost token: `admitNext` step 0 + 2.1 + prune ก่อนนับ) และ #8 (`HOLD_MULTI_SCRIPT` Lua all-or-nothing) → ✅ แก้แล้ว พร้อมชี้บรรทัด · `docs/THESIS_GUIDE.md` ถอด health endpoint ออกจากรายการ "ยังไม่ได้ทำ"

**หลักฐาน:** `tests/unit/health.test.ts` 8 เคส + canonical-host +1 → vitest ผ่านทั้งชุด · tsc 0 · lint 0 error · YAML parse ผ่าน · หลัง deploy: `curl -i /api/health` → 200 JSON, `/prototype/queue-runner` → 404, cron รอบถัดไปต้องได้ 200 (ดู runtime log 00:00Z)

**ค้าง (user):** ตั้ง GitHub Secrets 2 ตัว + กดรัน backup ครั้งแรก · ผูก uptime monitor · ซ้อม restore ลง Neon branch 1 ครั้ง

## [Revision 35 — ขั้น 3 "ฟีเจอร์ที่หาย": ลืมรหัสผ่าน · ขอลิงก์ยืนยันใหม่ · อีเมลใบเสร็จ/ตั๋วหลังจ่าย] — 2026-08-27

**ที่มา (gap map 2026-08-27 ขั้น 3):** ไม่มี "ลืมรหัสผ่าน" (บัญชีอีเมลที่ลืมรหัส = เข้าไม่ได้ตลอดไป) · ไม่มีปุ่มขอลิงก์ยืนยันใหม่ (ค้างจาก rev 30) · จ่ายเงินเสร็จไม่ได้รับอีเมลอะไรเลย (`lib/email.ts` มีแค่อีเมลยืนยันตัวตน)

**ทำ (ไม่แตะ schema — token รีเซ็ตใช้ตาราง `VerificationToken` เดิม แยกชนิดด้วย identifier `pwreset:<email>`)**
- **ลืมรหัสผ่าน**: `lib/password-reset.ts` (pure: prefix/อายุ 30 นาที/กติการหัส ≥ 8 เท่าตอนสมัคร/`evaluateResetToken`) · `app/actions/password.ts` — `requestPasswordResetAction` (rate-limit IP 5/15 นาที + อีเมล 3/ชม., ตอบข้อความกลางเสมอ ไม่บอกว่ามีบัญชี, บัญชี Google ล้วนไม่ออก token, ส่งไม่ออก = ลบ token ทิ้ง) · `peekResetToken` (หน้า /reset เช็คก่อนโชว์ฟอร์ม ไม่ consume) · `resetPasswordAction` (ใช้ครั้งเดียว: ลบทุก token รีเซ็ตของอีเมล + **ปลดล็อกบัญชีที่ถูกล็อกจากการเดารหัส** + ถือว่ายืนยันอีเมลแล้วถ้ายังไม่เคย → redirect `/login?reset=1`) · หน้า `app/(auth)/{forgot,reset}/` + `components/{forgot-password,reset-password}-form.tsx` · ลิงก์ "ลืมรหัสผ่าน?" ที่ช่องรหัสหน้า login · `verifyEmail()` ปฏิเสธ token รีเซ็ต (ใช้ข้ามชนิดไม่ได้)
- **ขอลิงก์ยืนยันใหม่**: `resendVerificationAction` (โหมด skip = บอกว่าไม่ต้องยืนยัน; ส่งเฉพาะบัญชีรหัสผ่านที่ยังไม่ verified, ลบ token เก่าก่อน) · หน้า `app/(auth)/verify/resend/` · ลิงก์จากหน้า /verify ที่ล้ม + จากกล่อง error หน้า login (เฉพาะโหมดบังคับยืนยัน) · `sendVerificationToken` ใน auth.ts เปลี่ยนเป็น export
- **อีเมลหลังจ่าย**: `lib/email-templates.ts` (pure, escape HTML ทุกค่าจากผู้ใช้: ใบเสร็จ + รีเซ็ตรหัส) · `lib/email.ts` เพิ่ม `sendPasswordResetEmail`/`sendOrderPaidEmail` · `lib/order-notify.ts` `notifyOrderPaid(orderId)` (ดึง order+tickets+ที่นั่ง+ผู้ถือ, ข้ามบัญชี `@local`, dev ไม่มี Resend = log) · `submitSlip` เรียกผ่าน `after()` ของ Next หลังตอบ client — ไม่เพิ่ม latency และล้มก็ไม่กระทบผลการจ่าย · **ตั้งใจไม่ใส่ QR ในอีเมล** (อีเมลส่งต่อกันได้ = แชร์บัตรได้) ใส่ลิงก์หน้าตั๋วของฉันแทน

**หลักฐาน:** unit `password-reset` 11 + `email-templates` 8 → vitest **51 ไฟล์ 639/639** (รวม health ของ rev 36) · tsc 0 · lint 0 error · Chrome (dev): /reset ด้วย token จริงที่ใส่ใน DB — รหัสไม่ตรง → error ใต้ช่อง ✓ ตรง → `/login?reset=1` ✓ DB: hash เปลี่ยน · `lockedUntil` null · `failedLoginCount` 0 · `emailVerified` set · token ถูกลบ ✓ · ล็อกอินด้วยรหัสใหม่ผ่าน ✓ · ลิงก์ที่ใช้แล้ว/token ยืนยันอีเมลเอามารีเซ็ต → "ลิงก์ใช้ไม่ได้แล้ว" ✓ · /forgot กับอีเมล example.com → ข้อความกลาง + Resend 422 ถูกจับ token ถูกลบ ✓ · `notifyOrderPaid` เรียกกับ id ที่ไม่มี = เงียบ ✓

**hotfix หลัง push แรก (deploy `34dxrztan` ล้ม):** `lib/password-reset.ts` มี `import "node:crypto"` แต่ถูก import จาก client component (ฟอร์ม) → webpack ของ `next build` ล้ม "Reading from node:crypto is not handled by plugins" (Turbopack dev ไม่ฟ้อง, tsc ไม่ฟ้อง) → แยก `generateResetToken` ไป `lib/password-reset-token.ts` (server) · **บทเรียน: รัน `next build` ก่อน push ทุกครั้ง แม้ tsc/vitest ผ่าน** — lib ที่ client import ห้ามมี `node:*`/prisma/env

**ข้อจำกัดบน prod ตอนนี้:** `EMAIL_FROM` ยังเป็น `@resend.dev` → อีเมลรีเซ็ต/ใบเสร็จส่งถึงได้เฉพาะอีเมลเจ้าของบัญชี Resend (เหมือนอีเมลยืนยัน) จนกว่าจะ verify โดเมนจริง — ผู้ใช้อื่นเห็นข้อความกลางแต่ไม่ได้รับเมล (log `🔑 … ไม่สำเร็จ`); ใบเสร็จไม่กระทบตั๋ว (ดูในเว็บได้)

## [Revision 34 — ขั้น 2 "ความน่าเชื่อถือ": นโยบาย PDPA + ยินยอมตอนสมัคร · เงื่อนไขบัตร · หน้า 404/500/loading · favicon/OG · robots/sitemap] — 2026-08-27

**ที่มา (gap map 2026-08-27 ขั้น 2 — user สั่ง "ถ้าคิดว่าดีหรือจำเป็นทำได้เลย ไม่แน่ใจให้ถาม"):** ระบบเก็บ fingerprint + พฤติกรรมเมาส์/คีย์ + รูปสลิป (เลขบัญชี/ชื่อผู้โอน) + ชื่อผู้ถือบัตร แต่ไม่มีหน้านโยบาย/ข้อกำหนด/การขอความยินยอมเลย (พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล 2562) · ไม่มีหน้า 404/500 ของตัวเอง (หน้าขาวภาษาอังกฤษของ Next) · ไม่มี favicon/รูปตอนแชร์ลิงก์ · ไม่มี robots/sitemap · เงื่อนไขคืนบัตรมีแต่ฝั่งแอดมิน ลูกค้าไม่เคยเห็นก่อนจ่าย

**ทำ (ไม่แตะ schema/migration — เวลาที่ยอมรับ = `User.createdAt` เพราะสมัครไม่ผ่านถ้าไม่ติ๊ก)**
- **กฎหมาย/PDPA**: `app/(public)/{privacy,terms,ticket-terms}/page.tsx` + โครง `components/legal-page.tsx` (หัวเวที + สารบัญ + ตาราง) · เนื้อหาเขียนจากสิ่งที่โค้ดทำจริง (schema `BotEvent/BehaviorSession/Payment/Ticket`, ผู้ประมวลผล Vercel/Neon/Upstash/Cloudflare/EasySlip/Resend/Google, retention เขียนตามจริงว่ายังไม่ลบอัตโนมัติ) · ตัวเลขดึงจาก env ผ่าน `lib/legal-info.ts` (ล็อกที่นั่ง 5 นาที / คืนบัตรก่อนงาน 24 ชม. / อายุบัญชีผู้ถือ) · `REFUND_DAYS=14` + `DATA_CONTROLLER_NAME` เป็นค่าตั้งต้นรอทีมยืนยัน · env ใหม่ `SUPPORT_EMAIL` (optional — ไม่ตั้ง = หน้านโยบายชี้ไปแชตช่วยเหลือ ไม่ใส่อีเมลปลอม)
- **ความยินยอม**: checkbox ใน `components/register-form.tsx` (required) + **server ตรวจซ้ำ** ใน `registerUser` ก่อนแตะ DB/rate-limit (`lib/consent.ts` pure: `hasAcceptedTerms` รับ on/true/1/yes เท่านั้น) · ใต้ปุ่ม Google แจ้งว่าการกดถือเป็นการยอมรับ (OAuth ไม่มีฟอร์มให้ติ๊ก) · หน้า queue แจ้งเก็บ fingerprint/พฤติกรรม ณ จุดที่เริ่มเก็บ · checkout มีบรรทัดเงื่อนไขบัตร + ลิงก์ก่อนปุ่มยืนยัน · ฟุตเตอร์เพิ่มคอลัมน์ "นโยบาย"
- **หน้า error**: `app/not-found.tsx` (LED 404 + ปุ่มดูคอนเสิร์ต/หน้าแรก — ใช้กับทุก `notFound()` ในระบบ) · `app/error.tsx` (client boundary + `digest` เป็นรหัสอ้างอิง + ปุ่มลองใหม่) · `app/global-error.tsx` (สไตล์ inline ล้วน เพราะ layout อาจเป็นตัวพัง; `<a>` ตั้งใจให้โหลดหน้าใหม่ทั้งหน้า) · `loading.tsx` skeleton ใน concerts / [slug] / checkout
- **ไอคอน + แชร์ลิงก์**: `app/{icon,apple-icon,opengraph-image}.tsx` วาดจากโค้ดด้วย `next/og` (`app/brand-mark.tsx` = โลโก้ตั๋วเดียวกับหัวเว็บ ไม่มีไฟล์ binary) · `metadataBase`(NEXTAUTH_URL) / `openGraph` / `twitter` ใน layout · `generateMetadata` ต่อคอนเสิร์ต (ชื่อ + สถานที่/วัน, โปสเตอร์เป็น og:image) · `app/robots.ts` (กัน index /admin /api /account /checkout /verify /prototype /concerts/*/queue|seats) + `app/sitemap.ts` (revalidate 1 ชม.)

**กับดักที่เจอ**: Satori ไม่รับสีทึบใน `background` shorthand ("Invalid background image: #171010") → แยก `backgroundColor`/`backgroundImage` · ข้อความในรูป OG เป็นอังกฤษเพราะฟอนต์ตั้งต้นของ Satori ไม่มีอักษรไทย (โหลดฟอนต์ไทยตอน build = พึ่งเน็ตภายนอก เสี่ยง build ล้ม) ชื่อไทยอยู่ใน og:title/description · **dev server ค้าง**: เขียนไฟล์ใหม่หลายไฟล์พร้อมกันแล้ว `icon.tsx` import `brand-mark.tsx` ที่ยังไม่มี → static worker ของ `next dev --turbo` ตาย 2 ครั้ง → `/concerts/[slug]` 500 "Jest worker … exceeding retry limit" ถาวรจนรีสตาร์ท (prod build ไม่กระทบ)

**หลักฐาน**: unit `tests/unit/consent.test.ts` 6 เคส → vitest **48 ไฟล์ 614/614** · tsc 0 · lint 0 error · `next build` ผ่าน (26/26 static — icon/apple-icon/opengraph-image/robots/sitemap prerender ได้) · dev: /privacy /terms /ticket-terms 200 · 404 ภาษาไทย · /icon 64px + /apple-icon 180px + /opengraph-image 1200×630 PNG · robots/sitemap ถูกต้อง · /register มี checkbox + หมายเหตุ Google · og:title/description ต่อคอนเสิร์ต · เทสสมัครผ่านเบราว์เซอร์: ดูบรรทัดถัดไป
- เบราว์เซอร์ (Chrome, dev): ถอด `required` ของ checkbox ด้วย JS แล้วส่งฟอร์ม → server ตอบ "กรุณายอมรับข้อกำหนด…" ใต้ checkbox (aria-invalid) ไม่สร้างบัญชี ✓ · ติ๊กแล้วส่ง → ผ่านด่านยินยอม สร้าง user แล้วไปต่อขั้นส่งอีเมล (local: Resend sandbox 422 → rev 30 ถอนบัญชีตามออกแบบ — ไม่เกี่ยวกับ rev นี้) ✓

**ค้าง / ถาม user**: `SUPPORT_EMAIL` ใช้อีเมลไหน · `REFUND_DAYS` 14 วันใช่ไหม · จะให้ cron ลบ `BotEvent`/`BehaviorSession` เก่าอัตโนมัติไหม (นโยบายเขียนตามจริงว่ายังไม่ลบ — ล้างแล้วหลักฐานสถิติในเล่มหาย) · มีโลโก้จริงแทน text-mark ไหม

## [Revision 33 — เปิดจาก URL ของ deployment แล้ว Google sign-in ล้มเป็น "Server error": redirect ทุกโฮสต์ *.vercel.app ไปโฮสต์หลัก] — 2026-08-27

**ที่มา:** หลัง `vercel redeploy` (rev 32) user เปิดเว็บจากลิงก์ที่ CLI พิมพ์ (`concert-antibot-<hash>-…vercel.app`) แล้วกด Google → หน้า Auth.js "Server error — There is a problem with the server configuration" 3 ครั้งติด (02:20 น.)
Vercel runtime log: `GET /api/auth/callback/google` → `[auth][error] InvalidCheck: pkceCodeVerifier value could not be parsed`
**กลไก:** cookie PKCE/CSRF ของ Auth.js ถูกตั้งบนโฮสต์ที่เปิด (URL ของ deployment) แต่ Google เด้งกลับมาที่ `NEXTAUTH_URL` (`concert-antibot.vercel.app`) ซึ่งไม่มี cookie นั้น → Auth.js ถือเป็น Configuration error · Turnstile ก็ผูก hostname กับโฮสต์หลักเช่นกัน (เข้าคิวจากโฮสต์อื่นถูกปฏิเสธ) · ยืนยันด้วยเบราว์เซอร์: เปิดโฮสต์ deployment แล้วกด Google → `redirect_uri` ใน URL ของ Google ชี้โฮสต์หลัก

**แก้**
- `lib/canonical-host.ts` (ใหม่, pure, Edge-safe): `canonicalHostOf(NEXTAUTH_URL)` + `canonicalRedirect()` — production ที่ Host เป็น `*.vercel.app` และไม่ใช่โฮสต์หลัก → URL โฮสต์หลัก path+query เดิม · preview/dev/โดเมนอื่น → ไม่แตะ (กัน redirect วน)
- `middleware.ts`: ขั้น 0 ก่อนตรวจสิทธิ์ → `308` ไปโฮสต์หลัก (matcher ตัด `/api/*` อยู่แล้ว — cron ของ Vercel ที่เรียกผ่าน URL ของ deployment ไม่โดน)
- ไม่แตะโค้ด auth — ปัญหาไม่ได้อยู่ที่ rev 32 (EMAIL_VERIFICATION) แม้จะโผล่พร้อมกัน

**หลักฐาน:** `tests/unit/canonical-host.test.ts` 7 เคส → vitest 47 ไฟล์ 608/608 (working tree รวมสาย seed-policy ที่ยังไม่ commit) · tsc 0 · lint 0 error · หลัง deploy: `curl -I https://concert-antibot-<hash>-…vercel.app/login` → 308 Location โฮสต์หลัก

**บทเรียน:** ใช้ `https://concert-antibot.vercel.app` เท่านั้นเวลาเดโม/ส่งลิงก์ — ลิงก์ที่ `vercel redeploy`/`vercel --prod` พิมพ์ออกมาเป็น URL ของ deployment ตอนนี้ redirect ให้อัตโนมัติแล้ว

## [Revision 32 — สวิตช์ `EMAIL_VERIFICATION=skip`: ส่งงาน/เดโมโดยไม่ต้องมีโดเมนส่งเมล (โค้ดยืนยันอีเมลยังอยู่ครบ แค่ไม่ถูกเรียก)] — 2026-08-27

> rev 31 = seed guard บัญชี admin@local บน deploy ที่โฮสต์ (`lib/seed-policy.ts`, `SEED_ADMIN_EMAIL/PASSWORD`) — ทำคู่ขนานในอีก session ตอนเขียน rev นี้ยังไม่ commit

**ที่มา:** หลัง rev 30 สมัครด้วยอีเมลบน prod ส่งเมลยืนยันได้เฉพาะอีเมลเจ้าของบัญชี Resend (`EMAIL_FROM` เป็น `@resend.dev`) ทางแก้จริงคือโดเมนของตัวเอง (~฿380/ปี, เปิดหน้า Cloudflare Registrar ให้ดูราคาแล้ว) แต่ user ตัดสินใจ "แค่ส่งโปรเจกต์ ไม่ใช้ยาว" → ขอโหมดไม่ต้องยืนยัน **โดยเก็บโค้ดเดิมไว้ทั้งหมด แค่ปิดด้วย env**

**แก้**
- `lib/env-schema.ts` `EMAIL_VERIFICATION: "required" | "skip"` (default `required`) · `lib/env.ts` `isEmailVerificationRequired` + boot-warn `[AUTH]` เมื่อ skip บน production; warn `[EMAIL]` ไม่มี key จะเงียบเมื่อ skip (ไม่ต้องส่งเมลอยู่แล้ว)
- `app/actions/auth.ts` โหมด skip: สร้าง user พร้อม `emailVerified = now` ไม่ส่งลิงก์ → redirect `/login?registered=verified` (หน้า login บอก "เข้าสู่ระบบได้เลย")
- `lib/credentials-auth.ts` `requireVerifiedEmail?: boolean` (default `true` — ด่าน F1 เปิดเสมอ) รับเป็นพารามิเตอร์แทน import env เพื่อให้เทสเดิมไม่ต้องแก้ · `lib/auth.ts` ส่งค่าจาก env
- `lib/email-signup-gate.ts` + `app/(auth)/register/page.tsx`: skip = เปิดรับสมัครเสมอ (ไม่ต้องมี Resend) · `.env.example` อธิบายค่า

**ความเสี่ยงที่รับไว้ (บันทึกกันลืม):** skip เปิดช่อง pre-registration takeover ที่ F1 กันไว้ — ใครก็สมัครด้วยอีเมลของคนอื่น + รหัสตัวเองได้ และเจ้าของอีเมลตัวจริงจะ Google sign-in ไม่ได้ (OAuthAccountNotLinked) — ยอมรับได้เฉพาะสภาพแวดล้อมสอบ/เดโมที่ผู้ใช้เป็นคนรู้จักไม่กี่คน · **ห้ามใช้เมื่อเปิดขายจริง** (boot-warn เตือนทุกครั้งที่ boot)

**หลักฐาน:** unit `email-signup-gate` +2 เคส · `tests/unit/credentials-auth-verify-flag.test.ts` 4 เคส (ไม่ส่ง flag = null / true = null / false = ผ่าน / รหัสผิดยัง null) → vitest ผ่านทั้งชุด (working tree ขณะนั้นรวมสาย seed-policy ของ rev 31 = 46 ไฟล์ 601 เคส) · tsc 0 · lint 0 error

**วิธีเปิดบน prod (ค่าไม่ใช่ secret):** `npx vercel env add EMAIL_VERIFICATION production --value skip --yes` → redeploy · **กลับเป็นปกติ:** `npx vercel env rm EMAIL_VERIFICATION production --yes` → redeploy (default = required)

## [Revision 31 — seed บน Vercel เลิกสร้างบัญชีเดโมรหัสสาธารณะ + ล็อกของเดิม; แอดมิน prod มาจาก env] — 2026-08-27

**ที่มา (gap map 2026-08-27 — Critical ข้อเดียวของรายงาน):** `prisma/seed.ts` upsert `admin@local`/`Admin123!` + `user@local`/`Password123!` ทุกครั้งที่รัน และ `vercel.json` buildCommand รัน seed **ทุก deploy** (production และ preview ซึ่งใช้ Neon ตัวเดียวกัน) + repo เป็น PUBLIC → ใครอ่านโค้ดก็ล็อกอินเป็นแอดมิน prod ได้ (ลบคอนเสิร์ต/คืนเงิน/ดูสลิปลูกค้า) — เปิดมาตั้งแต่ deploy แรก (14 ก.ค.)

**แก้**
- `lib/seed-policy.ts` (ใหม่, pure) — `isHostedDeploy()` (VERCEL/VERCEL_ENV ตั้ง หรือ NODE_ENV=production) + `resolveSeedAccountPolicy()`: เครื่อง dev = เหมือนเดิม (เทสเบราว์เซอร์/สคริปต์ยังใช้ user@local) · โฮสต์ = ไม่สร้างบัญชีเดโม, **ล็อก** admin@local/user@local ที่เคย seed ไว้ (`passwordHash = null` + role USER — ไม่ลบแถวกัน FK; `lib/admin-guard.ts` เช็ค role จาก DB ทุกคำขอ การถอด ADMIN จึงมีผลทันทีแม้ JWT เก่ายังไม่หมดอายุ), แอดมินจริงมาจาก `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` (≥ 12 ตัว) เท่านั้น · ตั้งครึ่งเดียว/รหัสสั้น = ไม่สร้างแอดมิน + เตือน แต่ยังล็อกเดโม (ไม่เปิดช่องกลับ) · ไม่ตั้งเลย = build ผ่านแต่ไม่มีแอดมิน + `⚠️ [SEED]` ใน build log (ตั้งใจไม่ทำให้ build ล้ม — build ล้มไม่ได้ปิดช่องบน deploy เดิม และบล็อกเพื่อนร่วมทีม deploy)
- `prisma/seed.ts` — ใช้นโยบายข้างบน · ไม่พิมพ์รหัสผ่านลง log · ล็อกแบบ idempotent (ล็อกแล้วข้ามเงียบ) · เลือก `SEED_ADMIN_EMAIL=admin@local` ได้ (ได้รหัสใหม่จาก env ไม่ถูกล็อก) · บัญชีแอดมินจาก env ที่ยังไม่ verified → verified ให้ (ไม่งั้นล็อกอินไม่ได้) · dev upsert เปลี่ยนจาก `update: {}` เป็นรีเซ็ตรหัส+role → `pnpm db:seed` คืนบัญชีเดโมให้ใช้ได้เสมอ
- `.env.example` + `docs/17` §2 — env 2 ตัวใหม่ + ลำดับ: ตั้ง env บน Vercel **ก่อน** push จะได้ไม่มีช่วงที่ prod ไม่มีแอดมิน

**หลักฐาน:** unit `tests/unit/seed-policy.test.ts` 11/11 (preview = โฮสต์ · รหัสสั้นไม่เปิดช่องกลับ · warning ไม่มีรหัสปน) · ทั้งชุดหลังรวม rev 32–33 **47 ไฟล์ 608/608** · tsc 0 · lint 0 error (warn เดิม 1 ที่ prototype) · **จำลองโหมดโฮสต์กับ Postgres local ผ่าน**: `VERCEL=1 pnpm db:seed` → ⚠️ เตือน + 🔒 admin@local/user@local (role USER, hash null) · ใส่ `SEED_ADMIN_*` → `✅ Admin (จาก env)` role ADMIN verified, รหัสไม่โผล่ใน log · `pnpm db:seed` ธรรมดา → บัญชีเดโมกลับมาใช้ได้

**ค้าง:** user ตั้ง env 2 ตัวบน Vercel (`node scripts/push-env-to-vercel.mjs SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD`) → push → เช็ค build log มี `🔒 ล็อกบัญชีเดโม admin@local` + `✅ Admin (จาก env)` → ล็อกอินแอดมินใหม่ได้ · session เก่าของ admin@local เข้า /admin ไม่ได้แล้ว (guard เช็ค DB) แต่ยังเป็น user ธรรมดาจน JWT หมดอายุ — อยากตัดทิ้งหมดให้ rotate `NEXTAUTH_SECRET` · สคริปต์ท้องถิ่นที่ล็อกอิน admin@local (`scripts/test-seatmap-ui.ts`, `shoot-design.ts`, `demo-seatmap-walkthrough.ts`) ใช้กับเครื่อง dev เท่านั้น ไม่กระทบ

## [Revision 30 — production ไม่มี Resend: ปิดรับสมัครด้วยอีเมลชัด ๆ + ไม่พิมพ์ token ลง log + ส่งเมลไม่ออก = ถอนบัญชี] — 2026-08-26

**ที่มา (readiness audit 2026-08-26 ค่ำ):** prod ยังไม่ตั้ง `RESEND_API_KEY` → `app/actions/auth.ts` เข้าโหมด dev พิมพ์ลิงก์ยืนยัน (มี token) ลง console = Vercel runtime log — ผู้สมัครไม่ได้รับอะไร ยืนยันไม่ได้ ล็อกอินไม่ได้ แต่อีเมลถูกจองไว้ ("อีเมลนี้ถูกใช้แล้ว") และระบบไม่มีปุ่มขอลิงก์ใหม่ = บัญชีตายด้าน + token รั่วลง log

**แก้**
- `lib/email-signup-gate.ts` (ใหม่, pure) — `isEmailSignupOpen({ isProduction, isEmailEnabled })`: production ที่ไม่มี provider = ปิดรับสมัครด้วยอีเมล (fail-closed แบบเดียวกับ payment/cron) · dev/test ยังสมัครได้ ลิงก์โผล่ใน console ตามเดิม
- `app/actions/auth.ts` — `registerUser` ปฏิเสธก่อนแตะ DB ด้วยข้อความชี้ทาง Google · `sendVerificationToken` คืน `{ ok }`; บน production ไม่พิมพ์ token ลง log · **ส่งไม่ออก (Resend ปฏิเสธ/เน็ตล่ม) → ลบ user + token ที่เพิ่งสร้าง แล้วคืน "ส่งอีเมลยืนยันไม่สำเร็จ กรุณาลองใหม่"** (เดิมตั้งใจไม่ rollback โดยหวังให้ขอลิงก์ใหม่ทีหลัง — แต่ฟีเจอร์นั้นไม่มี)
- `app/(auth)/register/page.tsx` — ปิดอยู่ → ซ่อนฟอร์ม โชว์กล่องบอกเหตุ + ปุ่มสมัครด้วย Google
- `lib/env.ts` — boot-warn `[EMAIL]` เมื่อ production ไม่มี `RESEND_API_KEY` · และเมื่อตั้งแล้วแต่ `EMAIL_FROM` เป็น `noreply@localhost` (Resend ปฏิเสธทุกฉบับ) หรือ `@resend.dev` (sender ทดสอบ — ส่งได้เฉพาะอีเมลเจ้าของบัญชี Resend)
- `scripts/push-env-to-vercel.mjs` (ใหม่) — ก๊อปค่าจาก `.env` ขึ้น Vercel โดยไม่พิมพ์ค่าออกจอ/ลง transcript (`node scripts/push-env-to-vercel.mjs PROMPTPAY_ID EASYSLIP_API_KEY …`) — เครื่องมือปิด blocker env จ่ายเงิน/อีเมลบน prod

**หลักฐาน:** unit `tests/unit/email-signup-gate.test.ts` 4 เคส → vitest **44 ไฟล์ 584/584** · tsc 0 · lint 0 error

**ค้าง:** user ใส่ env จริงบน prod (`PROMPTPAY_ID` · `EASYSLIP_API_KEY` · `PAYMENTS_RECEIVER_NAME` · `RESEND_API_KEY` · `EMAIL_FROM`) แล้ว redeploy · โดเมนผู้ส่งจริงสำหรับ Resend (ตอนนี้ `.env` ใช้ `@resend.dev` = ส่งได้แค่อีเมลเจ้าของบัญชี พอสำหรับเดโม) · ปุ่ม "ขอลิงก์ยืนยันใหม่" ยังไม่มี

## [Revision 29 — ฟอร์มสร้างคอนเสิร์ต: datetime-local ถูกอ่านเป็น UTC → เวลาเลื่อน +7 ชม. (จาก user-test)] — 2026-08-26

### Trigger
user-test ทุกเส้นทางบน prod ผ่าน Chrome (รายงาน `user-test-runs/2026-08-26-prod-chrome/report.html`): สร้างคอนเสิร์ต 20 ธ.ค. 19:00
→ แอดมินและลูกค้าเห็น "21 ธันวาคม 2569 เวลา 02:00", ช่วงขาย 16:00 → 23:00

### Root cause
`app/actions/concert.ts` รับสตริง `YYYY-MM-DDTHH:mm` จาก `<input type="datetime-local">` แล้ว `new Date()` ตรง ๆ — บน Vercel (TZ=UTC)
ตีความเป็น UTC · ฟอร์มรอบกดบัตรไม่โดนเพราะ `admin-sale-rounds.tsx` แปลงเป็น ISO ฝั่ง client ก่อนส่ง

### สิ่งที่ทำ
- `lib/local-datetime.ts` (ใหม่, pure): `parseThaiDateTimeLocal()` — ไม่มี TZ → เติม `+07:00`; มี Z/offset → ใช้ตามนั้น; พัง/ว่าง → null
- `app/actions/concert.ts` ใช้ helper + ฟ้อง "วันเวลาไม่ถูกต้อง" / "เวลาปิดขายต้องอยู่หลังเวลาเริ่มขาย" (เดิมสร้างได้แม้ปิดก่อนเริ่ม)
- ไม่แก้ข้อมูลเก่า: คอนเสิร์ต #46 (ทดสอบ, ปิดขาย) ยังเก็บเวลาเลื่อนอยู่
- **`prisma/seed.ts` (พ่วงใน rev นี้ เพราะ deploy `bg3f1yhg1` ล้ม)**: seed รันทุก deploy บน Vercel และ `concert.deleteMany` คอนเสิร์ตเดโม
  → พอมีออเดอร์จาก user-test อ้างถึง BTS ก็ชน FK `orders_concertId_fkey` → build ล้มทั้ง deploy (ไม่ใช่โค้ดที่แก้) →
  เปลี่ยนเป็นสร้างเฉพาะเมื่อยังไม่มี slug (idempotent, ไม่ล้างเดโมทุก deploy อีก) + เลิกพิมพ์รหัสผ่าน fixture ลง build log ·
  ยังคงสร้าง `admin@local`/`user@local` บน production (รอ user ตัดสินใจ — ดู SECURITY_TODO/HANDOFF)
- **ยังไม่แก้** บั๊กอื่นจาก user-test: ตัวกรอง bot-log, ยกเลิกออเดอร์ไม่มี confirm, คอนเสิร์ต 0 โซน ฿∞/กำลังขาย, ปุ่มให้สิทธิ์สมาชิก, validation ภาษาอังกฤษ

### หลักฐาน
`tests/unit/local-datetime.test.ts` 6 เทส (รวมข้ามวัน + passthrough Z/offset) → unit 43 ไฟล์ 580/580 · typecheck 0

---

## [Revision 28 — Turnstile บน prod เป็น test key มา 43 วัน: ปฏิเสธชัดเจน + ห้องรอมี feedback + เก็บ error code] — 2026-08-26

### Trigger
เช็คมือหลัง deploy rev 27 (SECURITY_TODO #2): user เข้าคิว BTS บน prod → กล่อง Turnstile ขึ้น "สำเร็จ!" พร้อมแถบแดง
"สำหรับการทดสอบเท่านั้น" แล้วค้าง ไม่ไปต่อ (screenshot 13:44)

### Root cause (2 ชั้น)
- **config**: Vercel Production ตั้ง `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` เป็น **test key ของ Cloudflare** ตั้งแต่ตั้ง env
  (43 วัน) → siteverify ผ่านเสมอ = CAPTCHA ปิดอยู่เงียบ ๆ ตลอดมา (ที่เข้าคิวบน prod ได้ทุกครั้งก็เพราะแบบนี้)
  · `lib/turnstile.ts` มองว่า "dev mode" เฉพาะตอน **ไม่ได้ตั้ง** secret → prod ที่ตั้ง test secret ไว้จึงเข้าเช็ค action/hostname
  ของ rev 27 กับค่าหลอกของ test key (`hostname=example.com`, `action=""`) = `action-mismatch` ทุกครั้ง → 428 ซ้ำ
- **UX**: `waiting-room.tsx` รับ 428 ซ้ำแล้ว `setNeedChallenge(true)` ซ้ำ = ไม่ re-render → กล่องค้าง "สำเร็จ!" ไม่มี feedback ไม่รีเซ็ต
  (จะเกิดกับ false positive ทุกแบบ ไม่ใช่แค่เคสคีย์ผิด)

### สิ่งที่ทำ
- user สลับ env prod เป็นคีย์จริง (ชุดเดียวกับ `.env` dev) ผ่าน `vercel env rm/add --value "$(node --env-file=.env -e …)"` — ค่าไม่ผ่านแชท
- `lib/turnstile.ts`: secret == test secret → **development = dev mode** (ข้ามเช็ค 2 ข้อเหมือนไม่ตั้ง — เดิมโดน action-mismatch ทั้งที่เป็น test key)
  / **production = ปฏิเสธทันที `test-key-on-production` โดยไม่ยิง Cloudflare** (fail-closed สอดคล้อง `not-configured`)
- `lib/env.ts`: boot-warn 🚨 เมื่อ production ตั้ง secret = test secret หรือ site key ขึ้นต้น `1x0000`/`2x0000`/`3x0000`
- `lib/antibot.ts` + `lib/antibot-purchase.ts`: เก็บ `turnstileErrors` ลง `signals` (เฉพาะตอน fail) → เห็นสาเหตุใน `bot_events`
  (rev 27 เขียนว่ามีแต่ไม่ได้เก็บจริง — แก้เอกสาร SECURITY_TODO #2 ด้วย)
- `components/waiting-room.tsx`: 428 หลังส่ง token → "ยืนยันไม่ผ่าน กรุณาทำเครื่องหมายใหม่อีกครั้ง" (`role=alert`) + เปลี่ยน `key`
  ให้ widget mount ใหม่ (token ใช้ได้ครั้งเดียว) · `turnstile-widget.tsx`: `turnstile.remove()` ตอน unmount (แยก effect ไม่ผูก deps เดิม
  กัน onVerify เปลี่ยน identity แล้วถอด widget กลางคัน)
- **ไม่แตะ**: กติกาคะแนน/threshold · schema (`signals` เป็น Json) · ไม่มี migration/env ใหม่

### หลักฐาน
- unit: `turnstile.test.ts` +2 (prod ปฏิเสธโดยไม่ยิง fetch / dev ผ่าน) · `antibot.test.ts` +2 · `antibot-purchase.test.ts` +1 assertion
  → รวม **574/574** · typecheck 0 · eslint 0 (ไฟล์ที่แตะ)
- เช็คมือบน prod หลัง deploy (14:55): **ผ่าน** — เข้า `/concerts/bts-bangkok-2026/queue` → Turnstile โหลดจาก challenges.cloudflare.com 200
  ไม่มี error 110200 → `POST /api/queue/join` 200 → `ผ่านคิวแล้ว` เด้งไปหน้าเลือกที่นั่ง (Managed mode ตรวจแบบไม่ต้องติ๊กสำหรับเบราว์เซอร์ปกติ)
- **รอบแรกหลังสลับคีย์ยังพัง (14:42)**: widget ขึ้น "ไม่สามารถเชื่อมต่อกับเว็บไซต์ได้" — console: `TurnstileError 110200` = โดเมนไม่อยู่ใน
  Hostname management ของ widget · เปิด Cloudflare dashboard ของ user แล้วพบว่า **บัญชี user ไม่มี widget เลย** — คีย์ `0x4AA…` เดิมใน `.env`
  เป็นของบัญชี Cloudflare อื่น (เพิ่มโดเมนให้ไม่ได้) → **สร้าง widget ใหม่ในบัญชี user** ชื่อ `concert-antibot` (hostnames
  `concert-antibot.vercel.app` + `localhost`, Managed) → user ใส่คู่ใหม่ลง `.env` แล้ว rm/add env prod อีกรอบ + redeploy (`n0qys5loc`) → ผ่าน

### บทเรียน
- "เทสเขียว + เข้าคิวได้" ≠ CAPTCHA ทำงาน — test key ผ่านเสมอ; สัญญาณเดียวคือป้าย "for testing only" บน widget → ตอนนี้มี boot-warn + fail-closed แทนการพึ่งสายตา
- config บน prod ต้องมี guard ในโค้ด (fail-closed + boot-warn) ไม่ใช่พึ่ง checklist ใน docs/17 อย่างเดียว
- ทุก state ที่ผู้ใช้ "ทำสำเร็จแล้วแต่ server ไม่รับ" ต้องมี feedback — silent retry = ค้างเงียบ

---

## [Revision 27 — ปิด SECURITY_TODO #2–#4: Turnstile ผูก action+โดเมน · คีย์ผู้จ่าย "ธนาคาร:ชื่อ" · เทียบยอดเป็นสตางค์] — 2026-08-26

### Trigger
งานค้างข้อ 4.3 ใน HANDOFF — รายการระดับ Medium ที่เหลือใน `docs/SECURITY_TODO.md` (ข้อ 1 ปิดไป rev 22)
ทำต่อจาก rev 26 บน branch `fix/security-todo-2-4` (ต่อจาก `fix/queue-soldout-exit` ยังไม่ merge)

### การตัดสินใจ (ถูกถามว่า "อันไหนปลอดภัยและใช้ได้จริง")
- **#2 Turnstile** — ทำทั้ง `action` และ `hostname` แต่ **ไม่เพิ่ม env var** ตามแนวทางเดิม: เทียบ `hostname` ที่ Cloudflare
  ยืนยันกับ `Host` header ของคำขอนี้แทน → prod ไม่ต้องตั้งอะไร, localhost/Vercel ใช้โค้ดเดียวกัน, ไม่มีทาง misconfig
  แล้วคนจริงเข้าไม่ได้ทั้งเว็บ · `action` เป็น prop บังคับของ `TurnstileWidget` (TS บังคับ — widget ที่ลืม action
  จะถูก server ปฏิเสธ) · dev mode (test key) ข้ามเช็ค 2 ข้อ (test key คืนค่าตายตัวของ Cloudflare)
- **#3 payerKey** — เลือก **A "ธนาคาร:ชื่อ"** ไม่เอา B "ไม่มีเลขบัญชี = ข้าม cap": B ให้ขบวนการบอท "เลือก" ช่องทางจ่าย
  ที่สลิปไม่โชว์เลขบัญชีแล้วหลุด cap ทั้งขบวน (กู้คืนไม่ได้) ส่วน A ชนกันแล้วอย่างมากคืนเงิน (กู้คืนได้ + มี `REFUND_REQUIRED`)
  · แนวทางเดิมใน TODO (ใช้ transRef) ใช้ไม่ได้ — unique ต่อธุรกรรม = cap ไม่นับสะสม
- **#4 สตางค์** — เทียบ `Math.round(x*100)` ทั้งสองฝั่ง, tolerance ยัง 0, ยอดอ่านไม่ได้ = ไม่ตรง (fail-closed)

### ของที่แก้
- `lib/turnstile.ts` — `verifyTurnstile(token, ip, { action, hostname })` + `normalizeHostname()` (ตัด port/lower/IPv6)
  · ไม่ตรง = `success:false` + `errorCodes: ["action-mismatch" | "hostname-mismatch"]` → ผู้เรียกนับเป็น fail (+55) path เดิม
- `lib/turnstile-actions.ts` (ใหม่, pure ใช้ได้ทั้ง client/server) — `queue_join` / `purchase`
- `components/turnstile-widget.tsx` — prop `action` บังคับ → ส่งเข้า `turnstile.render` · ผู้ใช้ 3 จุด:
  `waiting-room.tsx` = `queue_join`, `seat-map-svg.tsx` + `seat-map.tsx` = `purchase`
- `lib/antibot.ts` / `lib/antibot-purchase.ts` — ส่ง action ของด่านตัวเอง + `headers.get("host")`
- `lib/payer-key.ts` — `senderBank` → fallback `name:<bank>:<ชื่อ>`; ไม่มีธนาคาร → `name:<ชื่อ>` เดิม; มีเลขบัญชี → `acct:` เดิม
- `lib/easyslip.ts` — map `sender.bank.id` (fallback `short`/`name`) → `senderBank` · `booking.ts` ส่งต่อให้ `computePayerKey`
- `lib/money.ts` (ใหม่) — `toSatang` / `sameAmount` · `booking.ts submitSlip` ใช้ `sameAmount(verify.amount, order.totalAmount.toString())`
- ไม่แตะ: schema/migration · env · `order-finalize.ts` · กติกาคะแนน anti-bot

### หลักฐาน
- unit **570/570 (42 ไฟล์)** — ใหม่: `turnstile.test.ts` 14 · `money.test.ts` 6 · `payer-key` +5 · `easyslip` +1 · `antibot` +1 · `antibot-purchase` +2
  · typecheck 0 · lint = warning เดิม 1 จุดใน prototype
- **เทสจับบั๊กของร่างแรกได้จริง**: `toSatang("")` คืน 0 เพราะ `Number("") === 0` → สลิปที่อ่านยอดไม่ได้จะกลายเป็น "0 บาท"
  (fail-open บนเส้นทางเงิน) → บังคับ string เป็นทศนิยมล้วนก่อนแปลง (ตัด `""`/`"1,500"`/`"1e3"`/`"0x10"`)
- เบราว์เซอร์จริง (dev server + Postgres/Redis จริง, Turnstile คีย์จริง): `pnpm test:seatmap-buyer` 27/27 ·
  `pnpm test:purchase-antibot` 7/7 (คนจริงยังซื้อได้ / UA สคริปต์ถูกหยุด / BotEvent ลง DB / ที่นั่งไม่ค้าง)
- **ยังไม่ได้เห็น token จริงผ่านด่าน action+hostname** — สคริปต์แก้ Turnstile คีย์จริงไม่ได้ (ตั้งใจไม่ bypass) และห้องรอต้อง login
  (กฎเครื่องมือเบราว์เซอร์: ไม่กรอกรหัสผ่าน) → **เช็คมือ 1 นาทีหลัง deploy**: login → เข้าคิวคอนเสิร์ตที่เปิดขาย → แก้ Turnstile →
  ต้องเข้าคิวได้ ไม่ใช่จอ "ตรวจพบกิจกรรมผิดปกติ"; ถ้าพัง ดู `BotEvent` ล่าสุด (`errorCodes` จะบอก `action-mismatch`/`hostname-mismatch`)

### ข้อควรรู้ตอน deploy
- แท็บที่เปิดค้างด้วย bundle เก่า (widget ไม่มี action) จะแก้ challenge ไม่ผ่านจนกว่าจะรีเฟรช — ชั่วคราวช่วง deploy
- รูปแบบคีย์ fallback ของผู้จ่ายเปลี่ยน (`name:<ชื่อ>` → `name:<bank>:<ชื่อ>`) — prod ยังไม่มีการขายจริง จึงไม่มีแถวเก่าให้ชน

---

## [Revision 26 — คิวมี "ทางออก" เมื่อบัตรหมด: ไม่ค้างตำแหน่ง 1 ตลอดกาล] — 2026-08-26

### Trigger
งานค้างข้อ 4.1 ใน HANDOFF: คอนเสิร์ตที่ไม่เหลือที่นั่ง (สร้างไว้ 0 ที่นั่ง / ขายหมดแต่ป้าย SOLD_OUT ยังไม่ถูกติด)
ผู้ใช้เข้าคิวได้แล้ว**ค้าง "ตำแหน่ง 1" จน token หมดอายุ 1 ชม.** → "คิวหมดอายุ กรุณาเข้าคิวใหม่" → วนกลับมาค้างอีก

### Root cause — ช่องโหว่ 3 จุดต่อกัน (ไม่ใช่บั๊กเดี่ยว)
1. **ประตูปล่อยผ่าน** `lib/sale-round.ts` `resolveEntryForUser` — คอนเสิร์ต**ไม่มีรอบ** `return ok` ก่อนเช็คบัตรหมด (ตรรกะ sold-out มีเฉพาะเส้นทางที่มีรอบ) · `Concert.status` ยัง ON_SALE เพราะพลิกเป็น SOLD_OUT เฉพาะตอนออกตั๋วสำเร็จ (docs/23 §3)
2. **ระหว่างรอไม่มีสัญญาณ** `app/api/queue/status` นับที่นั่งว่างได้ 0 → `admitNext` คืน 0 เงียบ ๆ → `getQueueStatus` มีแค่ WAITING/ADMITTED/EXPIRED/NOT_FOUND
3. **จอแสดงผิด** `components/waiting-room.tsx` — 403 ทุกแบบ (บัตรหมด/ยังไม่เปิดขาย/รอบล็อก) ขึ้นจอ "ตรวจพบกิจกรรมผิดปกติ" เหมือนโดนจับเป็นบอท

ข้อควรระวังที่ทำให้แก้แบบง่ายไม่ได้: ว่าง 0 ≠ หมดเสมอ — ยังมีที่นั่ง HELD ที่อาจหลุดกลับมาใน 5 นาที (นิยาม docs/23 §2: หมดจริง = ว่าง 0 **และ** ค้างจ่าย 0)

### ของที่แก้
- **ประตู**: `resolveEntryForUser` เช็ค `getConcertAvailability` ทุกคอนเสิร์ต (ไม่มีรอบ → context เปล่า ไม่โหลดสมาชิก/ลงทะเบียน) · join route ตอบ `action: "SOLD_OUT"` แยกจาก `ROUND_LOCKED` (ตรงกับที่ docs/23 §3 เขียนไว้แต่โค้ดไม่เคยทำสำหรับคอนเสิร์ตไม่มีรอบ)
- **ระหว่างรอ**: ผู้ที่ได้ lock ปล่อยคิว (ทุก ~3 วิ/คอนเสิร์ต, query DB อยู่แล้ว) ใช้ `getConcertAvailability` แทน `countAvailableSeats` แล้ว `recordSeatAvailability()` เขียน snapshot `{available, held}` ลง Redis `queue:{id}:seats` TTL 30 วิ → `getQueueStatus` ตอบสถานะใหม่ **`SOLD_OUT`** (ว่าง 0 และค้างจ่าย 0) หรือ `WAITING` + **`seatsFull`** (ว่าง 0 แต่มีคนค้างจ่าย) — คนโพลอื่นไม่แตะ DB เพิ่ม (หลัก peak-load เดิม) · ไม่มี snapshot = ไม่รู้ = รอต่อ (ห้ามเดาว่าหมด) · **ไม่ลบใครออกจากคิว** — snapshot หมดอายุเอง ถ้าเปิดขายใหม่/hold หลุด คิวไหลต่อโดยไม่ต้องเข้าคิวใหม่ · ADMITTED ไม่ถูกกระทบ
- **จอ**: `SOLD_OUT` → หยุด poll + จอ "บัตรหมดแล้ว" + ปุ่ม "กลับหน้าคอนเสิร์ต" (ไม่ใช่ "เข้าคิวใหม่" ที่วนลูป) · `seatsFull` → "ที่นั่งทั้งหมดถูกจองไว้ชั่วคราว…" + ไม่เชียร์ "ใกล้แล้ว" · 403 แยกตาม `action` — จอบอทเฉพาะ `BLOCK`
- นิยาม `isSoldOut`/`isTemporarilyFull` ย้ายไป `lib/admit-policy.ts` (ไฟล์ pure) แล้ว re-export จาก `lib/sold-out.ts` — `lib/queue.ts` ใช้นิยามเดียวกันโดยไม่ลาก prisma เข้าโมดูลคิว
- ไม่แตะ: ทิศทางเดียว ON_SALE→SOLD_OUT ของ `syncSoldOutStatus` (ตัดสินไว้ใน docs/23 §3)

### หลักฐาน
- **reproduce ก่อนแก้** (Redis จริง): ปล่อยคิว 3 รอบด้วย `seatsLeft: 0` → `WAITING position=1` ทุกรอบ ไม่มีสัญญาณอะไรเลย
- **`scripts/test-queue-soldout.ts` (ใหม่, ชั้น 2 Redis จริง) 9/9** — ไม่มี snapshot ยังรอ / หมดจริง → SOLD_OUT / ไม่ถูกเตะออก / TTL ≤ 30 / เต็มชั่วคราว → seatsFull / ที่นั่งกลับมา → WAITING ปกติ → ADMITTED / ADMITTED ไม่โดน snapshot เตะ
- **`pnpm test:queue-soldout-ui` (ใหม่, ชั้น 3 เบราว์เซอร์+DB+Redis จริง) 5/5 + ข้าม 2** — ประตูปฏิเสธด้วย "บัตรหมดแล้ว" + ปุ่มกลับ + ไม่ใช่จอบอท + ไม่สร้างคิวเพิ่ม + กดกลับได้จริง · ขั้น "ระหว่างรอ" (seatsFull → SOLD_OUT บนจอ) ถูก**ข้ามเพราะ dev ใช้ Turnstile คีย์จริง** — คำขอเข้าคิวครั้งแรกไม่มี token = CHALLENGE เสมอ (`lib/antibot.ts` +40) สคริปต์ผ่าน Turnstile จริงไม่ได้และตั้งใจไม่ bypass; คาดว่ารันครบได้เมื่อ dev ใช้ test key ของ Cloudflare (ตรรกะ anti-bot ยังทำงานครบ — **ยังไม่ได้ลองจริง**)
- **รีวิวซ้ำทั้ง diff (Fable 5, หลัง commit) เจอ 2 จุดแก้ตาม**: (1) status route — ถ้า `recordSeatAvailability` (Redis SET) พลาด catch เดิมจะล้าง `seatsLeft` ทิ้ง = รอบนั้นเสียเพดานที่นั่ง → แยก catch ของ snapshot ออก (2) หน้าเลือกที่นั่งใช้หัวข้อ "ยังไม่ถึงรอบของคุณ" กับทุกเหตุปฏิเสธ — ตอนนี้บัตรหมดปฏิเสธได้ทุกคอนเสิร์ต → หัวข้อตามเหตุผล. ตรวจแล้วไม่มีปัญหา: `order-finalize.ts` ไม่เรียกด่านนี้ (เส้นทางเงินตอน finalize ไม่ถูกบัตรหมดปฏิเสธผิด ๆ), การเจนที่นั่งใหม่อยู่ใน `$transaction` (ไม่มีช่วงที่นับได้ 0 ชั่วคราว), `NO_ROUND_CONTEXT` ไม่ถูก mutate
- unit **`tests/unit/queue-soldout-gate.test.ts` (ใหม่ 4)** — ไม่มีรอบ+หมด → SOLD_OUT / เต็มชั่วคราว → เข้าคิวได้ / มีที่นั่ง → `{ok, round:null}` / ไม่โหลด context สมาชิก · `antibot-part3.test.ts` เพิ่ม mock `seat.count` (route นับที่นั่งทุกคอนเสิร์ตแล้ว — เทสเดิม 3 ข้อพังเพราะ mock ไม่มี ไม่ใช่โค้ดผิด) · unit ทั้งชุด **541/541 (40 ไฟล์)** · typecheck สะอาด · lint = warning เดิม 1 จุดใน prototype
- regression เดิมไม่พัง: `test-queue-ghost` 7/7 · `test-queue-rejoin` 11/11 · `test-queue-status-dos` 5/5 · `test:seatmap-buyer` 27/27 · `test:sale-round` 10/10 · `test:purchase-antibot` 7/7

### เจอระหว่างทาง (ไม่ใช่ของ rev นี้ แต่ต้องรู้)
- **DB local `concert_antibot` ว่างเปล่า** — 0 users / 0 concerts, sequence เริ่มที่ 1, ไม่มีตาราง `_prisma_migrations` (= schema ถูกสร้างใหม่ด้วย `db push`) ทั้งที่ volume ยังเป็น `project-end_postgres-data` ตัวเดิม · ข้อมูลเดโม BABYMONSTER (#70, 69 โซน, รูปผัง) ที่ HANDOFF 25 ส.ค. อ้างว่าอยู่ใน DB นี้**ไม่มีแล้ว** · DB `concert_merge_test` (ใช้ตรวจ merge 25 ส.ค.) มีแค่ seed · ไม่พบ dump/backup ในเครื่อง → seed `user@local`/`admin@local` + คอนเสิร์ตตัวอย่าง 2 งานกลับเข้า `concert_antibot` (2026-08-26) เพื่อรันเทสเบราว์เซอร์ — ถ้าจะสาธิตผัง 69 โซนต้องนำเข้ารูป+Excel ใหม่

---

## [Revision 25 — merge สาย presale (พรชนก) เข้า seatmap: ระบบสมาชิก/รอบพรีเซลเหลือฉบับเดียว] — 2026-08-25

### Trigger
- ตรวจ branch ก่อนขึ้น prod แล้วพบว่า `feat/seatmap` กับ `origin/feat/membership-presale-storefront` (พรชนก, 2026-08-23) ต่างคนต่างทำ "สมาชิก + รอบกดบัตร" คนละฉบับ → ชนกัน 17 ไฟล์ และ Neon prod มี migration ของทั้งสองสายลงไปแล้ว (preview build ใช้ `DATABASE_URL` ตัวเดียวกับ production + `buildCommand` รัน `migrate deploy` ทุก build)

### ของที่ตัดสินใจ
- **ใช้ฉบับ presale เป็นหลัก** สำหรับสมาชิก / รอบขาย / ซับสคริปชั่น / บัตรหมด / หน้าร้าน (เป็น superset · มี docs 20–24 · migration ลง DB แล้ว · commit `a6a4b0e` ของสาย seatmap ระบุเองว่าจะ merge สายนี้เข้ามา) — ถอด implementation 2026-08-19 ของสาย seatmap ออก: `lib/sale-round-guard.ts`, `components/{sale-round-editor,sale-round-timeline,membership-admin-actions,membership-signup-button}.tsx`, หน้า `/admin/members` + `/admin/concerts/[id]/rounds`, `scripts/test-sale-round.ts` (+ สคริปต์ `pnpm test:sale-round`), `docs/21_MEMBERSHIP_ROUNDS.md` (ทั้งหมดยังอยู่ใน git history / tag `backup/pre-merge-seatmap-08debce`)
- ด่านรอบ 3 จุด (`app/api/queue/join` · หน้าเลือกที่นั่ง · `holdAndCreateOrder`) เปลี่ยนจาก `checkSaleAccess()` → `resolveEntryForUser()` + `effectiveTicketLimit()` ของ presale; เพดานตั๋วบนหน้าเลือกที่นั่ง/โควตาคงเหลือใช้เพดานของรอบ (`ticketMax`) ให้ตรงกับที่ server บังคับ
- ของสาย seatmap ที่คงไว้ครบ: ผังที่นั่งทั้งระบบ, ด่าน anti-bot ตอนกดซื้อ, โซนยืน / best-available, ทางกลับไปจ่าย (`pendingOrder`), ต่ออายุสิทธิ์เลือกที่นั่ง (sliding admit)
- `docs/25_SEATMAP.md` → **`docs/25_SEATMAP.md`** (เลข 20 ชนกับ `20_MEMBERSHIP.md` ของสาย presale) · เลข Revision 18–22 ของสาย presale ซ้ำกับสาย seatmap เพราะเขียนคู่ขนาน — เก็บไว้ทั้งคู่ใต้ป้าย "(สาย presale)" ด้านล่าง
- `prisma/schema.prisma` = union ของสองสาย; migration ครบ **15 ตัว** (8 master + 5 seatmap + 2 presale) — **ห้ามลบไฟล์ migration ของฝั่งไหน** เพราะลง Neon ไปแล้วทั้งคู่

### หลักฐาน
- `pnpm typecheck` ✅ · `pnpm lint` ✅ (warning เดิม 1 จุดใน prototype) · `pnpm test:run` **39 ไฟล์ / 537 เคส ✅** (391 seatmap + 146 presale)
- `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma` บน shadow DB local: **No difference detected**
- ยกเซิร์ฟเวอร์จริงจากโค้ดหลัง merge (dev บน DB/Redis แยก) แล้วรันสคริปต์เบราว์เซอร์ครบ: `test:seatmap` **43/43** · `test:seatmap-buyer` **27/27** · `test:purchase-antibot` **7/7** · `test:sale-round` (ใหม่ 10 เช็ค: NOT_MEMBER ที่ด่านคิว/หน้าเลือกที่นั่ง/holdAndCreateOrder + เพดาน 2 ใบของรอบ + order ผูก saleRoundId) **10/10** · `test:race` **22/22**
- 🐛 **บั๊กที่เจอเฉพาะตอนรันจริง (`next build` ผ่านแต่ dev server ไม่ขึ้น)**: Next.js ห้ามใช้ชื่อ slug ต่างกันใต้ path เดียวกัน — สาย seatmap มี `app/api/concerts/[id]/zones/[zoneId]/seats` แต่สาย presale เพิ่ม `app/api/concerts/[concertId]/rounds` → `Error: You cannot use different slug names for the same dynamic path ('concertId' !== 'id')` → ย้ายเป็น `app/api/concerts/[id]/rounds/route.ts` (URL เดิม client ไม่ต้องแก้)

---

## [Revision 24 — ผังรวมอ่านออก: ย่อชื่อโซนตามที่ว่าง + คลิกขวาลากเลื่อนผัง] — 2026-08-25

### Trigger
ดูภาพผังรวมของ BABYMONSTER (69 โซน) แล้วมองไม่ออกว่าผังหน้าตาเป็นยังไง — ชื่อโซนเต็มไปหมด
ทับกันเองและทับตัวหนังสือที่พิมพ์มาในรูปผังอยู่แล้ว

### ของที่ลง (branch `feat/seatmap` — 2 commit)
- **`399795c` fix(seatmap)** — `zoneLabelFontSize()` (pure, ใน `lib/seatmap/render-hints.ts`) วัด "วงกลมใหญ่สุดที่ยัดในกรอบโซนได้"
  (`distanceToPolygonEdges` ที่ export ออกมาจาก `polygon.ts`) แล้วคำนวณฟอนต์จากสูตรกล่องในวงกลม ชื่อยาวย่อเอง ·
  โซนที่เล็กจนอ่านไม่ออกไม่วาดชื่อเลย (ยังกดได้ ยังมี tooltip + aria-label) · เกณฑ์อ่านออกหารด้วยระดับซูม
  จึงทยอยโผล่เมื่อซูมเข้า · ย้ายชื่อโซนไปวาดรวบทีเดียวชั้นบนสุด กันโซนที่วาดทีหลังทับชื่อโซนก่อนหน้า
- **`fbe7364` feat(seatmap)** — คลิกขวาค้างแล้วลาก = เลื่อนผังตามมือทั้งสองแกน (ปุ่มซ้ายยังเป็น "เลือกโซน"
  จึงไม่ต้องเดาว่าคนตั้งใจลากหรือกดโซน) · ปิดเมนูคลิกขวาบนผัง · pointer capture ให้ลากเลยขอบกรอบได้ ·
  เคอร์เซอร์มือกำระหว่างลาก + คำใบ้โผล่เฉพาะตอนซูมเข้า · จอสัมผัสและแถบเลื่อนเดิมไม่กระทบ

### หลักฐาน
- unit **391/391** (34 ไฟล์ — เพิ่ม 6 เคสของ `zoneLabelFontSize`) · `pnpm test:seatmap` **43/43** ·
  `pnpm test:seatmap-buyer` **27/27** (คลิกซ้ายเลือกโซนยังทำงานปกติหลังเพิ่มการลาก) · typecheck สะอาด · lint เท่าเดิม
- วัดในเบราว์เซอร์จริง: ลาก 60px ผังเลื่อน 60px ตามทิศทางมือ · ปล่อยมือแล้วหยุดนิ่ง · เมนูคลิกขวาถูกปิด

### ข้อจำกัดที่ยังอยู่
- ผังฝั่งแอดมิน (`seatmap-editor.tsx`) ยังใช้ชื่อโซนขนาดตายตัวแบบเดิม — หน้านั้นเป็นหน้าวาดกรอบ
  การซ่อนชื่ออาจกวนงานแอดมิน จึงยังไม่แตะ
- ลากผังทดสอบด้วย pointer event ที่ยิงเข้า handler ไม่ใช่การลากเมาส์จริง (เครื่องมือทำไม่ได้)

---

## [Revision 23 — ผัง 2 ชั้น · กริดเว้าตามกรอบ · เสนอแถวจากกรอบ · ต่ออายุสิทธิ์เลือกที่นั่ง] — 2026-08-25

### Trigger
user-test แบบกดจริงทั้ง journey บนผัง BABYMONSTER (อิมแพ็ค 69 โซน) — โค้ดผ่านเทสหมดแต่คนใช้ไม่รอด 4 เรื่อง:
หน้ารวมรกจนอ่านไม่ออก · กริดที่นั่งเว้าคนละข้างกับรูป · แอดมินต้องนับแถวเองทุกโซน · เลือกไม่ทัน 5 นาทีโดนเด้ง

### ของที่ลง (branch `feat/seatmap` — 3 commit)
- **`9f22aa2` feat(queue)** — sliding admit window: `computeAdmitExtension` (pure) + `refreshAdmitted` ต่อครั้งละ 5 นาที เพดานแข็ง 15 นาทีนับจาก `admittedAt`, ไม่หดเวลาเดิม, token เก่าไม่ต่อ. ใช้ที่ `seats/page.tsx` + API ที่นั่งรายโซนเท่านั้น — **ทางเงิน (`holdAndCreateOrder`) ยังเป็น `isAdmitted` เช็คอย่างเดียว** กดซื้อไม่ใช่เหตุให้ต่อ. เทส `admit-extension.test.ts` 7
- **`9371b8e` feat(seatmap)** — `seat-map-svg.tsx` เป็น 2 ชั้น (ผังรวม → ผังโซน, กริดโหลดทันที, "เลือกเอง" เป็นค่าเริ่มต้น, กรอบโซนเป็นปุ่มคีย์บอร์ดแทนรายการที่ถอด, คำแนะนำคีย์บอร์ดย้ายไป `aria-describedby`) · `rowInsetFractions` ตัดขวางกรอบทีละแถววางตามเส้นกลาง → ตัว L เว้าถูกข้าง โซนเอียงเป็นสี่เหลี่ยมด้านขนาน · สิทธิ์หมดกลางทางพากลับหน้าคิว (`slug`)
- **`5101810` feat(seatmap)** — `lib/seatmap/row-spec-suggest.ts` เสนอ "ที่นั่งต่อแถว" จากรูปทรงกรอบ (ระดับ A: วัดกรอบที่แอดมินวาด ไม่ใช่ CV อ่านรูป — ทาง B ตัดทิ้งเหมือน docs/20 §2) ผลรวมเท่าจำนวนที่นั่งเป๊ะ · ปุ่ม "เสนอจากกรอบ" รายโซน + ปุ่มยกชุด (กด 2 ครั้ง) → `applySuggestedRowSpecs` ข้ามโซนที่มีภาระผูกพันผ่าน `regenerationVerdict` เดิม
- เอกสาร: `docs/25_SEATMAP.md` §7/§8/§8.3/§9/§10 · `CLAUDE.md` แผนที่ไฟล์ + ตัวเลขเทส

### สิ่งที่ตรวจแล้วตัดสินว่า "ไม่ใช่บั๊ก"
- ไล่ทั้ง 69 โซนด้วยเครื่อง (เทียบกรอบกับสีในรูป ≥85% ทุกโซน + เทียบแถวใน DB): 47 โซนตรง, 22 โซนเป็นบล็อกวางเอียงซึ่งกริดสี่เหลี่ยมหมุนตามไม่ได้ — บันทึกเป็นข้อจำกัดใน docs/20 §9 (ตัวหมุนกริดถูกถอดโดยตั้งใจตั้งแต่ §2.1 ไม่เอากลับมา)
- แถวเศษแปลก ๆ ในข้อมูลเดโม (เช่น "แถว D มี 1 ที่") มาจากตัวจัดแถวอัตโนมัติแบบเดิม ไม่ใช่ตัววาด — `rowSpec` ของ BABYMONSTER ยัง null ทั้ง 69 โซน กดยกชุดครั้งเดียวหาย (ยังไม่กด รอตัดสินตอนเตรียมสาธิต)

### หลักฐาน
- unit **385/385** (34 ไฟล์) · `pnpm test:seatmap` **43/43** (เพิ่ม §8.5: เสนอรายโซน / ยกชุด / ยกชุดข้ามโซนที่ขายแล้วและ id ที่นั่งไม่เปลี่ยน) · `pnpm test:seatmap-buyer` **27/27** (ปรับตาม UX ใหม่) · typecheck + lint สะอาด
- เทียบกริด V1/V3 กับรูปจริงด้วยตา + suggester รันบนกรอบจริง 69 โซนได้ครบ โปรไฟล์ V3 = 14…6…12 ตรงสามท่อนของตัว L

### ค้าง
- ตัดสินใจ merge `feat/seatmap` → `master` (Vercel build + `prisma migrate deploy` อัตโนมัติ)
- บั๊กคิวค้างตำแหน่ง 1 เมื่อคอนเสิร์ตมี 0 ที่นั่ง (`admitNext` limit 0 คืนก่อน) — วางแผน fix 3 จุดไว้แล้ว ยังไม่ทำ
- กดยกชุดเสนอแถวให้ข้อมูลเดโม BABYMONSTER · ลบไฟล์สำรอง `docker-compose.yml.bak-20260824` และ concert ร่าง #64/#65 (รอ user ยืนยัน)

---

## [Revision 22 — ด่าน anti-bot ตอน "กดซื้อ" (ปิด SECURITY_TODO #1)] — 2026-08-25

### Trigger
`docs/SECURITY_TODO.md` ข้อ 1 ค้างมาตั้งแต่ audit รอบแรก: anti-bot ตรวจแค่ตอนเข้าคิว ตอนกดซื้อไม่ตรวจอะไรเลย

### จุดที่ทำให้ต้องออกแบบใหม่ ไม่ทำตามแนวทางเดิมใน TODO
แนวทางที่ TODO เขียนไว้ ("อ่าน `BotEvent` ล่าสุดของ user มาเทียบ threshold") **แทบไม่กันอะไร** —
ด่านคิวปฏิเสธ 403 ตั้งแต่ BLOCK อยู่แล้ว คนที่ถือ queue token ที่ admit แล้วจึงเคยได้ ALLOW เสมอ
→ ช่องจริงคือ **คำขอตอนกดซื้อไม่เคยถูกประเมิน** (เข้าคิวด้วยมือ แล้วส่ง session ให้สคริปต์ยิงต่อ
หรือสัญญาณ Layer 2 ที่เพิ่งติดตอนเลือกที่นั่งไม่มีใครอ่านซ้ำ) → ประเมิน **คำขอนี้ใหม่** แทน

### ของที่เพิ่ม
- **`lib/antibot-purchase.ts` (ใหม่)** — `assessPurchase()` เป็นฟังก์ชันบริสุทธิ์ ไม่แตะ DB (ผู้เรียกป้อนข้อมูลเข้ามา) เพื่อให้เทสได้โดยไม่ต้อง mock Prisma
  - สัญญาณ: UA + headers ของคำขอนี้ (น้ำหนักเดียวกับด่านคิว ใช้ `scoreUserAgent`/`scoreHeaders` ที่ export ออกมาใหม่) · `BehaviorSession.isLikelyBot` +30 · เคยโดน BLOCK ใน 30 นาที +45 · Turnstile ส่งมาแล้วไม่ผ่าน +55
  - threshold เดียวกับด่านคิว (CHALLENGE 40 / BLOCK 70)
  - 🔑 **"ไม่ส่ง Turnstile token" = 0 คะแนน ไม่ใช่ +40** — ตอนกดซื้อไม่มี token ติดมือมาแต่แรก ถ้ายืมกติกาด่านคิวมาตรง ๆ คนซื้อจริงโดน CHALLENGE ยกแผงบนเส้นทางเงิน
  - ทำ Turnstile ผ่านสด ๆ → ปลด CHALLENGE เป็น ALLOW (กันวนลูปยืนยันไม่จบ) แต่ **ไม่ปลด BLOCK** เพราะสคริปต์ก็ทำ Turnstile ผ่านได้
- **`app/actions/booking.ts`** — `assessPurchaseForUser()` อ่าน BotEvent + BehaviorSession แบบขนาน แล้วตัดสินก่อนล็อกที่นั่ง · เขียน `BotEvent` (`checkpoint: "purchase"`) ใน try/catch — **บันทึก audit ล้มเหลวต้องไม่ทำให้ซื้อไม่ได้** · ไม่มีพารามิเตอร์ "ข้ามด่าน" เพราะ server action ถูกเรียกจาก client ด้วยอาร์กิวเมนต์อะไรก็ได้
- **UI ยืนยันตัวตนที่หน้าเลือกที่นั่ง** (`components/seat-map-svg.tsx`, `components/seat-map.tsx`) — โดน CHALLENGE แล้วขึ้นกล่อง Turnstile ตรงแถบสรุป **โดยไม่ล้างที่นั่งที่เลือกไว้** ยืนยันผ่านแล้วยิงคำสั่งซื้อต่อให้อัตโนมัติ · `TurnstileWidget` รับ prop `size` เพิ่ม (กล่องข้างผังกว้าง ~266px ส่วน widget ปกติ 300px จะล้น → ใช้ `compact`)
- **index**: `bot_events(userId, createdAt)` + `behavior_sessions(userId, createdAt)` — migration `20260824190000_add_bot_event_user_idx` (query ใหม่อยู่บนเส้นทางเงิน ต้องไม่ scan)

### หลักฐาน (ไม่ได้เชื่อว่าเขียนแล้วต้องทำงาน)
- `tests/unit/antibot-purchase.test.ts` **12 เทส** — เน้นเคส false positive: เบราว์เซอร์ปกติไม่มี token ต้องได้ 0 คะแนน · ไม่เรียก `verifyTurnstile` ถ้าไม่มี token · สัญญาณอ่อนตัวเดียวไม่พอเด้ง
- `pnpm test:purchase-antibot` (ใหม่) **7/7 บนเบราว์เซอร์จริง + DB จริง + Redis จริง** — ให้บอทถือ queue token ที่ admit แล้ว (สมมติว่าด่านคิวถูกข้ามไปแล้ว) แล้วพิสูจน์ว่า: คนจริงยังซื้อได้ · UA สคริปต์ไม่ถึงหน้า checkout · มี `BotEvent checkpoint=purchase` ลง DB จริง · ที่นั่งของบอทไม่ถูกผูกกับ order ใด
- `pnpm test:seatmap-buyer` **27/27** · unit ทั้งชุด **362/362** · typecheck + lint สะอาด

---

## [Revision 21 — เอกสารตามโค้ดทัน: ER 14→17 ตาราง + requirements + จุดยืน resale] — 2026-08-24

### Trigger
ตรวจแล้วพบว่า **เอกสารในเล่มตามโค้ดไม่ทันมา 2 รอบ** — `04_ER_DIAGRAM.md` ยังเขียนว่ามี 14 ตาราง ทั้งที่ schema จริงมี 17 (ขาด `TicketReturn` / `Membership` / `SaleRound`) และ `Zone.stageSide` ไม่ปรากฏในเอกสารเล่มไหนเลย · เอกสารพวกนี้เข้าเล่มบท 3 ตรง ๆ ถ้าไม่แก้ = ส่งเล่มที่ ER ไม่ตรงระบบจริง

### ของที่แก้
- **`04_ER_DIAGRAM.md`** — 14 → **17 models**, 8 → **12 enums**
  - เพิ่ม `TicketReturn`, `Membership`, `SaleRound` ทั้งใน Mermaid และตารางรายละเอียด (§2.15–2.17)
  - เติมฟิลด์ผังที่นั่งที่ขาด: `Concert.layoutImage*`/`stagePolygon` · `Zone.tier`/`polygon`/`stageSide`/`isStanding`/`rowSpec` · `Seat.x`/`y` · `Order.saleRoundId` · `OrderItem.holderUserId` · `Ticket.holderName`/`qrSecret`/`checkedInAt`/`returnedAt`
  - 🔴 **แก้ของที่เขียนผิด**: `Ticket.seatId` ไม่ใช่ UNIQUE ธรรมดา แต่เป็น **partial unique `WHERE returnedAt IS NULL`** (อยู่ใน migration `20260703150000` — ดูจาก `schema.prisma` อย่างเดียวไม่เห็น) · `Payment.slipImageUrl` ไม่ได้ "เก็บใน MinIO" แต่เก็บ base64 ลง Postgres
  - ตรวจด้วยสคริปต์ว่าเอกสารครอบคลุมครบทุก model/field/enum ที่ parse ได้จาก `schema.prisma` (ไม่ได้กวาดตาเอง)
- **`11_REQUIREMENTS.md` rev 4**
  - 🆕 §2.2.3 ผังที่นั่ง**ภายในโซน** — กริด 1 แถว = 1 บรรทัด · ทิศเวที · โซนยืน · `rowSpec` · **best-available เป็นค่าเริ่มต้น + เลิกส่งผังทั้งงานไป client (มาตรการกันบอท ไม่ใช่เรื่องความเร็ว)**
  - 🆕 §2.7 **จุดยืนเรื่อง resale** — ตั๋วผูกชื่อ + QR หมุนตามเวลา + คืนบัตรราคาหน้าบัตรเข้า pool กลางที่ **ผู้คืนเลือกผู้รับไม่ได้** = ตัดตลาดขายต่อด้วยการออกแบบ (โมเดล Face Value Exchange + SafeTix) — ของเดิม §5 เขียนแค่ "❌ Resale market" ซึ่งอ่านผิดเป็น "ไม่มีอะไรเรื่องขายต่อเลย"
  - 🔴 แก้ §3.3 + §5 ที่ยังเขียนว่า **local-only / ไม่ deploy cloud** ทั้งที่ deploy บน Vercel (Neon + Upstash) จริงแล้ว และ `vercel.json` รัน `prisma migrate deploy` ให้อัตโนมัติทุก build
  - เพิ่ม 7 แถวใน Decision Log (คืนบัตร · รอบสมาชิก · ผังจากรูป · rowSpec · best-available · Vercel)

### ยืนยันกับโค้ดจริงก่อนเขียน (ไม่ได้เชื่อ handoff)
`RETURN_CUTOFF_HOURS` (`lib/env-schema.ts:94`) · conditional claim + คืนที่นั่งเฉพาะที่ยัง `SOLD` (`app/actions/tickets.ts:204-232`) · HMAC QR (`lib/entry-code.ts:12`) · `lib/holder-policy.ts` · best-available เป็นค่าเริ่มต้นจริง (`components/seat-map-svg.tsx:157` `useState<SeatedMode>("best")`) · partial unique index (`prisma/migrations/20260703150000/migration.sql:37`)

---

## [Revision 20 — โซนยืน · ระบบเลือกที่นั่งให้ · แถวยาวไม่เท่ากัน] — 2026-08-24

### Trigger
ผังคอนเสิร์ตจริงมี 3 อย่างที่ระบบยังตอบไม่ได้: โซนยืนที่ไม่มีแถวจริง · คนซื้อส่วนใหญ่อยากได้ "ที่ดีที่สุดที่เหลือ" ไม่อยากไล่จิ้มเอง · แถวหน้า-หลังยาวไม่เท่ากัน — ทำตามแผน `HANDOFF-zone-seat-layout.md` 3 ขั้น (branch `feat/seatmap`, **ยังไม่ commit**)

### ของที่ลง
- **ขั้น 1 โซนยืน** — `Zone.isStanding` (migration `20260824...standing`): ฝั่งซื้อเป็นแผงเลือกจำนวนใบ, `holdStandingZone` สุ่มที่นั่งว่าง (oversample 3×, retry ≤3) เข้า `holdAndCreateOrder` เดิม, Excel คอลัมน์ "ประเภทโซน"
- **ขั้น 2 best-available + ปิดรูรั่ว §0.4** — โหมด "ระบบเลือกให้" (ค่าเริ่มต้น): `holdBestAvailable` + `pickBestSeats` เลือกแถวหน้าสุด-ติดกันก่อน; payload หน้าแรกเหลือแค่จำนวนว่างต่อโซน ผังจริงโหลดรายโซนผ่าน endpoint ใหม่หลังด่าน login+คิว+rate-limit (บอทเคยกวาดทั้งผังได้ฟรี)
- **ขั้น 3 rowSpec** — `Zone.rowSpec` (migration `20260824132751`): JSON จำนวนที่ต่อแถว ผลรวมต้องเท่า `totalSeats`; แผง "จัดแถว" รายโซน + ฟอร์ม + คอลัมน์ Excel "ที่นั่งต่อแถว"; ทุกทางเจนที่นั่งรวมศูนย์ผ่าน `regenerationVerdict()` (DB + Redis สด)

### บั๊กที่เจอตอนตรวจรับ (แก้แล้ว)
**เรียง `rowLabel` แบบ string ใน SQL ที่มี LIMIT** — `AA` แทรกระหว่าง `A`/`B` ทำโซน >26 แถวที่ว่าง >500 ที่ แจกแถวหลังทั้งที่แถวหน้าว่าง → ต้อง `ORDER BY LENGTH("rowLabel"), "rowLabel"` ทุกครั้ง (กติกาเดียวกับ `compareSeatOrder`)

### ผลทดสอบ (รันจริง 2026-08-24 — รายละเอียด [25_SEATMAP.md](25_SEATMAP.md) §8.2)
| ชุด | ผล |
|---|---|
| typecheck | 0 error |
| vitest ทั้งโปรเจกต์ | **350/350** |
| `pnpm test:seatmap` (แอดมิน) | **34/34** |
| `pnpm test:seatmap-buyer` (คนซื้อ) | **27/27** |
| ตรวจบนเว็บจริง | ครบทั้ง 3 ขั้น (ยืน→checkout จริง · best-available ได้ A1,A2 · จัดแถว 10/28 แล้วกริดคนซื้อตรง) |

---

## [Revision 19 — สิทธิ์สมาชิก + รอบกดบัตร] — 2026-08-19

> ⚠️ 2026-08-25: implementation ของรีวิชันนี้ถูกถอดออกตอน merge สาย presale (ดู Revision 25) — เก็บไว้เป็นประวัติการตัดสินใจ

### Trigger
ฟีเจอร์ที่ 2 และ 3 จาก 3 อย่างที่อาจารย์สั่ง (ที่ 1 = ผังที่นั่ง อยู่ใน rev 18)

โจทย์: **"early bird" ต้องแปลว่าสมาชิกกดก่อน ไม่ใช่ได้ลดราคา** — ระบบเดิมมีสวิตช์เดียวคือ `ON_SALE` พอเปิดขายทุกคนเข้าพร้อมกันหมด

> 📌 ตอนเริ่มสายนี้พบว่า **2 ใน 3 ฟีเจอร์ที่อาจารย์สั่งยังไม่มีโค้ดเลยสักบรรทัด** (ตรวจ 3 ทาง: ไฟล์ที่ควรมี · หน้าเว็บที่ควรมี · grep ทั้ง repo + เช็ค branch `origin/claude/*` ด้วย) — เจอก่อนลงมือเขียนบทในเล่ม ไม่งั้นจะกลายเป็นเขียนว่ามี 3 ฟีเจอร์ทั้งที่มีจริงแค่ 1

### ของที่ลง
- **schema** — ใช้ migration เดียวกับ rev 18 (`20260818093203_...`): `Membership`, `SaleRound`, `Order.saleRoundId`
- **`lib/membership.ts`** — `isMembershipActive` / `describeMembership` (pure) ตัดสินสิทธิ์สดจาก `status` + `expiresAt`
- **`lib/sale-round.ts`** — `resolveSaleAccess` / `isRoundOpenAt` / `validateRoundWindow` — **pure ทั้งไฟล์ ไม่แตะ DB ไม่อ่านนาฬิกาเอง**
- **`lib/sale-round-guard.ts`** — `checkSaleAccess()` ตัวเดียวที่ทั้ง 3 ด่านเรียก (กติกาไม่มีทางเพี้ยนกันเอง)
- **actions** — `app/actions/membership.ts` (สมัครเอง/ให้/เพิกถอน) · `app/actions/sale-round.ts` (เพิ่ม/แก้/ลบรอบ)
- **UI** — หน้าจัดการสมาชิก · หน้าตั้งรอบ · หน้าสิทธิ์ของผู้ใช้ · ตารางรอบฝั่งคนซื้อ

### การตัดสินใจที่ควรรู้ (เหตุผลเต็มใน [21_MEMBERSHIP_ROUNDS.md](21_MEMBERSHIP_ROUNDS.md))
- **🔑 ทำเป็นรอบเวลาแยก ไม่ใช่ให้สมาชิกแซงคิว** — ถ้าทำคิวแบบมีลำดับความสำคัญ **สถิติความเป็นธรรมทั้งบทต้องวัดใหม่หมด** วิธีนี้คิวในแต่ละรอบยัง FIFO เป๊ะเหมือนเดิม ตัวเลขเดิมใช้ได้ทั้งหมด
- **หมดอายุคำนวณสด ไม่มี cron** — cron ตกรอบ = สมาชิกที่หมดอายุยังกดได้ ผลข้างเคียงที่ต้องจำ: **แถวที่ `status=ACTIVE` อาจไม่ใช่สมาชิกแล้ว** ห้ามอ่าน field ตรง ๆ ตัดสินสิทธิ์
- **เพิกถอนไม่ลบแถว** — ต้องตอบได้ว่าใครเคยมีสิทธิ์ ถอนเมื่อไหร่
- **บังคับใช้ 3 จุด ไม่ใช่จุดเดียว** — เช็คซ้ำที่หน้าเลือกที่นั่งเพราะ **รอบอาจปิดตอนผู้ใช้ยังถือ queue token อยู่**
- **ด่านรอบวางก่อน anti-bot** — คนที่ยังไม่ถึงรอบไม่ควรต้องแก้ CAPTCHA ก่อนแล้วค่อยรู้ว่าเข้าไม่ได้
- **ตารางรอบฝั่งคนซื้อไม่บอกสิทธิ์รายคน** — หน้ารายละเอียดคอนเสิร์ตตั้ง `revalidate = 60` ถ้าดึง session มาแสดง Next จะเปลี่ยนเป็น dynamic = **แคชหายทั้งหน้า** ทั้งที่เป็นหน้าที่โดนถล่มหนักสุด

### 🔴 กับดักที่เกือบพังตอนขึ้นจริง — โซนเวลา
`<input type="datetime-local">` ส่งเวลามาแบบ**ไม่มีโซนติดมา** ถ้าเซิร์ฟเวอร์ `new Date()` ตรง ๆ:
รันในเครื่องตัวเอง (โซนไทย) = ถูก → **ไม่มีใครเห็นปัญหาตอนพัฒนา**
ขึ้น Vercel (โซน UTC) = **รอบเลื่อน 7 ชั่วโมง** รอบสมาชิกที่ตั้งสองทุ่มไปเปิดตีสาม
→ แปลงเป็น ISO ตั้งแต่ฝั่งเบราว์เซอร์ + มีเทสเทียบเวลาที่ลง DB จริงกับที่ตั้งใจ

### ผลทดสอบ (รันจริง 2026-08-19)
| ชุด | ผล |
|---|---|
| เทสหน่วย สมาชิก | **16 ผ่าน / 0 ตก** |
| เทสหน่วย รอบกดบัตร | **18 ผ่าน / 0 ตก** |
| เทสหน่วยทั้งโปรเจกต์ | **254 ผ่าน / 0 ตก** (26 ไฟล์) |
| Integration เบราว์เซอร์จริง (`pnpm test:sale-round`) | **22 ผ่าน / 0 ตก** |

**บั๊กที่เทสจับได้จริง:** กดลบรอบที่มีคำสั่งซื้อ → ระบบปฏิเสธถูกต้อง แต่หน้าจอเงียบสนิท เพราะที่แสดงข้อความผิดพลาดอยู่ในฟอร์มที่ยังไม่ได้เปิด → ย้ายออกมาให้เห็นเสมอ

**เทสหน่วยเดิมพัง 3 เคส** จากการที่ route เข้าคิวมีด่านใหม่แทรก — แก้โดย mock `sale-round-guard` ในเทสชุด anti-bot (เทสนั้นไม่ได้มีหน้าที่ตรวจเรื่องรอบ) ไม่ใช่แก้โค้ดจริงให้เทสผ่าน

### ยังไม่ได้ทำ
- รัน migration บนฐานข้อมูลจริง (Neon) — **ต้องทำก่อนสาธิต**
- หน้าสรุปยอดขายรายรอบ (ข้อมูลเก็บครบแล้วใน `Order.saleRoundId` ทำเมื่อไหร่ก็ได้)

---

## [Revision 19 — ผังที่นั่งเปลี่ยนเป็น "ผังระดับโซน" + ข้อมูลโซนจาก Excel] — 2026-08-21

### Trigger
ทบทวนโจทย์กับผู้ใช้แล้วได้ความว่า สิ่งที่ต้องการจากผังคือ **"เวทีอยู่ตรงไหน"** และ **"โซนนี้อยู่ตรงไหนของเวที"**
ไม่ได้ต้องการให้ระบบคำนวณจำนวนบัตรจากพื้นที่บนรูป — ซึ่งเป็นสิ่งที่ rev 18 ทุ่มความซับซ้อนไปมากที่สุด

### ของที่ถอดออก
- **`lib/seatmap/generate.ts` ทั้งไฟล์** — `fillPolygonWithSeats()` (binary search ระยะห่าง + convex hull/rotating calipers หมุนกริดตามแนวบล็อก + ray casting) และ `tests/unit/seatmap-generate.test.ts` (27 เทส)
- **การวาดจุดที่นั่งรายตัวทับรูป** ทั้งฝั่งแอดมินและฝั่งคนซื้อ — ผัง 11,000 ที่นั่งเคยเป็น 11,000 node ใน SVG
- `Seat.x` / `Seat.y` ไม่มีโค้ดอ่าน/เขียนแล้ว (**ยังไม่ลบคอลัมน์** — migration ที่ย้อนกลับไม่ได้ ไม่คุ้มกับพื้นที่ไม่กี่ไบต์)

> อัลกอริทึมที่ถอดออกนั้น "ถูกต้องตามที่มันตั้งใจจะทำ" (เทสผ่านครบ 27 ข้อรวมเคสบล็อกเอียง 30°)
> บทเรียนคือ **ความถูกต้องของอัลกอริทึมไม่ได้แปลว่าโจทย์ถูก** — และบั๊กหลายตัวที่ rev 18 ไล่แก้ทีละอัน (จุดกลืนพื้นหลัง · จุดทับกันเป็นแผ่นสี · เลขที่นั่งไม่โผล่) มีต้นเหตุร่วมข้อเดียวคือการพยายามวาดที่นั่งรายตัวทับรูป พอเอาความสามารถนั้นออก บั๊กทั้งกลุ่มหายไปโดยไม่ต้องแก้ทีละตัว

### ของที่ลง
- **schema** — migration `20260820234008_add_stage_polygon_and_zone_tier`: `Concert.stagePolygon` (Json?) เก็บกรอบเวที · `Zone.tier` (VarChar(50)?) ชื่อเรทราคา (**nullable ทั้งคู่** ข้อมูลเดิมไม่กระทบ)
- **`lib/seatmap/seat-rows.ts`** — จัดที่นั่งเป็นแถวจาก "จำนวนที่สั่ง" ล้วน ๆ ไม่เกี่ยวกับขนาดกรอบ + ยกชื่อแถวฐาน 26 แบบ bijective และ `compareSeatOrder` มาจากไฟล์เดิม
- **`lib/seatmap/zone-sheet.ts`** — ตรวจข้อมูลโซนจากตาราง (pure function): ชื่อโซนห้ามซ้ำ · เรทเดียวกันต้องราคา+สีเดียวกัน · เรทต่างกันต้องคนละสี · เก็บ error ครบทุกแถวในรอบเดียว
- **`lib/seatmap/zone-sheet-xlsx.ts`** — อ่าน `.xlsx` จริงด้วย exceljs (**อ่านสีจากสีพื้นของช่อง** ไม่ใช่ข้อความ) + สร้างไฟล์ตัวอย่างจากโค้ดชุดเดียวกัน
- **`app/api/admin/seatmap/template/route.ts`** — ดาวน์โหลดไฟล์ Excel ตัวอย่าง (กัน `isVerifiedAdmin()` เช็ค role กับ DB จริง)
- **`app/actions/seatmap.ts`** — เพิ่ม `saveStagePolygon` และ `importZonesFromSheet` (รวมเป็น 5 action)
- **UI** — `seatmap-editor.tsx` มีโหมด "วาดกรอบเวที" + ปุ่มนำเข้า Excel · `seat-map-svg.tsx` วาดกรอบโซนเป็นแผ่นสีตามเรท + แผงเลือกที่นั่งแยกต่างหาก
- **dependency ใหม่** — `exceljs@4.4.0`

### การตัดสินใจที่ควรรู้ (เหตุผลเต็มใน [25_SEATMAP.md](25_SEATMAP.md))
- **จำนวนที่นั่งไม่ผูกกับขนาดกรอบ** — จำนวนบัตรเป็นเรื่องที่ผู้จัดกำหนด ไม่ใช่เรื่องที่คำนวณจากรูป
- **สีเป็นของ "เรท" ไม่ใช่ของ "โซน"** — คำอธิบายสีจึงไม่มีทางขัดกับผัง และ 69 โซนย่อเหลือ 7 บรรทัดเท่าผังจริง
- **อ่านไฟล์ Excel ฝั่งเซิร์ฟเวอร์** — เลี่ยง polyfill ในเบราว์เซอร์ แลกด้วยด่าน: สิทธิ์แอดมิน + เพดานขนาดไฟล์ + เพดานจำนวนแถว + zod ตรวจซ้ำก่อนลง DB
- **นำเข้าไฟล์ไม่ลบโซนที่ไม่มีในไฟล์** — แค่รายงานชื่อกลับไป (ไฟล์ที่ส่งมาไม่ครบไม่ควรลบข้อมูลที่ผูกกับเงิน)
- **`assignZoneFrame` เหลือแค่ `UPDATE zones SET polygon`** — ไม่แตะตาราง `seats` เลย ความเสี่ยงของ raw UPDATE ทั้งโซนหายไปพร้อมพิกัด

### 🔴 จุดที่แตะเงินจริง
**ด่านกันเจนทับ (`canRegenerateZoneSeats` + Redis `getHeldSeats`) บังคับใช้กับการนำเข้า Excel ด้วย** ไม่ใช่แค่ฟอร์มบนหน้าเว็บ
ไฟล์ที่บอกว่าโซน VIP เปลี่ยนจาก 480 เป็น 500 ที่ จะไม่ทำให้ที่นั่งที่ขายไปแล้วหายไป — ระบบข้ามโซนนั้นแล้วรายงานกลับว่าข้ามเพราะอะไร

### ♿ ผลพลอยได้
แผงเลือกที่นั่งเป็น `<button>` จริงพร้อม `aria-label`/`aria-pressed` แทน `<circle>` ใน SVG
ของเดิม **กดด้วยคีย์บอร์ดไม่ได้เลยทั้งผัง และโปรแกรมอ่านหน้าจอไม่เห็นที่นั่งสักที่**

### ผลทดสอบ (รันจริง 2026-08-21)
| ชุด | ผล |
|---|---|
| เทสหน่วยผังที่นั่ง | **63 ผ่าน / 0 ตก** (`zone-sheet` 17 + `seat-rows` 12 + `seatmap-render` 34) |
| เทสรวมฝั่งแอดมิน (`pnpm test:seatmap`) | **34 ผ่าน / 0 ตก** |
| เทสรวมฝั่งคนซื้อ (`pnpm test:seatmap-buyer`) | **19 ผ่าน / 0 ตก** |
| เทสหน่วยทั้งโปรเจกต์ | **278 ผ่าน / 27 ไฟล์** |

เทสหน่วยของ `zone-sheet` สร้างไฟล์ `.xlsx` จริง (รวมการระบายสีพื้นช่อง) แล้วอ่านกลับด้วยตัวอ่านของระบบ ไม่ mock ชั้นอ่านไฟล์

### 🐛 บั๊กที่เจอระหว่างทาง (ไม่เกี่ยวกับผัง แต่ทำเว็บล่มทั้งเว็บ)
`app/globals.css` คอมไพล์ไม่ผ่าน ทั้งเว็บขึ้น 500 — ต้นเหตุคือ **path ของ Windows ในไฟล์ `.md`**
Tailwind v4 สแกนไฟล์ `.md` ด้วย และอ่าน `\` ตามด้วยเลขฐาน 16 หกตัวเป็น CSS escape → `String.fromCodePoint(8820518)` → RangeError
**กฎที่ได้: เขียน path ในไฟล์ `.md` ด้วย `/` เสมอ**

### ยังไม่ได้ทำ
- ฟีเจอร์เสริม "จิ้มสีให้ระบบเดากรอบ" (flood fill) — ยังคงเป็นของที่ตัดทิ้งได้ก่อนเพื่อน
- รัน migration บนฐานข้อมูลจริง (Neon) — ต้องทำก่อนสาธิต
- ตัดสินใจว่าจะลบคอลัมน์ `Seat.x` / `Seat.y` ทิ้งเมื่อไหร่

---

## [Revision 18 — ผังที่นั่งจากรูปสถานที่จริง] — 2026-08-19

> 🔄 **บางส่วนของ rev นี้ถูกถอดออกแล้วใน rev 19** — `lib/seatmap/generate.ts` และการวาดจุดที่นั่งรายตัวทับรูปไม่มีอยู่ในระบบอีกแล้ว บันทึกนี้เก็บไว้เป็นประวัติ

> ⚠️ **มีช่องว่างในบันทึกนี้**: งานระหว่าง rev 17 (2026-06-04) กับ rev 18 — โดยเฉพาะ **บัตรผูกชื่อ/เช็คอิน/คืนบัตร** (2026-07-04, ดู [19_NAMED_TICKET_PLAN.md](19_NAMED_TICKET_PLAN.md)) และรอบ review 7 ตอน — **ไม่ได้ถูกบันทึกไว้ที่นี่** ถ้าต้องการลำดับเหตุการณ์ครบให้ดู git log ประกอบ

### Trigger
อาจารย์ที่ปรึกษาขอฟีเจอร์เพิ่ม 3 อย่างภายใน ~7 วัน — เอกสารนี้บันทึกเฉพาะ **สายผังที่นั่ง** (อีก 2 สายคือระบบสมาชิกกับรอบขาย อยู่คนละ branch)

ปัญหาที่แก้: สถานที่จัดคอนเสิร์ตแต่ละแห่งมีพื้นที่ใช้งานไม่เหมือนกัน แต่ผังเดิมเป็นตารางสี่เหลี่ยมตายตัว คนซื้อมองไม่ออกว่าที่นั่งอยู่ตรงไหนของฮอลล์จริง

### ของที่ลง
- **schema** — migration `20260818093203_phase2_seatmap_membership_sale_round`: `Concert.layoutImageBase64/Width/Height`, `Zone.polygon`, `Seat.x/y` (**nullable ทั้งหมด** คอนเสิร์ตเก่าไม่กระทบ)
- **`lib/seatmap/generate.ts`** — `fillPolygonWithSeats()` โปรยที่นั่งเต็มกรอบได้จำนวนเป๊ะตามสั่ง (binary search หาระยะห่าง + ray casting + ชื่อแถวฐาน 26 แบบ bijective) เขียนเป็น pure function
- **`lib/seatmap/guard.ts`** — ด่านกันเจนที่นั่งทับโซนที่ขายบัตรแล้ว
- **`lib/seatmap/polygon.ts`** — อ่านกรอบจาก DB อย่างปลอดภัย ข้อมูลผิดรูปคืน `null` ให้หน้าเว็บถอยไปผังตาราง
- **`app/actions/seatmap.ts`** — 3 action: อัปโหลดรูป · บันทึกโซน+เจนที่นั่ง · **ตั้งกรอบคงที่นั่งเดิม**
- **UI** — `components/seatmap-editor.tsx` (แอดมินวาดกรอบ) + `components/seat-map-svg.tsx` (ผังบนรูปฝั่งคนซื้อ)

### การตัดสินใจที่ควรรู้ (เหตุผลเต็มใน [25_SEATMAP.md](25_SEATMAP.md))
- **ไม่ให้เครื่องอ่านรูปเอง** — computer vision พังกับผังจริงที่มีตัวหนังสือ/เส้น/สีซ้ำ เลือกให้แอดมินวาดกรอบแทน (คนเก่งเรื่องดูรูป เครื่องเก่งเรื่องโปรยจุด)
- **พิกัดเก็บเป็นสัดส่วน 0–1 ไม่ใช่พิกเซล** — ไม่งั้นเปิดคนละจอ/รูปคนละขนาด ผังเพี้ยนทันที
- **ไม่แก้ `components/seat-map.tsx` เดิมแม้แต่บรรทัดเดียว** — สร้าง component ใหม่แยก แล้วสลับเอา คอนเสิร์ตเก่าเดินโค้ดเส้นเดิม ไม่มีทางพัง
- **สลับผังแบบครบทุกชิ้นเท่านั้น** — ขาดชิ้นใดชิ้นหนึ่งถอยไปผังตารางทั้งหน้า (ผังครึ่งรูปครึ่งตาราง = คนซื้ออ่านไม่ออก)
- **`assignZoneFrame`** — โซนที่ขายบัตรแล้วถูกด่านปฏิเสธการเจนทับตลอดไป (ถูกต้อง เพราะเจน = ลบ+สร้างใหม่) แต่แปลว่าจะไม่มีวันได้ผังรูป จึงเพิ่มทางที่แตะ **เฉพาะพิกัด** ไม่ลบ ไม่สร้าง ไม่แตะ id/ชื่อแถว/สถานะ

### 🔴 จุดที่แตะเงินจริง
ระบบจองที่นั่งด้วยล็อกใน Redis ก่อน — `Seat.status` ใน DB จะเป็น `HELD` ตอนยืนยันคำสั่งซื้อเท่านั้น
ถ้าด่านกันเจนทับดูแค่ DB จะเห็น `AVAILABLE` แล้วอนุญาต = **ลบที่นั่งออกจากใต้เท้าคนที่กำลังจ่ายเงิน**
→ ด่านต้องถาม Redis ด้วย มีเทสยืนยันเงื่อนไขนี้ตรง ๆ

### ผลทดสอบ (รันจริง 2026-08-19)
| ชุด | ผล |
|---|---|
| เทสหน่วยผังที่นั่ง | **39 ผ่าน / 0 ตก** |
| เทสรวมฝั่งแอดมิน (`pnpm test:seatmap`) | **27 ผ่าน / 0 ตก** |
| เทสรวมฝั่งคนซื้อ (`pnpm test:seatmap-buyer`) | **18 ผ่าน / 0 ตก** |
| เทสหน่วยทั้งโปรเจกต์ | **220 ผ่าน / 24 ไฟล์** |

เทสไม่ใช้ point-in-polygon ของระบบเองมาตรวจผลลัพธ์ (= เทสอ้างอิงตัวเอง) และไม่เดินผ่านหน้าห้องรอเพราะมี Turnstile ของจริง — เตรียมบัตรผ่านคิวด้วย `joinQueue()`/`admitNext()` ของระบบเองแทน

### ยังไม่ได้ทำ
- ฟีเจอร์เสริม "จิ้มสีให้ระบบเดากรอบ" (flood fill) — วางแผนไว้ให้ตัดทิ้งได้ก่อนเพื่อนถ้าเวลาไม่พอ
- รัน migration บนฐานข้อมูลจริง (Neon) — ต้องทำก่อนสาธิต
- ER diagram ([04_ER_DIAGRAM.md](04_ER_DIAGRAM.md)) ยังไม่รวม field ใหม่ — ไฟล์นั้นมีปัญหาเดิมอยู่แล้ว (ตารางผีที่ไม่มีจริง) ควรรื้อทั้งไฟล์ทีเดียวตอนทำรูปเล่ม
---

# สาย `feat/membership-presale-storefront` (พรชนก, 2026-08-20 → 23) — เขียนคู่ขนานกับสาย seatmap

> เลข Revision 18–22 ด้านล่างซ้ำกับของสาย seatmap ด้านบนเพราะสองสายแยกกันตั้งแต่ `1042f41` แล้วต่างคนต่างนับ — รวมเข้าด้วยกันที่ Revision 25

## [Revision 22 (สาย presale) — UX แบบเว็บกดบัตรจริง: คำสั่งซื้อ / นับถอยหลัง / ค้นหางาน (Phase 2.4)] — 2026-08-21

### Trigger
เจ้าของโปรเจกต์ขอให้ปรับระบบให้เหมือนเว็บกดบัตรคอนเสิร์ต/อีเวนต์จริงของแต่ละเจ้า

### ช่องโหว่ที่เจอ (และแก้)
1. 🔴 **order ที่ยังไม่จ่ายกลับไปจ่ายต่อไม่ได้เลย** — ถ้าปิดแท็บ checkout ผู้ใช้ไม่มีทางกลับเข้า order เดิม
   (ไม่มีหน้า "คำสั่งซื้อของฉัน" มีแต่หน้าตั๋วที่ต้องจ่ายเสร็จก่อนถึงจะเห็น) → ที่นั่งค้าง HELD 5 นาทีฟรี ๆ
2. ไม่มีตัวนับถอยหลังก่อนเปิดขาย/เปิดรอบ → ผู้ใช้ต้องเดาแล้วกด F5 รัว (โหลดพุ่งตอนระบบเปราะที่สุด + ไม่เป็นธรรม)
3. รายการงานเป็นลิสต์ยาวไม่มีค้นหา/กรอง

### ทำอะไรบ้าง
- **`/account/orders` (ใหม่)** — ประวัติคำสั่งซื้อ + สถานะคำนวณสดจากเวลา (`lib/order-view.ts`)
  · ปุ่ม **จ่ายเงินต่อ** กลับเข้า checkout เดิม · ปุ่ม **ยกเลิก** (คืนที่นั่งทันที ไม่ต้องรอ 5 นาที)
  · ป้ายบอกด้วยว่า order นั้นซื้อจากรอบไหน (docs/21)
  · 🔑 เคส "เงินเข้าแต่ออกตั๋วไม่ได้" แสดงเป็น **"รอทีมงานคืนเงิน"** ทับสถานะ order (ไม่งั้นผู้ใช้เห็นแค่ "ยกเลิกแล้ว")
- **นับถอยหลัง** (`lib/countdown.ts` + `components/countdown.tsx`) ใช้ที่หน้างานที่ยังไม่เปิดขาย + การ์ดรอบที่ยังไม่เริ่ม
  · ถึงศูนย์แล้ว **ยิงถาม server ครั้งเดียว** ให้ server ตัดสินว่าเปิดจริงไหม — ไม่ปลดล็อกเองจากนาฬิกาเครื่องผู้ใช้
  · tick ปรับตามระยะ (เหลือเกิน 1 วัน = นาทีละครั้ง)
- **ค้นหา/กรองงาน** (`lib/concert-filter.ts` + `components/concert-browser.tsx`)
  · ค้นได้ทั้งชื่องานและ **สถานที่** · แท็บ ทั้งหมด/กำลังขาย/เร็ว ๆ นี้/บัตรหมด พร้อมตัวเลข
  · กรองฝั่ง client ล้วน → หน้ารายการยังเป็นหน้าแคชและไม่ยิงเซิร์ฟเวอร์เพิ่มเลย
- เมนูผู้ใช้เพิ่มลิงก์ "คำสั่งซื้อของฉัน"

### ✅ Verified
- `tsc --noEmit` 0 errors · unit **361/361** ผ่าน (29 ไฟล์ — เพิ่ม 26 เคส) · lint ไม่มี warning ใหม่
- รันจริง: ค้นด้วยสถานที่ "ราชมังคลา" เจอ BTS · หน้างานที่ยังไม่เปิดขายขึ้น "อีก 2 วัน 6 ชม." ·
  **การ์ดรอบทั่วไปนับถอยหลังจาก 0:30 นาที แล้วปลดล็อกเองโดยไม่ได้รีโหลดหน้า** ·
  จองแล้วไม่จ่าย → เห็นใน /account/orders พร้อมเวลาที่เหลือ · กด "จ่ายเงินต่อ" กลับเข้า checkout ได้ ·
  กด "ยกเลิก" แล้วที่นั่งกลับเป็น AVAILABLE ทันที
- **ไม่มี migration** — ไม่แตะฐานข้อมูลเลย

---

## [Revision 21 (สาย presale) — บัตรหมด (SOLD OUT) อัตโนมัติ + รอบมาตรฐาน (Phase 2.3)] — 2026-08-20

### Trigger
เจ้าของโปรเจกต์อธิบายลำดับจริงของผังคอนไทย: ประกาศวันแสดง → เปิดรอบกดบัตร → **รอบสมาชิกกดก่อน 1–3 วัน**
→ รอบทั่วไป และ **ถ้าบัตรหมดตั้งแต่รอบสมาชิก ผู้จัดจะประกาศ sold out** (รอบทั่วไปไม่เปิดขาย)

### ปัญหาที่เจอในระบบเดิม
1. `Concert.status = SOLD_OUT` มีในฐานข้อมูลแต่ **ไม่มีโค้ดไหนตั้งค่าให้เลย** — ต้องรอแอดมินมากดเอง
2. รอบทั่วไปยังขึ้นว่า "ยังไม่เริ่ม" ทั้งที่ไม่มีบัตรเหลือ → ผู้ใช้เฝ้ารอเก้อ
3. ตั้งรอบแบบ "สมาชิกก่อน 3 วัน" ต้องกรอกฟอร์ม 2 รอบ รอบละ 8 ช่อง และคำนวณเวลาต่อกันเอง

### ทำอะไรบ้าง
- **`lib/sold-out.ts`** — นิยาม `soldOut = ไม่เหลือทั้งที่นั่งว่าง (AVAILABLE) และที่ค้างจ่าย (HELD)`
  + `syncSoldOutStatus()` ที่พลิกสถานะ **ทิศทางเดียว** `ON_SALE → SOLD_OUT`
- **hook ใน `lib/order-finalize.ts`** — เรียกหลังออกตั๋วสำเร็จ (จังหวะเดียวที่ที่นั่งกลายเป็น SOLD จริง)
  ห่อ try/catch แยกจากทรานแซกชัน: การติดป้ายสถานะห้ามทำให้ "จ่ายเงินแล้วออกตั๋วสำเร็จ" กลายเป็นล้มเหลว
- **`lib/sale-round.ts`** — เพิ่มเหตุผลปฏิเสธ `SOLD_OUT` ที่ชนะทุกเงื่อนไข (สมาชิก/พรีเมียม/มีโค้ดก็เข้าไม่ได้)
  และรอบที่ยังไม่ถึงเวลาจะกลายเป็นสถานะ `SOLD_OUT` แทน `UPCOMING`
- **UI** — แบนเนอร์ "บัตรหมดแล้ว (SOLD OUT)" ในแผงรอบ · ป้ายในหน้าคอนเสิร์ต · ซ่อนปุ่มลงทะเบียนล่วงหน้า
  · `/api/queue/join` ตอบ 403 `{"action":"SOLD_OUT"}` แยกจาก "ยังไม่เปิดขาย"
- **ปุ่มตั้งรอบมาตรฐาน** (`createStandardRounds`) — เลือกเวลาเริ่มรอบสมาชิก + กดก่อนกี่วัน แล้วได้ 2 รอบต่อกันพอดี

### ✅ Verified
- `tsc --noEmit` 0 errors · unit **335/335** ผ่าน (28 ไฟล์ — บัตรหมด 14 เคส)
- ทดสอบบนเครื่องจริง: กดปุ่มตั้งรอบได้ 21 ส.ค. → 24 ส.ค. → 31 ส.ค. (สมาชิกก่อน 3 วัน) ·
  ทำให้ที่นั่งหมดแล้ว `syncSoldOutStatus` พลิก ON_SALE → SOLD_OUT ·
  หน้าคอนเสิร์ตขึ้น SOLD OUT + ทั้งสองรอบเป็น "ไม่เปิดขาย — บัตรหมดก่อน" · เข้าคิวได้ 403 "บัตรหมดแล้ว"
- คืนสภาพข้อมูลสาธิตหลังทดสอบเรียบร้อย

---

## [Revision 20 (สาย presale) — ซับสคริปชั่น: แพ็กเกจสมาชิก (Phase 2.2)] — 2026-08-20

### Trigger
เจ้าของโปรเจกต์สั่งทำระบบซับสคริปชั่นเพื่อให้ผู้ใช้เข้าซื้อบัตรรอบสมาชิกได้
โดยเคาะเพิ่มว่า **ยังไม่เก็บเงินจริง** (ทำโครงไว้ก่อน) และให้แพ็กเกจผูกกับระดับสมาชิกที่มีอยู่

### ทำอะไรบ้าง
- **`lib/subscription.ts`** — แพ็กเกจ 6 ตัว (มาตรฐาน/พรีเมียม × 1/3/12 เดือน) + กติกาสมัคร/ต่ออายุ/ยกเลิก
  - `addMonths` บวกเดือนแบบหนีบสิ้นเดือน (31 ม.ค. + 1 เดือน = 28 ก.พ. ไม่ล้นไป 3 มี.ค.)
  - ต่ออายุ = รอบใหม่เริ่มตรงวันที่รอบเดิมจบ (วันที่เหลือไม่หาย ไม่ทับกัน)
  - อัประดับมีผลทันที · ลดระดับระหว่างรอบถูกกันไว้ · เพดานสะสมล่วงหน้า 24 เดือน
- **ตาราง `Subscription`** (ledger) แยกจาก `Membership` (สิทธิ์ปัจจุบัน) — เขียน 2 ที่ในทรานแซกชันเดียว
  ⇒ ด่านตรวจ (คิว/จอง/รอบพรีเซล) ยังอ่านจาก `Membership` ที่เดียวเหมือนเดิม ไม่ต้องแก้อะไรเลย
- **หน้าผู้ใช้ `/account/membership`** เปลี่ยนจากปุ่ม "สมัครฟรี" เดี่ยว ๆ เป็นการ์ดแพ็กเกจ 6 ใบ
  + แพ็กเกจปัจจุบัน + ประวัติการสมัคร + ปุ่มยกเลิกการต่ออายุ (การ์ดที่กดไม่ได้บอกเหตุผลตรงการ์ด)
- **หน้าแอดมิน `/admin/memberships`** โชว์แพ็กเกจปัจจุบันของผู้ใช้แต่ละคน
- **เอกสาร** [22_SUBSCRIPTION.md](22_SUBSCRIPTION.md) — รวม §6 "รอยต่อสำหรับเปิดเก็บเงินจริง" (3 จุดที่ต้องแก้
  + คำเตือนเรื่อง `slipRef` ต้องกันสลิปซ้ำข้ามตาราง `payments` กับค่าสมาชิก)

### กติกาที่ตัดสินรอบนี้
- **ยังไม่เก็บเงิน** — ทุกแพ็กเกจ 0 บาท และหน้าจอเขียนว่า "ช่วงทดลอง — ยังไม่เปิดเก็บค่าสมาชิก" ทุกการ์ด
- **ยกเลิกแล้วสิทธิ์ไม่ถูกตัดกลางคัน** — ใช้ได้จนจบรอบ (กติกาเดียวกับ "ตรวจสิทธิ์ที่ขาเข้า" ใน docs/20)
- **เลิกใช้หน้าต่างต่ออายุ 30 วัน** เปลี่ยนเป็นเพดานสะสม 24 เดือน (ไม่งั้นซื้อ 12 เดือนล่วงหน้าไม่ได้)

### ✅ Verified
- `tsc --noEmit` 0 errors · unit **321/321** ผ่าน (27 ไฟล์ — ซับสคริปชั่น 32 เคส)
- ทดสอบบนเครื่องจริง: สมัครพรีเมียม 3 เดือน → ledger เริ่มตรงวันที่รอบเดิมจบ · `Membership.expiresAt` ตรงกับรอบใหม่เป๊ะ ·
  การ์ดมาตรฐานถูกปิดเพราะเป็นพรีเมียมอยู่ · พรีเมียม 12 เดือนถูกปิดเพราะชนเพดาน 24 เดือน ·
  ยกเลิกแล้วรอบเป็น CANCELLED แต่สิทธิ์ยังอยู่ถึงวันหมดอายุเดิม

---

## [Revision 19 (สาย presale) — รอบพรีเซลหลายชั้นตามแพลตฟอร์มจริง (Phase 2.1)] — 2026-08-20

### Trigger
เจ้าของโปรเจกต์ส่งคู่มือ "การซื้อบัตรคอนเสิร์ตรอบพรีเซลด้วยระบบสมาชิก" (Live Nation Tero, Weverse, ALPHAZ,
The Concert App, All Ticket, พรีเซลบัตรเครดิต) แล้วให้ทำเพิ่มจากระบบสมาชิกเดิมให้ตรงกับเว็บกดบัตรจริง

### ทำอะไรบ้าง
- **`lib/sale-round.ts`** — ลำดับรอบ 4 ชั้น `FANCLUB → PARTNER → MEMBER_ONLY → PUBLIC` + ตัวตัดสินสิทธิ์เข้ารอบ
  (`resolveRoundEntry`) + เพดานตั๋วของรอบ + โควต้าที่นั่ง + สถานะรายรอบสำหรับหน้าจอ
- **`lib/pre-registration.ts`** — ลงทะเบียนล่วงหน้าแบบ Weverse (มีหน้าต่างเวลา, ได้โค้ด `PR-XXXXXXXX`, กดซ้ำได้โค้ดเดิม)
- **`lib/access-code.ts`** — โค้ดสิทธิ์รอบพาร์ทเนอร์ (โค้ดรวม/โค้ดจำกัดจำนวน, 1 คนใช้ซ้ำไม่ได้, นับโควต้าแบบ compare-and-set)
- **`Membership.tier`** (STANDARD/PREMIUM) — พรีเมียมเข้ารอบแฟนคลับได้ แอดมินให้เท่านั้น (ไม่ใช่ชั้นราคา)
- **ต่อเข้าเส้นทางซื้อจริง**: `app/api/queue/join` (ROUND_ENTRY), `app/actions/booking.ts` (ORDER_CREATE + เพดานตั๋วของรอบ),
  `lib/order-finalize.ts` (บันทึก `Order.saleRoundId` + โควต้าที่นั่งใต้ advisory lock ของรอบ),
  หน้าเลือกที่นั่งแสดงเพดานของรอบให้ตรงกับ server
- **หน้าจอใหม่**: แผงไทม์ไลน์รอบในหน้าคอนเสิร์ต (`components/sale-round-panel.tsx` + `GET /api/concerts/[id]/rounds`)
  และแผงตั้งรอบ/ออกโค้ดในหน้าแอดมินคอนเสิร์ต (`components/admin-sale-rounds.tsx`)
- **schema**: +3 ตาราง (`PreRegistration`, `AccessCode`, `AccessCodeRedemption`) +1 enum (`MembershipTier`)
  + คอลัมน์ใหม่ใน `SaleRound` — migration `20260820011203_presale_rounds_membership_tier` **additive ล้วน**
- **เอกสาร**: [21_PRESALE_ROUNDS.md](21_PRESALE_ROUNDS.md) ใหม่ · ER เป็น 20 models/13 enums ·
  requirements rev 5 (§2.8 P1–P10) · เล่มเพิ่ม 3.8 + 4.7

### กติกาที่ตัดสินรอบนี้
- ลอก "ลำดับรอบ" จากของจริง แต่ทำเป็น **ลำดับของช่วงเวลา ไม่ใช่คิวถ่วงน้ำหนัก** → คิวในทุกรอบยัง FIFO, ผลวิจัยเดิมไม่กระทบ
- เพดานตั๋วของรอบ **ตึงกว่าได้อย่างเดียว** (`min(concert, round)`) — กันรอบสมาชิกกลายเป็นช่องซื้อเยอะกว่าคนทั่วไป
- **ไม่ทำสมาชิกแบบเสียเงิน** แม้ของจริง (Weverse) จะเก็บรายปี — ไม่คุ้มความเสี่ยงกับทางเดินเงินจริง

### ✅ Verified
- `tsc --noEmit` 0 errors · `next lint` ไม่มี warning ใหม่ · unit **286/286** ผ่าน (26 ไฟล์)
- ทดสอบบนเครื่องจริงครบเส้นทาง: ตั้งรอบ → สมาชิกธรรมดาโดนบล็อก 403 `ROUND_LOCKED` → แอดมินให้พรีเมียม →
  ลงทะเบียนล่วงหน้าได้โค้ด → เข้าคิว → เลือก 3 ที่นั่งโดนปฏิเสธเพราะรอบจำกัด 2 → จอง 2 ที่นั่งสำเร็จ
  (order ผูก `saleRoundId`, โควต้าขึ้น 2/10) → ใช้โค้ด `MASTERCARD2026` ปลดล็อกรอบพาร์ทเนอร์
- บั๊กที่เจอตอนรันจริงและแก้แล้ว: ปุ่มลงทะเบียนล่วงหน้าโผล่ให้คนนอกกลุ่มสิทธิ์, หน้าต่างลงทะเบียนค้างในรอบที่ปิดฟีเจอร์นี้

---

## [Revision 18 (สาย presale) — ระบบสมาชิก (Membership) Phase 2] — 2026-08-20

### Trigger
แบ่งงาน 3 สาย (schema / สมาชิก / รอบขาย+ผังที่นั่ง) — รอบนี้คือสาย **"คนที่ 2 — สมาชิก" D1–D7**
schema ถูก push มาก่อนแล้วใน commit `1042f41` (Membership + SaleRound + คอลัมน์ผังจากรูป)

### ทำอะไรบ้าง
- **`lib/membership.ts`** — logic ทั้งหมดของสมาชิกอยู่ไฟล์เดียว แบ่งเป็น pure helpers (เทสง่าย) + ส่วนแตะ DB
  - สัญญากับสายรอบขาย: `isActiveMember(userId)` / `getActiveMembership(userId)` (ตกลงกันตอน D1)
  - หมดอายุคำนวณสดจาก `expiresAt` — **ไม่มี status `EXPIRED`, ไม่มี cron** (กัน "cron ไม่วิ่ง = คนหมดอายุยังเข้ารอบสมาชิกได้")
  - หน้าต่างต่ออายุ 30 วัน กันกดปุ่มรัวจนสิทธิ์ทบเป็นสิบปี
  - ต้องยืนยันอีเมล **หรือ** มี OAuth account ก่อนสมัคร (บัญชี Google มี `emailVerified = null` จึงต้องนับ account ด้วย)
- **`app/actions/membership.ts`** (ผู้ใช้สมัคร/ต่ออายุเอง) + **`app/actions/admin-membership.ts`** (แอดมินให้/ถอน/ต่อ)
  - action แอดมินทุกตัวผ่าน `assertVerifiedAdmin()` = re-check role กับ DB จริง (F2)
- **หน้าจอใหม่ 2 หน้า**: `/account/membership` (ผู้ใช้ดูสถานะ + กดสมัคร) · `/admin/memberships` (ให้สิทธิ์ด้วยอีเมล + เพิกถอน)
  - ทางเข้า: เมนูผู้ใช้ → "สมาชิก" · แดชบอร์ดแอดมิน → ปุ่ม "สิทธิ์สมาชิก"
- **เอกสาร**: [20_MEMBERSHIP.md](20_MEMBERSHIP.md) ใหม่ทั้งไฟล์ · [04_ER_DIAGRAM.md](04_ER_DIAGRAM.md) อัปเป็น 17 models
  (เพิ่ม `Membership`, `SaleRound`, `TicketReturn` ที่ค้างมาตั้งแต่ ก.ค. + คอลัมน์ผังจากรูป) ·
  [11_REQUIREMENTS.md](11_REQUIREMENTS.md) rev 4 (§2.7 M1–M11 + decision log)

### กติกาที่ตัดสินรอบนี้ (ผลกับเล่ม)
- **"สมาชิกกดก่อน" = รอบเวลาแยก ไม่ใช่สิทธิ์แซงคิว** → คิวในแต่ละรอบยัง FIFO → สถิติ fairness/inversion ในเล่มไม่ต้องวัดใหม่
- **สมาชิกไม่ได้ซื้อเยอะกว่า ไม่มีส่วนลด** → ไม่แตะ `lib/ticket-limit.ts` และไม่แตะทางเดินเงินเลยแม้แต่บรรทัดเดียว
- **ตรวจสิทธิ์ที่ขาเข้า ไม่ตรวจตอนจ่ายเงิน** → สิทธิ์หมดอายุระหว่างมี order ค้าง ผู้ใช้ยังจ่ายจบได้ ไม่กลายเป็นงานคืนเงิน

### ✅ Verified
- `tsc --noEmit` 0 errors · `next lint` ไม่มี warning ใหม่ · unit **238/238** ผ่าน (เดิม 181 + สมาชิก 57)
- ✅ **ทดสอบบนเครื่องจริงแล้ว** (Postgres/Redis ผ่าน docker compose + `migrate deploy` 2 migration ที่ค้าง):
  สมัครสมาชิกเอง → แอดมินเพิกถอน → แอดมินให้สิทธิ์ด้วยอีเมล 30 วัน → ผู้ใช้กดต่ออายุได้ 395 วัน (ต่อท้ายของเดิม) — ไม่มี error ใน log
- 🐛 **บั๊กที่เจอตอนรันจริง (แก้แล้ว)**: `grantMembershipByEmail` ใช้ `z.string().email()` ซึ่ง zod 3.24 บังคับต้องมี TLD
  → บัญชี seed `user@local` ถูกปฏิเสธทั้งที่ล็อกอินได้ (โปรเจกต์นี้จงใจไม่ใช้ `.email()` — ดู `lib/auth.ts:16`)
  แก้เป็น `min(3) + includes("@")` ตามคอนเวนชันเดิม + เพิ่ม regression test `tests/unit/admin-membership-action.test.ts` (6 เคส)

### ค้าง (ส่งต่อสาย SaleRound)
`lib/sale-round.ts` + บังคับใช้รอบตอนเข้าคิว/สร้าง order, หน้าแอดมินตั้งรอบ, ป้าย "รอบสมาชิก" ฝั่งผู้ซื้อ

---

## [Revision 17 — Security Hardening (F1–F8 + H1–H4) + Go-Live Prep] — 2026-06-04

### Trigger
หลังปิด Level 1+2 (rev16) ทำ adversarial audit ทั้ง flow จอง→จ่าย→ออกตั๋ว เจอ finding เพิ่ม + เตรียมความพร้อม production

### F1–F8 — Security audit fixes (ดูเต็มใน [15 §8](15_PAYMENT_SECURITY.md))
- **F1** rate-limit `submitSlip` 2 ชั้น (ผูก userId) กัน DoS เผาโควต้า EasySlip
- **F2** ลิมิตตั๋ว/บัญชี นับ OrderItem รวม (PAID+active) กันกักตุนข้าม order — `lib/ticket-limit.ts`
- **F3** order-sweeper ปลดที่นั่ง HELD ค้าง (on-read + `pnpm sweep`) — `lib/order-sweeper.ts`
  - 🔧 root cause: `OrderItem.seatId` unique แต่ flow ยกเลิกไม่เคยลบ OrderItem → จองใหม่ไม่ได้ แก้โดยลบตอน cancel/sweep
- **F4** queue token ผูก userId — `isAdmitted(token,concertId,userId)` กันแชร์ token
- **F5** receiver match เทียบเต็มถ้า unmasked — `lib/slip-match.ts`
- **F6** parse เวลาสลิปเติม `+07:00` ถ้าไม่มี TZ — `lib/slip-date.ts`
- **F7** จำกัดขนาด/ชนิดรูปสลิป — `lib/slip-image.ts`
- **F8** ลบ dead import (พึ่ง unique constraint แทน hard-block — กัน "จ่ายแล้วไม่ได้ตั๋ว")

### H1–H4 — Production hardening (ปิด fail-open เงียบ ๆ)
- **H1** Turnstile fail-closed บน production (เดิม fallback test key = CAPTCHA ปิดเงียบ)
- **H2** boot-guard เตือนถ้า production แต่ไม่ตั้ง Turnstile
- **H3** `slipRef` ไม่มี transRef = ปฏิเสธ (กัน NULL ทำ dedup T4 หลุด)
- **H4** `/api/behavior` เพิ่ม rate-limit 60/นาที

### Go-live prep (รอบนี้ 2026-06-04)
- **Resend ส่งอีเมลจริง** — `lib/email.ts` (REST API ผ่าน fetch ไม่เพิ่ม dep) + wire `app/actions/auth.ts` แทน `console.log` stub
- เพิ่ม `pnpm db:deploy` (`prisma migrate deploy`) สำหรับ production migration
- `.gitignore` กัน `*.exe`/`*.zip`/`.claude` lock+local (กัน junk 631MB หลุดเข้า history)
- เอกสารใหม่ [17_GO_LIVE_CHECKLIST.md](17_GO_LIVE_CHECKLIST.md) — รวม blocker + credential ที่ต้องขอเอง

### 🆕 Adversarial audit findings ที่ docs เดิมไม่เคยลิสต์ (รอปิด)
- **N1 (HIGH)** `submitSlip` transaction ไม่มี status guard → concurrency อาจ resurrect CANCELLED order เป็น PAID + จองที่นั่งซ้ำ (unit test จับไม่ได้ — ไม่มี integration/concurrency test)
- **N3 (MED)** `cancelOrder` race กับ submitSlip; **N5 (MED)** admin read page ไม่มี server-side role check (พึ่ง middleware); **N4 (MED)** behavior Layer 2 เก็บคะแนนแต่ไม่ enforce
- go-live blocker ใหม่: `NEXTAUTH_URL=localhost`, sweeper cron ยังไม่ schedule, ไม่มี app container, `migrate dev` แทน `deploy`
- รายละเอียด + action ทั้งหมดอยู่ใน [17_GO_LIVE_CHECKLIST.md](17_GO_LIVE_CHECKLIST.md) §4
- ✅ **แก้แล้วรอบนี้: N1, N3, N4, N5** — N1/N3 แยกเป็น `lib/order-finalize.ts` (interactive `$transaction` + conditional claim order `PENDING`+`expiresAt>now`→PAID / seats `HELD`→SOLD, rollback ถ้าไม่ครบ; เงินเข้าแต่ออกตั๋วไม่ได้ → log `REFUND NEEDED`). N5 = `app/(admin)/layout.tsx` server-side role guard. N4 = escalate-only ใน `app/api/queue/join` (spoof-resistant). เหลือ N2/N7/N8/N11 (LOW)

### ✅ Verified
- `tsc --noEmit` 0 errors (รวมหลัง wire Resend + order-finalize) · unit **62/62** ผ่าน (8 ไฟล์) · **concurrency test `scripts/test-n1-race.ts` 7/7** (Postgres จริง: race finalize↔cancel 25 รอบ + expired + seat-freed + double-finalize) · fix F1–F7/H1/H3/H4/F4 ยืนยัน wire เข้า request path จริงทุกตัว (call-graph trace)

---

## [Revision 16 — Payment Security Hardening (Level 1 + 2)] — 2026-06-03

### Trigger
User ทดสอบแล้วพบ: ระบบจ่ายเงิน **กดยืนยันผ่านได้โดยไม่ต้องแนบสลิป + ไม่ตรวจเงินจริง** (มีช่องอัปโหลดแต่ไม่บังคับ)

### Root cause (ช่องโหว่)
1. `verifySlip()` ใน dev mode (ไม่มี `EASYSLIP_API_KEY`) **return success เสมอโดยไม่แตะรูปสลิป** + ยัดยอดให้ตรง → กดจ่ายโดยไม่มีสลิป = ได้ตั๋วฟรี
2. สลิป `optional` ทุกชั้น (client ปุ่มไม่ disable, server schema optional)
3. production path ไม่เช็ค **receiver** → แนบสลิปที่โอนหาคนอื่นยอดเท่ากันก็ผ่าน
4. fail-**open**: ถ้า deploy ลืม key = แจกตั๋วฟรีทั้งระบบ

### วิธีแก้ (full hardening — Level 1 + 2)
- **บังคับแนบสลิป 3 ชั้น** (client disable ปุ่ม / server `.min(1)` / `verifySlip` guard)
- **fail-closed**: prod ไม่มี key = ปฏิเสธ; dev = mock (ยังบังคับสลิป) + เตือน
- **receiver check** (`lib/slip-match.ts`): เทียบเลขท้าย 4 ของบัญชีปลายทาง กับ `PROMPTPAY_ID` (T5)
- **freshness check** (`lib/slip-freshness.ts`): เวลาโอนต้องอยู่ในช่วง order — กันสลิปเก่า (T6)
- env เพิ่ม `EASYSLIP_API_KEY`, `PROMPTPAY_ID`, `PAYMENTS_RECEIVER_CHECK`, `PAYMENTS_FRESHNESS_CHECK` + boot warning
- ใส่ `EASYSLIP_API_KEY` จริงของ user ลง `.env` (gitignore ครอบ — ไม่ฮาร์ดโค้ด)

### 🐛 Bug เจอตอนเขียน test + แก้
- helper เช็ค receiver เดิมใช้ regex จับ "เลขชุดท้ายสุด" → พังกับ mask แบบ `xxx-x-x1234-5` (ได้แค่ "5")
- แก้เป็น "ดึงเลขทั้งหมดแล้วเทียบ 4 ตัวท้าย" — unit test จับได้ก่อน ship

### ✅ Verified
| Test | ผล |
|---|---|
| `tests/unit/slip-match.test.ts` (receiver, รวมเคส attack) | ✅ 10/10 |
| `tests/unit/slip-freshness.test.ts` (กันสลิปเก่า) | ✅ 9/9 |
| unit รวมทั้งโปรเจกต์ | ✅ 28/28 |
| `tsc --noEmit` | ✅ 0 errors |

### หมายเหตุ thesis
- เอกสารเต็ม: [15_PAYMENT_SECURITY.md](15_PAYMENT_SECURITY.md) (threat model T1–T10 + defense levels)
- **Level 3 (gateway webhook) = future work** — ดู §6 ของ doc 15 (เลิกเชื่อสลิปจากลูกค้า ใช้ธนาคารยืนยันเงินเข้าเอง)
- จุดขายในเล่ม: อธิบาย trade-off ว่า slip-based เป็น "zero-cost MVP" แต่ production ควร gateway-confirmed

---

## [Revision 15 — Per-Identity Fairness: 1 บัญชี = 1 slot] — 2026-06-02

### Trigger
User สังเกตช่องโหว่: account เดียวเปิดหลายหน้าจอรุมกดบัตร = ไม่ fair → ขอให้ปิด (ระดับ 1)

### ปัญหา (Sybil / multi-tab attack)
เดิมระบบผูกคิวกับ token/fingerprint → เปิด 10 แท็บ = 10 slot = คนหลายมือชนะคนมือเดียว
นี่คือช่องโหว่ fairness ที่ใหญ่ที่สุดที่เหลืออยู่ (และเป็นช่องที่บอท multi-instance ใช้)

### วิธีแก้: 1 identity = 1 slot ต่อคอนเสิร์ต
- เพิ่ม dedup key ใน Redis: `queue:{concertId}:user:{userId}` (ถ้า login) หรือ `:fp:{fingerprint}` (ถ้าไม่ login)
- `joinQueue()` เช็คก่อน: ถ้า identity มี slot อยู่แล้ว → คืน token เดิม (`deduped:true`) ไม่สร้างใหม่
- ใช้ `SET NX` กัน race จาก 2 แท็บที่ยิงพร้อมกันเป๊ะ — ถ้าชิงไม่ได้ ถอย token แล้วคืนของผู้ชนะ
- `leaveQueue()` ลบ slot key ด้วย (เฉพาะถ้าชี้ token นั้นจริง) เพื่อให้เข้าคิวใหม่ได้

### UI: Perceived Fairness (ทำให้ "รู้สึก" fair ด้วย ไม่ใช่แค่ fair จริง)
เพิ่มกล่อง "ระบบนี้ยุติธรรมอย่างไร" ในห้องรอ:
- ไม่เอื้อคนเน็ตเร็ว (สุ่มในช่วงเวลาเดียวกัน)
- 1 บัญชี = 1 คิว (เปิดหลายแท็บไม่ช่วย)
- ไม่มีทางลัด/จ่ายเงินแซง

### 🐛 Bug เจอตอนทดสอบ + แก้
- dedup คืน token เดิม แต่ route ยัง `prisma.queueToken.create` ซ้ำ → ชน unique constraint → 500
- แก้: ข้าม create audit ถ้า `result.deduped === true`

### ✅ Verified จริง (Redis + HTTP + DB)
| Test | ผล |
|---|---|
| account เดียว 10 แท็บ (Redis logic) | ✅ ได้ 1 slot, คิวมี 1 คน |
| 5 คนต่างกัน | ✅ ได้ 5 slot (คนจริงไม่กระทบ) |
| account เดียว 3 แท็บ ผ่าน HTTP จริง | ✅ token เดียวกันทั้ง 3 (tab1 deduped:false, tab2-3 deduped:true) |
| queue size / queue_tokens DB | ✅ = 1 ทั้งคู่ (ไม่ซ้ำ) |
| `tsc --noEmit` | ✅ 0 errors |

### หมายเหตุ thesis
- ศัพท์วิชาการของช่องโหว่นี้คือ **Sybil attack** (1 คนปลอมเป็นหลายคน) — ควรเขียนในเล่มหัวข้อ "Per-Identity Fairness & Sybil Resistance"
- ระดับ 2 (1 เบอร์ = 1 slot ผ่าน OTP) ยังเป็น future work — fingerprint/account dedup กันได้ระดับหนึ่ง แต่เปลี่ยน device/ลบ cookie ยังหลบได้

### Action ต่อไป (ถ้าต้องการ)
- regenerate เล่ม thesis เพิ่มหัวข้อ Sybil resistance + perceived fairness
- หรือทำระดับ 2 (OTP เบอร์โทร)

---

## [Revision 14 — รูปเล่มปริญญานิพนธ์ Word (บท 1-5)] — 2026-06-02

### Trigger
User ขอทำรูปเล่ม Word/PDF → เลือก "ปริญญานิพนธ์ทางการ บท 1-5 รูปแบบมาตรฐานทั่วไป"

### ไฟล์ใหม่
- `ปริญญานิพนธ์-ระบบจองบัตรคอนเสิร์ต.docx` (root) — รูปเล่มทางการ
- `scripts/gen-thesis.mjs` — generator (docx-js) สร้างไฟล์นี้ (regenerate ได้)

### โครงสร้างเล่ม (academic ไทย, TH Sarabun New 16pt, A4, เลขหน้า)
- หน้าปก (ไทย+อังกฤษ)
- บทคัดย่อ + คำสำคัญ
- สารบัญ (auto TOC)
- บทที่ 1 บทนำ (ความเป็นมา/วัตถุประสงค์ 4/ขอบเขต/ประโยชน์/เครื่องมือ)
- บทที่ 2 ทฤษฎีและงานวิจัยที่เกี่ยวข้อง (behavior/CAPTCHA/fingerprint/queue/lock + อ้างพรชนก 2567)
- บทที่ 3 วิธีการดำเนินงาน (สถาปัตยกรรม/ER/fairness/anti-bot/seat-lock + ตาราง)
- บทที่ 4 ผลการทดสอบ (ตาราง 4.1-4.5: fairness 96.8%, no-double-booking, anti-bot, เทียบวิจัยเดิม)
- บทที่ 5 สรุปผล + ข้อจำกัด + ข้อเสนอแนะ
- บรรณานุกรม (พรชนก + งานที่เกี่ยวข้อง + Cloudflare/OWASP/Redis/Next.js)

### Verified
- docx-js generate สำเร็จ — 206 paragraphs, unpack XML valid
- เนื้อหาครบ: บท 1-5 + บทคัดย่อ + สารบัญ + บรรณานุกรม + ผลตัวเลขจริง (96.8% พบ 3 จุด)
- ติดตั้ง: docx (pnpm), defusedxml + lxml (pip) สำหรับ validate

### ⚠️ ข้อจำกัด
- **PDF แปลงบนเครื่องนี้ไม่ได้** — LibreOffice ไม่ได้ติดตั้ง → user เปิด .docx ใน Word/Google Docs แล้ว Save as PDF เอง (หรือ choco install libreoffice)
- ฟอนต์ TH Sarabun New ต้องมีในเครื่องที่เปิด (ราชการไทยมีอยู่แล้วส่วนใหญ่) — ถ้าไม่มี Word จะ fallback
- **ยังไม่มี:** หน้าอนุมัติ/กิตติกรรมประกาศ/สารบัญตาราง-รูป/screenshots (เป็น academic prose + เนื้อหาเทคนิคครบ)
- ถ้ามหาลัยมี template เฉพาะ → ก๊อปเนื้อหาใส่ template ได้ หรือส่ง template มาให้ Claude ปรับ

### หมายเหตุ
รายละเอียดเล็ก ๆ เก็บครบในระดับ "เนื้อหา + ผลทดสอบจริง" แต่ส่วนพิธีการของเล่ม (ปก อนุมัติ ฯลฯ)
ขึ้นกับ template มหาลัย — แจ้งได้ถ้าต้องการให้เพิ่ม

---

## [Revision 13 — Phase 10 Documentation ✅ โปรเจ็คเสร็จครบ 11/11] — 2026-06-02

### Trigger
User พิมพ์ `approve 10` → เอกสาร thesis (phase สุดท้าย)

### ✅ Production Build ผ่าน (verify ก่อนเขียน docs)
- `next build` สำเร็จ — **22 routes** generate ครบ, middleware 82.9 kB, ไม่มี error
- ยืนยันว่า production พร้อม deploy (ไม่ใช่แค่ dev)

### ไฟล์ใหม่
- `docs/13_THESIS_EVALUATION.md` — **บทผลการทดลอง**: abstract ร่าง + ผลทุก phase + ตารางตัวเลขจริง
  (fairness inversion, race guard, anti-bot 3-tier, behavior, rate limit, unit test) + เปรียบเทียบวิจัยเดิม + limitations + conclusion
- `docs/14_SCREENSHOTS_GUIDE.md` — คู่มือถ่ายภาพ 14 หน้า + demo script 5 นาที + คำสั่งเก็บผล + multi-device

### ไฟล์แก้
- `docs/00_README.md` — อัป index: เพิ่ม doc 13-14 + ตารางสถานะ 11/11 phases เสร็จ

### 🎓 เอกสารพร้อมทำรูปเล่ม thesis
ครบทุกส่วนที่อาจารย์ต้องการ:
- บทนำ/ขอบเขต → `01_PLAN`, `11_REQUIREMENTS`
- ทฤษฎี/วิจัยอ้างอิง → `06_RESEARCH_SUMMARY`
- การออกแบบ → `04_ER_DIAGRAM` (14 tables), `05_DIAGRAMS` (use case/sequence/architecture)
- เครื่องมือ → `03_TOOLS_AND_VERSIONS`
- **ผลการทดลอง → `13_THESIS_EVALUATION`** (ตัวเลขจริงทั้งหมด)
- ภาพประกอบ → `14_SCREENSHOTS_GUIDE`

### 🏁 สรุปโปรเจ็ค (11/11 phases verified)
ระบบจองบัตรคอนเสิร์ต anti-bot + fairness ทำงานครบ end-to-end:
**คอนเสิร์ต → คิวเป็นธรรม → anti-bot 2 ชั้น → จองกัน race → จ่ายเงิน PromptPay → ตั๋ว → admin dashboard**
- ต้นทุน 0 บาท/เดือน, เงินเข้าจริงผ่าน PromptPay
- ทุก PK เป็น BigInt (ตามที่ user ขอ id เป็นตัวเลข)
- verified ทุก phase ด้วยการรันจริง (HTTP/DB/Redis) — ไม่ใช่แค่เขียน
- production build ผ่าน

### Action ต่อไป (ถ้าต้องการ)
- ถ่าย screenshots ตาม `14_SCREENSHOTS_GUIDE.md` → ใส่เล่ม
- ตั้ง EASYSLIP_API_KEY + PROMPTPAY_ID + Turnstile key จริง (ถ้าจะ demo เงินเข้าจริง)
- ทำรูปเล่มจาก docs/ (Claude ช่วย export เป็น Word/PDF ได้ถ้าขอ)

---

## [Revision 12 — Phase 9 Testing + Load Test ✅ verified] — 2026-06-01

### Trigger
User พิมพ์ `approve 9` → Unit tests + Load test (หลักฐานสำคัญสุดของ thesis)

### ไฟล์ใหม่
- `vitest.config.ts` — config (node env, path alias @/)
- `tests/unit/behavior.test.ts` — 5 tests: behavior analyzer (human/bot/keyboard-nav/clamp)
- `tests/unit/fairness.test.ts` — 4 tests: fairness scoring (bucket order, random within bucket, no-tie, uniform distribution)
- `tests/load/queue.js` — k6 load script (ramping 500 VUs, thresholds p95<2s, success>95%) — รันถ้า user ลง k6
- `tests/load/concurrent-fairness.mjs` — Node load test (ไม่ต้องลง k6) พิสูจน์ fairness + no double-booking

### 🧪 ผล Unit Tests: 9/9 ผ่าน
- fairness 4/4 — พิสูจน์เชิงคณิตศาสตร์: คนข้าม bucket มาก่อนได้ก่อน, คนใน bucket เดียวกันลำดับขึ้นกับ random
- behavior 5/5 — human score 0, bot score ≥60, keyboard-nav ไม่ถูก flag (กัน false positive)

### 📊 ผล Load Test (วัตถุดิบ thesis — กราฟ/ตารางใส่ปริญญานิพนธ์ได้เลย)
| Test | 500 คน | 2000 คน |
|---|---|---|
| เวลา join (concurrent) | 34ms (0.07ms/คน) | 113ms (0.06ms/คน) |
| **Inversion rate** (fairness) | 94.0% | 96.8% |
| **Double-booking** (race) | 1/500 winner | 1/2000 winner |

→ **Fairness:** inversion ~95% = ลำดับสุ่มเกือบสมบูรณ์ ไม่ลำเอียงตามเวลามา (ถ้าเรียงตามเวลา inversion จะ ~0%)
→ **No double-booking:** N คนแย่งที่นั่งเดียว ได้แค่ 1 คนเสมอ (atomic SET NX)
→ **Scale:** join time เพิ่มเชิงเส้น (0.06ms/คน คงที่) = รับโหลดได้

**HTTP load (full stack จริง, 50 concurrent/IP เดียว):** 10×200 + 40×429
→ rate limit (10/นาที/IP) ทำงานถูกต้อง — กันยิงรัวได้จริงตอนโหลดสูง (จริงคนละ IP จะผ่านหมด)

### ✅ Verified
- `pnpm exec vitest run` → 9/9 passed
- load test 500 + 2000 คน → fairness + no-double-booking PASS
- `tsc --noEmit` ✅ 0 errors

### หมายเหตุสำหรับ user
- k6 ยังไม่ได้ติดตั้ง — ถ้าอยากรัน `tests/load/queue.js` (HTTP load จริงผ่าน k6): `choco install k6` แล้ว `pnpm test:load`
- Node load test (`concurrent-fairness.mjs`) รันได้เลยไม่ต้องลงอะไรเพิ่ม

### Action ต่อไป
- `approve 10` → Thesis docs (capture screenshots + เขียน evaluation + รวมผล load test เป็นบทวิเคราะห์)
- หรือ `build` → production build verify
- เหลือ phase สุดท้าย (10/11)!

---

## [Revision 11 — Phase 8 Admin Dashboard ✅ verified] — 2026-06-01

### Trigger
User พิมพ์ `approve 8` → Admin dashboard รวมสถิติทุก phase + bot log viewer + sales report

### ไฟล์ใหม่
- `lib/admin-stats.ts` — stats service: getOverviewStats / getBotEvents / getBehaviorStats / getSalesReport / getLiveQueueStats
- `app/(admin)/admin/bot-log/page.tsx` — Bot Detection Log viewer + filter (ALLOW/CHALLENGE/BLOCK) + behavior summary
- `app/(admin)/admin/sales/page.tsx` — Sales report (รายได้/อัตราขายต่อคอนเสิร์ต + progress bar)

### ไฟล์แก้
- `app/(admin)/admin/page.tsx` — rewrite dashboard: รายได้รวม + bot stats (ALLOW/CHALLENGE/BLOCK) + queue real-time + ลิงก์รายงาน

### 📊 Metrics สำหรับ thesis (ดึงจากข้อมูลที่เก็บทุก phase)
- **Anti-bot:** block rate / challenge rate / allow count (จาก bot_events)
- **Behavior:** human vs bot count + ค่าเฉลี่ย feature เปรียบเทียบ (entropy/variance/dwell) — human vs bot
- **Sales:** revenue + sold rate ต่อคอนเสิร์ต
- **Queue:** waiting/admitted real-time จาก Redis

### ✅ Verified ผ่าน HTTP จริง
| Test | ผล |
|---|---|
| `/admin` (admin login) | ✅ 200 + รายได้รวม + bot stats |
| `/admin/bot-log` | ✅ 200 + แสดง 26 ALLOW / 4 CHALLENGE / 4 BLOCK (จาก test phase 5-7) + Behavior Analysis |
| `/admin/sales` | ✅ 200 |
| user role เข้า admin ทุกหน้า | ✅ 307 blocked (RBAC ครอบครบ) |
| `tsc --noEmit` | ✅ 0 errors |

### ⚠️ ยังเหลือ
- Phase 9: Test (Vitest unit + Playwright E2E) + **Load test k6** (10k concurrent — หลักฐานสำคัญสุดใน thesis)
- Phase 10: Thesis docs (screenshots + evaluation + เขียนผลวิเคราะห์)

### Action ต่อไป
- `approve 9` → Testing + Load test (พิสูจน์ระบบรับโหลด + fairness ตอนคนเยอะ — วัตถุดิบ thesis)
- หรือ `build` → production build verify ก่อน
- dev: http://localhost:3000 (admin@local/Admin123! → /admin)

---

## [Revision 10 — Phase 7 Seat Hold + Payment ✅ verified] — 2026-06-01

### Trigger
User พิมพ์ `approve 7` → Distributed lock (กัน race) + PromptPay QR + EasySlip verify + issue tickets

### 🔒 หัวใจ: Distributed Lock กัน Race Condition (thesis material)
**ปัญหา:** 2 คนกดที่นั่งเดียวกันพร้อมกัน → ถ้าไม่ป้องกัน ทั้งคู่จองได้ = ที่นั่งซ้ำ
**วิธีแก้:** Redis `SET key value NX EX 300` (atomic compare-and-set)
- คนแรกที่ SET ได้ = ได้ที่นั่ง, คนที่สอง NX fail (คืน null) = ต้องเลือกใหม่
- TTL 5 นาที → ไม่จ่ายใน 5 นาที lock หลุดเอง ที่นั่งคืน (กันค้าง)
- release ผ่าน Lua script: del เฉพาะถ้า value = ตัวเอง (กันปล่อย lock คนอื่น)
- hold หลายที่นั่ง = all-or-nothing (fail 1 → rollback ทั้งหมด)

**ทำไม Redis ไม่ใช่ DB lock:** เร็วกว่า ~100x (in-memory) + TTL auto-expire + atomic ในตัว

### ไฟล์ใหม่
- `lib/seat-hold.ts` — distributed lock: holdSeats / releaseSeats / isHeldBy / getHeldSeats (Lua release)
- `lib/promptpay.ts` — generate PromptPay QR (EMVCo payload + render PNG data URL)
- `lib/easyslip.ts` — verify สลิป (dev mode = mock pass; prod = EasySlip API)
- `app/actions/booking.ts` — holdAndCreateOrder / submitSlip / cancelOrder
- `app/(public)/checkout/[orderId]/page.tsx` + `components/checkout-client.tsx` — QR + countdown 5 นาที + upload สลิป
- `app/(public)/account/tickets/page.tsx` — ตั๋วของฉัน + QR เข้างาน

### ไฟล์แก้
- `prisma/schema.prisma` — เพิ่ม Payment + Ticket models + enums (PaymentMethod/Status) + relations
- `components/seat-map.tsx` — กด "ดำเนินการชำระเงิน" → holdAndCreateOrder จริง → /checkout; แสดง HELD จาก Redis
- `app/(public)/concerts/[slug]/seats/page.tsx` — overlay HELD seats จาก Redis (real-time)

### Migration
- `add_payment_ticket` — ตาราง payments + tickets

### ✅ Verified จริง (Redis + DB + HTTP)
| Test | ผล |
|---|---|
| **2 user hold ที่นั่งเดียวกันพร้อมกัน** | ✅ winners=1 (กัน race ได้!) |
| ปล่อย lock ด้วย user ผิด | ✅ ปฏิเสธ (Lua protected) |
| ปล่อย lock ด้วยเจ้าของ | ✅ สำเร็จ |
| **Full booking flow** (hold→order→verify slip→issue) | ✅ 2 ตั๋วออก + 2 SOLD + order PAID + payment SUCCESS |
| seats page (admitted token) | ✅ 200 |
| account/tickets ไม่ login | ✅ 307 redirect |
| `tsc --noEmit` | ✅ 0 errors |
| reset หลัง test | ✅ 160 ที่นั่ง available คืน |

### 👤 User ต้องทำเพื่อใช้เงินจริง (production)
- ตั้ง `PROMPTPAY_ID` = เบอร์/เลข ปชช. (เปิด PromptPay กับบัญชี — ฟรี)
- สมัคร EasySlip → ตั้ง `EASYSLIP_API_KEY` (ฟรี 500/เดือน)
- ถ้าไม่ตั้ง → dev mode: QR ใช้ placeholder + verify ผ่านทันที (ทดสอบ flow ได้ไม่ต้องโอนจริง)

### ⚠️ ยังเหลือ
- Phase 8: Admin dashboard (bot_events + sales report + queue stats)
- Phase 9: Test (Vitest/Playwright) + Load test (k6 10k concurrent)
- Phase 10: Thesis docs (screenshots + evaluation)
- slip image ยังไม่ได้ upload เข้า MinIO (เก็บแค่ ref — เพิ่มได้ภายหลัง)

### Action ต่อไป
- `approve 8` → Admin Dashboard (รวมสถิติ bot/sales/queue) — ใกล้จบแล้ว!
- dev: http://localhost:3000 (login: user@local/Password123! เพื่อทดลองจอง)

---

## [Revision 9 — Phase 6 Anti-Bot Layer 2 (Behavior + Rate Limit) ✅ verified] — 2026-06-01

### Trigger
User พิมพ์ `approve 6` → Behavior analysis + Rate limit — จับบอทที่ผ่าน Turnstile/UA ได้

### 🧠 หลักการ Behavior Analysis (thesis material)
มนุษย์ vs บอท ต่างกันที่ "ความเป็นธรรมชาติ" ของการเคลื่อนไหว:
- **มนุษย์:** ขยับเมาส์เยอะ + เป็นเส้นโค้ง (entropy สูง) + timing ไม่สม่ำเสมอ (variance สูง) + dwell นาน
- **บอท:** เคลื่อนเส้นตรง/teleport (entropy ต่ำ) + timing สม่ำเสมอเป๊ะ (variance ต่ำ) + เร็วผิดมนุษย์

**Features (คำนวณฝั่ง client, ส่ง feature สรุปไม่ใช่ raw — privacy):**
- mouseMoveCount, keyPressCount, mouseTimingVariance (variance ของ inter-event time), mousePathEntropy (Shannon entropy ของทิศทาง 8 ทิศ normalize 0-1), dwellTimeMs

**Scoring (ไม่ block เดี่ยว — เป็น signal เสริม):** ขยับน้อย +30 · dwell สั้น +25 · variance ต่ำ +25 · entropy ต่ำ +20 → isLikelyBot เมื่อ ≥60

### ไฟล์ใหม่
- `lib/rate-limit.ts` — Redis sliding-window rate limiter (ZSET — แม่นกว่า fixed-window)
- `lib/behavior.ts` — `analyzeBehavior()` วิเคราะห์ features → score 0-100
- `lib/use-behavior-tracker.ts` — hook เก็บ mouse/key ฝั่ง client + คำนวณ variance/entropy + flush
- `app/api/behavior/route.ts` — POST รับ features → วิเคราะห์ → upsert `BehaviorSession`

### ไฟล์แก้
- `prisma/schema.prisma` — เพิ่ม model `BehaviorSession` (features + behaviorScore + isLikelyBot)
- `app/api/queue/join/route.ts` — เพิ่ม rate limit 10 ครั้ง/นาที/IP (429 ถ้าเกิน)
- `components/waiting-room.tsx` — ผูก `useBehaviorTracker` (sessionKey = fingerprint), flush ก่อนออกจากห้องรอ

### Migration
- `add_behavior_session` — ตาราง `behavior_sessions`

### ✅ Verified ผ่าน HTTP + DB จริง
| Test | features | score | isLikelyBot | ผล |
|---|---|---|---|---|
| มนุษย์ | move 120, var 850, entropy 0.72, dwell 8500 | 0 | false | ✅ |
| บอท simulate เมาส์ (เส้นตรง) | move 50, var 8, entropy 0.05, dwell 400 | **70** | **true** | ✅ จับได้! |
| บอทไม่ขยับเมาส์ | move 0, dwell 150 | 55 | false | ✅ (น่าสงสัยแต่ไม่ฟันธง — กัน false positive คน keyboard-nav) |
| **Rate limit** ยิง 13 ครั้ง/นาที | limit 10 | — | — | ✅ ครั้ง 1-10=200, 11-13=**429** |

→ behavior_sessions เก็บ dataset ครบ (human score 0 vs bot 70 แยกชัด) พร้อม thesis
- `tsc --noEmit` ✅ 0 errors

### ⚠️ ยังเหลือ
- Phase 7: seat hold lock (Redis SETNX) + payment (PromptPay + EasySlip) — ทำให้จองจริงตัดที่นั่ง
- Phase 8: admin dashboard รวม bot_events + behavior_sessions
- behavior score ยังไม่ feedback กลับเข้า queue join (เก็บ + วิเคราะห์อย่างเดียว) — ถ้าจะ enforce ต้องรอ client ส่งก่อน (trade-off UX)

### Action ต่อไป
- `approve 7` → Seat Hold + Payment (distributed lock กัน race + PromptPay QR + EasySlip verify)
- dev: http://localhost:3000

---

## [Revision 8 — Phase 5 Anti-Bot Layer 1 ✅ verified] — 2026-06-01

### Trigger
User พิมพ์ `approve 5` → Anti-Bot Layer 1 (Turnstile + fingerprint + UA/header scoring) ที่ด่านเข้าคิว

### 🛡️ ปรัชญา: Scoring ไม่ใช่ binary block (สำคัญต่อ requirement "คนจริงทุกแบบเข้าได้")
รวมหลายสัญญาณเป็นคะแนน 0-100 แล้วตัดสิน 3 ระดับ — ไม่ block จากสัญญาณเดียว (กัน false positive):
- **score < 40 → ALLOW** เข้าคิวได้เลย
- **40-69 → CHALLENGE** ขอทำ Turnstile (ไม่ block — คนจริงทำ CAPTCHA แล้วผ่าน)
- **>= 70 → BLOCK** ปฏิเสธ (มั่นใจว่าบอท)

**Signals Layer 1:** Turnstile result (หนักสุด ±55) · User-Agent heuristics (bot keyword +50, empty +35) · Header completeness (+15) · Fingerprint presence (+10)

### ไฟล์ใหม่
- `lib/turnstile.ts` — Cloudflare Turnstile verify (dev ใช้ test key always-pass, ฟรี ไม่ track)
- `lib/antibot.ts` — scoring engine: `assessRequest()` รวม 4 signals → score + action
- `lib/use-fingerprint.ts` — hook FingerprintJS OSS (client)
- `components/turnstile-widget.tsx` — Turnstile checkbox (explicit render)

### ไฟล์แก้
- `prisma/schema.prisma` — เพิ่ม model `BotEvent` (score/action/signals JSON/checkpoint) + enum `BotAction`
- `app/api/queue/join/route.ts` — เรียก `assessRequest()` ก่อนเข้าคิว, log ทุก event, return 403(BLOCK)/428(CHALLENGE)/200(ALLOW)
- `components/waiting-room.tsx` — เก็บ fingerprint → join → ถ้า 428 แสดง Turnstile widget → retry พร้อม token; ถ้า 403 แสดงหน้า blocked
- `app/(public)/concerts/[slug]/queue/page.tsx` — ส่ง turnstileSiteKey ให้ widget
- `package.json` — เพิ่ม @fingerprintjs/fingerprintjs 4.5.1

### Migration
- `add_bot_event` — ตาราง `bot_events` (PK BigInt, signals เป็น jsonb)

### ✅ Verified ผ่าน HTTP + DB จริง (3 เคส)
| เคส | Input | score | action | HTTP |
|---|---|---|---|---|
| คนจริง | browser UA + fingerprint + turnstile | 0 | ALLOW | ✅ 200 (ได้ token) |
| บอท | `python-requests` ไม่มีอะไร | 100 | BLOCK | ✅ 403 |
| น่าสงสัย | browser ปกติ ไม่มี turnstile/fp | 50 | CHALLENGE | ✅ 428 |

→ bot_events audit เก็บครบ signals ทุก request (ALLOW/CHALLENGE/BLOCK = 1/1/1) พร้อมทำ dashboard + thesis
- `tsc --noEmit` ✅ 0 errors

### ⚠️ ยังเหลือ
- Phase 6: Behavior analysis Layer 2 (mouse/keystroke/scroll entropy) — เก็บ raw event ไปวิเคราะห์ลึก
- Phase 7: seat hold lock + payment
- Turnstile ตอนนี้ใช้ test key (always-pass) — production ต้องขอ key จริงจาก Cloudflare (ฟรี)

### Action ต่อไป
- `approve 6` → Anti-Bot Layer 2 (behavior analysis + rate limit) — เก็บพฤติกรรมเมาส์/คีย์ จับบอทที่ผ่าน Turnstile ได้
- dev: http://localhost:3000

---

## [Revision 7 — Phase 4 Queue/Fairness ✅ verified] — 2026-06-01

### Trigger
User พิมพ์ `approve 4` → สร้าง Virtual Waiting Room + fairness queue บน Redis

### 🎯 หัวใจ: กลไกความเป็นธรรม (Fairness) — ใช้ใน thesis ได้
**ปัญหา:** จัดคิวด้วย timestamp ระดับ ms → คนเน็ตเร็ว/ใกล้ server/กดเร็วได้เปรียบ = ไม่ยุติธรรม
**วิธีแก้ (time-bucket + random):**
- แบ่งเวลาเป็น bucket ละ 2 วินาที → ทุกคนใน bucket เดียวกันถือว่า "มาพร้อมกัน"
- ลำดับภายใน bucket ตัดสินด้วย `crypto.randomInt()` ไม่ใช่เวลามาจริง
- `fairScore = bucket * 1,000,000 + randomScore` (เก็บใน Redis ZSET + audit ใน DB)
- ผล: ข้าม bucket = ยุติธรรมเชิงเวลาหยาบ (มาก่อนได้ก่อน), ใน bucket = สุ่มล้วน (ความเร็ว ms ไม่มีผล)

**หลักฐานจริง (verified):** ส่ง 8 request พร้อมกัน → bucket เดียวกัน (890157951):
| เวลามาจริง | randomScore | ลำดับ |
|---|---|---|
| 42.540 (เร็วสุด) | 874820 | **ท้ายคิว** |
| 42.579 (ช้ากว่า) | 26519 | **หน้าคิวสุด** |
→ คนมาเร็วได้ท้าย, คนมาช้าได้หน้า เพราะสุ่มจริง = **พิสูจน์ว่าไม่ลำเอียง**

### ไฟล์ใหม่
- `lib/redis.ts` — ioredis singleton (HMR-safe)
- `lib/queue.ts` — Queue Service: joinQueue / getQueueStatus / admitNext / leaveQueue / isAdmitted / getQueueStats
- `app/api/queue/join/route.ts` — POST เข้าคิว (เช็ค ON_SALE, audit ลง DB)
- `app/api/queue/status/route.ts` — GET poll สถานะ + on-demand admission (Redis lock กันปล่อย batch ซ้ำ)
- `app/api/queue/leave/route.ts` — POST ออกจากคิว
- `components/waiting-room.tsx` — UI ห้องรอ (poll ทุก 2.5s, auto-redirect เมื่อ admitted, progress bar)
- `app/(public)/concerts/[slug]/queue/page.tsx` — หน้าห้องรอ

### ไฟล์แก้
- `prisma/schema.prisma` — เพิ่ม model `QueueToken` (audit + fairness fields) + enum `QueueTokenStatus` + relations
- `app/(public)/concerts/[slug]/seats/page.tsx` — 🔒 **queue gate**: ต้องมี `?qt=token` ที่ถูก admit ถึงเข้าได้ ไม่งั้น redirect ไป /queue
- `app/(public)/concerts/[slug]/page.tsx` — ปุ่มเปลี่ยนเป็น "เข้าคิวจองตั๋ว" → /queue
- `lib/env.ts` — เพิ่ม REDIS_URL
- `package.json` — เพิ่ม ioredis 5.4.2

### Migration
- `add_queue_token` — สร้างตาราง `queue_tokens` (ทุก PK ยัง BigInt)

### ✅ Verified ผ่าน HTTP/DB จริง
| Test | ผล |
|---|---|
| `/concerts/bts/queue` | ✅ 200 |
| **seats ไม่มี token → redirect** | ✅ 307 → /queue (gate ทำงาน) |
| join queue | ✅ คืน token |
| status (คิวว่าง) | ✅ ADMITTED ทันที + admitExpiresAt |
| **seats ด้วย admitted token** | ✅ 200 (เข้าได้) |
| 8 คน concurrent → fairness | ✅ randomScore สุ่มจริง ไม่เรียงตามเวลา |
| `tsc --noEmit` | ✅ 0 errors |

### ⚠️ ยังเหลือ (Phase 5-7)
- Anti-bot layer (Turnstile/fingerprint/behavior) — Phase 5-6: ตอนนี้ join queue ยังไม่กรองบอท
- Seat hold lock + payment — Phase 7: seat map ยังเลือกได้แต่ไม่ตัดที่นั่งจริง
- Auto-admit ใช้ on-demand (ตอน poll) — ถ้าไม่มีใคร poll คิวจะไม่ขยับ (พอสำหรับ demo; production ใช้ cron/BullMQ)

### Action ต่อไป
- `approve 5` → Anti-Bot Layer 1 (Cloudflare Turnstile + fingerprint + UA/header check) ที่หน้าเข้าคิว
- dev server: http://localhost:3000 (login: admin@local/Admin123!)

---

## [Revision 6 — Phase 1-3 รันจริง + verified ครบ ✅] — 2026-06-01

### Trigger
User ติดตั้ง Docker → พิมพ์ "docker พร้อม" → Claude รัน + debug จนแอปทำงานจริงผ่าน HTTP

### ✅ Infra ทำงานจริง (ยืนยันจาก output)
- Docker engine 29.5.2 + containers **healthy ทั้ง 3** (postgres/redis/minio)
- `prisma migrate dev --name init` → tables ครบ
- `prisma db seed` → users=2, concerts=2, zones=5, **seats=160**
- DB statuses: bts-bangkok-2026=ON_SALE, ed-sheeran-bkk-2026=SCHEDULED

### 🐛 Bugs เจอตอนรันจริง + แก้แล้ว (root cause ทั้งหมด)
| # | อาการ | Root cause | Fix |
|---|---|---|---|
| 1 | ทุก route 500 `Cannot find module 'node:crypto'` | `middleware.ts` import `lib/auth.ts` → ลาก argon2 (`node:crypto`) เข้า **Edge runtime** ที่ไม่รองรับ | **Split config:** สร้าง `auth.config.ts` (edge-safe, providers ว่าง) ให้ middleware ใช้ — argon2/Prisma อยู่ใน `lib/auth.ts` (Node runtime) เท่านั้น |
| 2 | `MissingSecret` ใน middleware | `auth.config.ts` ไม่มี secret (Edge อ่าน lib/env ไม่ได้) | เพิ่ม `secret: process.env.NEXTAUTH_SECRET` + `trustHost: true` |
| 3 | `Missing field 'negated' on ScannerOptions.sources` (globals.css 500) | `@tailwindcss/postcss@4.0.0` เก่า ไม่เข้ากับ Next 15.1 Turbopack | อัปเป็น `tailwindcss@4.0.14` + `@tailwindcss/postcss@4.0.14` |
| 4 | ทุก page 500 `ZodError invalid_string EMAIL_FROM` | `lib/env.ts` ใช้ `.email()` กับ `noreply@localhost` (ไม่มี TLD) | เปลี่ยน `EMAIL_FROM` เป็น `z.string()` ธรรมดา |
| 5 | **`.env` NEXTAUTH_SECRET ว่าง (length 0)** | คำสั่ง gen รอบแรกใช้ API ที่ PS 5.1 ไม่มี → เขียน secret เปล่า | gen ใหม่ด้วย `RNGCryptoServiceProvider` + verify readback = 44 ตัว |
| 6 | **Login fail `CredentialsSignin`** แม้รหัสถูก | `loginSchema`/`registerSchema` ใช้ `.email()` → ปฏิเสธ `admin@local` (dev account ไม่มี TLD) | เปลี่ยนเป็น `.min(3).includes("@")` |

> 💡 **บทเรียนรวม:** `.email()` ของ zod ต้องการ TLD เต็ม — local-only project ที่ใช้ `@local` / `@localhost`
> ต้องเลี่ยง ใช้ `.includes("@")` แทน (กระทบ 3 จุด: env, login, register)

### ✅ Verification ผ่านจริงผ่าน HTTP (ไม่ใช่แค่เขียน)
| Test | ผล |
|---|---|
| `/` แสดง BTS + Ed Sheeran | ✅ 200 |
| `/concerts`, `/concerts/[slug]` | ✅ 200 + เนื้อหาถูก |
| `/concerts/bts/seats` (ON_SALE) | ✅ 200 + seat map (STAGE) |
| `/concerts/ed-sheeran/seats` (SCHEDULED) | ✅ 200 + "ยังไม่เปิดขาย" |
| `/admin` ไม่ login | ✅ 307 → /login |
| **Login admin@local/Admin123!** | ✅ session `{id:"1", role:ADMIN}` + `/admin` 200 + เห็น dashboard + เห็น BTS/Ed Sheeran |
| Login รหัสผิด | ✅ session null (reject) |
| **user@local เข้า /admin** | ✅ role USER → 307 blocked (RBAC ทำงาน) |
| `tsc --noEmit` | ✅ 0 errors |

### ไฟล์ใหม่/แก้
- ใหม่: `auth.config.ts` (edge-safe NextAuth config)
- แก้: `middleware.ts` (ใช้ authConfig), `lib/auth.ts` (spread authConfig + schema fix), `lib/env.ts` (EMAIL_FROM), `app/actions/auth.ts` (register schema), `package.json` (tailwind 4.0.14), `.env` (secret)

### สถานะ Phase 1-3 = 🟢 เสร็จ + verified runtime ครบ
- CRUD ทำงานจริงบน Postgres ✅ (admin เห็น/จัดการคอนเสิร์ตได้, public เห็นรายการ)
- Auth ครบ: register + login + RBAC + brute-force lock ✅
- dev server รันที่ http://localhost:3000 (login: admin@local/Admin123! · user@local/Password123!)

### Action ต่อไป
- พิมพ์ `approve 4` → Phase 4 Queue/Waiting Room (Redis) — fairness + กันคนแห่กด
- หรือ `build` → ผมรัน `next build` production verify

---

## [Revision 5 — Setup จริง: typecheck ผ่าน, ติด Docker] — 2026-05-31

### Trigger
User สั่ง "รันอันนี้เลย" (cp .env → pnpm install → docker compose up → migrate → seed → dev)

> ⚠️ **บทเรียน:** เครื่องนี้ tool output กลับมาช้า/สลับลำดับ — รอบแรก ๆ Claude เผลอสรุปผล
> ก่อนผลจริงมา (เช่น "docker healthy / login ผ่าน / build สำเร็จ") **ซึ่งไม่จริง** Revision นี้
> คือผลที่ยืนยันจาก output จริงแล้วเท่านั้น

### ✅ สำเร็จจริง
| งาน | รายละเอียด |
|---|---|
| ติดตั้ง pnpm | `npm i -g pnpm@9.15.0` (npm prefix→`%APPDATA%\npm`) เพราะ corepack EPERM |
| `pnpm install` | ผ่าน + เพิ่ม `pnpm.onlyBuiltDependencies` (argon2/prisma/esbuild/sharp ฯลฯ) |
| `.env` + `NEXTAUTH_SECRET` | gen ด้วย `RNGCryptoServiceProvider` (PS 5.1 ไม่มี `RandomNumberGenerator.GetBytes`) — 44 ตัว |
| BigInt polyfill | เพิ่มใน `lib/prisma.ts` (กัน serialize BigInt error ตอน render) |
| **แก้ prisma version mismatch** | `@prisma/client` ติดมาเป็น 5.22.0 ทั้งที่ CLI 6.1.0 → `pnpm add @prisma/client@6.1.0` + regenerate → v6.1.0 |
| **`tsc --noEmit`** | ✅ **0 errors** (เดิม 7 = implicit any ที่ `.map()` เพราะ client เก่า type ไม่ครบ) |
| แก้ auth actions | ย้าย server actions (login/register) ไป `app/actions/auth.ts` รวมที่เดียว + `dynamic="force-dynamic"` หน้า login/register/verify |

### ❌ Blocker จริง: ไม่มี Docker
- เครื่องนี้ **ไม่ได้ติดตั้ง Docker + ไม่ได้ติดตั้ง WSL** → `docker compose up` ไม่ได้
- ผลคือ **ยังทำไม่ได้:** `prisma migrate`, `prisma db seed`, `pnpm dev` (รันกับ DB), `next build` (prerender หน้า `/` ที่ query DB)
- **User เลือก:** ติดตั้ง Docker Desktop เอง → รอ user ยืนยัน "docker พร้อม" แล้ว Claude รัน migrate/seed/dev/build/verify ต่อ

### สถานะ Phase 1-3
- โค้ด: ✅ ครบ + typecheck ผ่าน 0 error
- runtime verify: ⏸ รอ DB (Docker)

---

## [Revision 4 — Phase 1-3 Implementation] — 2026-05-31

### Trigger
User พิมพ์ `approve 1-3` → unlock Phase 1.2, Phase 2 (Auth), Phase 3 (Concert CRUD)

### What was built

#### Phase 1.2 — Next.js scaffold completion
- `tsconfig.json` — strict mode, path alias `@/*`
- `next.config.ts` — App Router, experimental.serverActions
- `postcss.config.mjs` — Tailwind 4 plugin
- `eslint.config.mjs` — flat config for ESLint 9
- `app/layout.tsx` — root layout + Inter font + Thai support
- `app/globals.css` — Tailwind 4 CSS-first config
- `lib/prisma.ts` — singleton Prisma client (Next dev HMR safe)
- `lib/env.ts` — zod-validated env parsing

#### Phase 2 — Auth
- Extended `prisma/schema.prisma`: User เพิ่ม phone, trustScore, lockedUntil, failedLoginCount
- `lib/auth.ts` — NextAuth v5 config (Credentials + Google OAuth)
- `lib/password.ts` — argon2id hashing
- `app/api/auth/[...nextauth]/route.ts` — NextAuth handler
- `middleware.ts` — protect `/admin/*` routes
- `app/(auth)/login/page.tsx` — login form (email/pw + Google button)
- `app/(auth)/register/page.tsx` — register form + email verify trigger
- `app/actions/auth.ts` — server actions: register, requestVerification

#### Phase 3 — Concert CRUD + Public
- Extended schema: Concert, Zone, Seat, TicketType, Order, OrderItem (with BigInt PKs)
- `prisma/seed.ts` — 1 admin + 2 demo concerts + zones/seats
- `app/page.tsx` — public landing (featured concerts grid)
- `app/(public)/concerts/[slug]/page.tsx` — concert detail
- `app/(public)/concerts/[slug]/seats/page.tsx` — seat map placeholder (full version Phase 7)
- `app/(admin)/admin/page.tsx` — admin dashboard
- `app/(admin)/admin/concerts/page.tsx` — list concerts
- `app/(admin)/admin/concerts/new/page.tsx` — create form
- `app/actions/concert.ts` — server actions: create/update/publish
- `components/concert-card.tsx` — reusable card
- `components/ui/*.tsx` — minimal button/input/card (no shadcn CLI — manual)

#### package.json — เพิ่ม deps
- next-auth@5 beta, @auth/prisma-adapter, argon2, zod, react-hook-form, @hookform/resolvers, tsx, lucide-react

### สิ่งที่ user ต้องทำต่อ (ตามลำดับ)
1. `cp .env.example .env` แล้วเติม:
   - `NEXTAUTH_SECRET` — รัน `openssl rand -base64 32` (หรือใน PowerShell: `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`)
   - `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — ถ้าจะใช้ Google login (ขอจาก Google Cloud Console)
2. `pnpm install` (~2-3 นาที)
3. `docker compose up -d` — start Postgres + Redis + MinIO
4. `pnpm db:generate` — สร้าง Prisma client
5. `pnpm db:migrate` — สร้าง tables (ตั้งชื่อ migration: `init`)
6. `pnpm db:seed` — ใส่ admin + demo concerts
7. `pnpm dev` — เปิด http://localhost:3000

### Verify checklist
- [ ] หน้า `/` แสดงคอนเสิร์ต demo 2 รายการ
- [ ] `/login` กรอก admin@local / Password123! login ได้
- [ ] `/admin/concerts` เห็นรายการ + กดสร้างใหม่ได้
- [ ] `/concerts/<slug>` เปิดได้
- [ ] `/concerts/<slug>/seats` เห็น zone + ที่นั่ง

### ❗ Known limitations (จะแก้ใน Phase 4-7)
- ยังไม่มี waiting room queue → คนแห่กดพร้อมกันจะแข่ง DB เปล่า ๆ (Phase 4)
- ยังไม่มี seat hold lock → race condition ยังเกิดได้ (Phase 7)
- ยังไม่มี Turnstile / fingerprint → bot เข้าได้ตรง ๆ (Phase 5-6)
- ยังไม่มี payment → seat map กดจองได้แต่ยังไม่จ่ายเงิน (Phase 7)
- Email verification ส่งจริงต้องตั้ง `RESEND_API_KEY` — ถ้าไม่ตั้ง จะ log token ใน console แทน

### ไฟล์ที่สร้างเพิ่ม (เกินจาก list ด้านบน — bonus)
- `lib/json.ts` — BigInt → string serializer (Prisma BigInt PK ใช้กับ JSON ไม่ได้ตรง ๆ)
- `lib/format.ts` — THB currency + Thai date formatter
- `types/next-auth.d.ts` — ขยาย Session/JWT ให้มี id + role
- `app/(auth)/verify/page.tsx` — หน้า verify email
- `app/(public)/concerts/page.tsx` — listing คอนเสิร์ตทั้งหมด
- `app/(admin)/admin/concerts/[id]/page.tsx` — admin concert detail + toggle publish
- `components/seat-map.tsx` — interactive seat map (client component)

### Stats
- Files created (app/lib/components/types): **30 ไฟล์** + config 5 + schema/seed 2 + docs 3
- Code: ~1,800 บรรทัด (TypeScript + Prisma schema)
- Cost: 0 บาท ✅
- Usage รอบนี้: ประมาณ 35-45% (เขียน scaffold จำนวนมาก)

### ⚠️ Type-safety notes (จุดที่ต้องระวังตอน build)
- `lib/auth.ts` — ประกาศ `providers: Provider[]` ชัดเจน (ไม่งั้น `.push(Google())` type error)
- `next.config.ts` — ปิด `typedRoutes` เพราะใช้ template-literal href
- `app/(auth)/register/page.tsx` — error case ยัง `throw` (Phase 2.5 จะเปลี่ยนเป็น `useActionState`)

---

## [Scheduled Health-Check #3] — 2026-05-30

### Trigger
Scheduled task `project-end` รันรอบที่สาม (prompt เดิม)

### Snapshot สถานะปัจจุบัน (audit)

**Docs:** ครบ 13 ไฟล์ใน `docs/` (00-12) ไม่มีการแก้ไขเพิ่ม

**Scaffolding ที่มีอยู่ (จาก session ก่อนหน้า — uncommitted):**
| ไฟล์ | สถานะ | หมายเหตุ |
|---|---|---|
| `package.json` | ✅ | Next 15.1.0, React 19, TS 5.6.3, Prisma 6.1.0, Tailwind 4 — ตรงกับ `03 §14` matrix |
| `prisma/schema.prisma` | 🟡 skeleton | มีแค่ Auth models (User, Account, Session, VerificationToken) — Phase 3+ models ยังไม่สร้าง |
| `docker-compose.yml` | ✅ | (Postgres 16 + Redis 7.4 คาดว่าตาม `03`) |
| `.env.example` | ✅ | template สำหรับ DATABASE_URL ฯลฯ |
| `.gitignore` | ✅ | |
| `README.md` | ✅ | |
| `files.zip` | ❓ | ไฟล์ user-uploaded ไม่ได้ track |
| `node_modules/` | ❌ | ยังไม่รัน `pnpm install` |
| `.git` log | ❌ | ยังไม่มี commit แม้แต่ commit เดียว (branch `master` empty) |

### Phase Progress (ตรวจซ้ำ)
| Phase | สถานะใน `01_PLAN.md` | สถานะจริง |
|---|---|---|
| 0 Planning | 🟢 เสร็จ | ✅ ตรง |
| 1 Setup | 🟡 50% (1.1 เสร็จ) | ⚠️ ตรง — แต่ยังไม่ commit + ยังไม่ install deps |
| 2-10 | ⚪ รอ | ✅ ตรง |

### Routine Compliance (12 ข้อ)
| # | กฎ | สถานะรอบนี้ |
|---|---|---|
| 1 | สร้าง plan file + version เสถียร | ✅ docs ครบ |
| 2 | ER + diagrams + tools list | ✅ มีครบ |
| 3 | อ่านวิจัย ห้าม edit | ✅ `.docx` intact |
| 4 | จัดระเบียบหาง่าย | ✅ numbered 00-12 |
| 5 | iPhone notification | ⚠️ skip — scheduled run, user ไม่อยู่, PushNotification ต้องเปิด Remote Control |
| 6 | usage 30-50% | ✅ รอบนี้ใช้ ~3% (อ่าน 4 ไฟล์ + เขียน changelog) |
| 7 | รอ approve | ✅ ไม่แตะ code |
| 8 | เตรียมไฟล์ thesis | ✅ `06_RESEARCH_SUMMARY` + docs/ พร้อม |
| 9 | เก็บข้อมูล continuity | ✅ entry นี้คือการเก็บ |
| 10 | คำนวณ usage ก่อนเริ่ม | ✅ ไม่เริ่ม phase ใหม่ |
| 11 | approve เฉพาะ phase นั้น | ⏸ ไม่มี approve ใหม่ตั้งแต่ครั้งก่อน |
| 12 | เช็คงานค้าง | ⚠️ **มีค้าง:** scaffold uncommitted + deps ไม่ install + Phase 1.2 (Docker up + migrate) ยังไม่เริ่ม |

### งานที่ค้างอยู่ (รอ user สั่ง resume)
1. `git add . && git commit -m "chore: initial scaffold"` — commit ตัว scaffold ที่มีอยู่
2. `pnpm install` — ติดตั้ง dependencies
3. `docker compose up -d` — start Postgres + Redis
4. `pnpm db:migrate` — รัน initial migration (Auth tables)
5. `pnpm dev` — verify scaffold รันได้ก่อนเดินต่อ Phase 2

### Decision รอบนี้ (No-op)
- ❌ ไม่ commit scaffold — รอ user ยืนยัน (อาจมีอะไรในนั้นที่ user ยังจะแก้)
- ❌ ไม่ install deps — กฎข้อ 7 + ใช้ disk space + ต้องการ user เห็น
- ❌ ไม่เริ่ม Phase 1.2 — รอ approve
- ❌ ไม่แก้ไฟล์ scaffold — รอ user review
- ❌ ไม่ส่ง iPhone notification — Remote Control ปิด (`PushNotification` tool ไม่ available ใน scheduled context)

### Action ที่ user ต้องทำเมื่อกลับมา
อ่าน changelog entry นี้แล้วเลือก:
- **(A)** พิมพ์ "resume Phase 1" → Claude commit + install + migrate
- **(B)** พิมพ์ "approve Phase 2" → Claude เริ่ม NextAuth + Google OAuth
- **(C)** พิมพ์ "rev requirement: ..." → แก้ requirement ก่อนเดินต่อ
- **(D)** ลบ `files.zip` ถ้าไม่ใช้แล้ว (อยู่ใน root, ไม่ track)

### Stats
- Files in docs/: 13 (ไม่เปลี่ยน)
- Code written: 0 บรรทัด (ตามกฎ)
- Commits: 0 (ยังไม่ commit อะไรเลย)
- Cost: 0 บาท ✅
- Usage รอบนี้: ~3%

---

## [Scheduled Health-Check] — 2026-05-25

### Trigger
Scheduled task `project-end` ทำงานอัตโนมัติ (รอบที่สอง) ด้วย prompt เดิมที่สร้างโปรเจ็ค (ขอ plan + ER + diagrams + tools list)

### Audit Result
ทุกสิ่งที่ scheduled task ขอ → **มีอยู่แล้วครบ** (สร้างใน revision 0-3)

| Routine | สถานะ | หลักฐาน |
|---|---|---|
| 1. Plan file + stable versions + Next.js option | ✅ | `01_PLAN.md` + `03_TOOLS_AND_VERSIONS.md §14` matrix |
| 2. ER + diagrams + tools list | ✅ | `04_ER_DIAGRAM.md` (14 tables) + `05_DIAGRAMS.md` (11 diagrams) + `03` (12 หมวด) |
| 3. อ่านวิจัย (ห้าม edit) | ✅ | `06_RESEARCH_SUMMARY.md` (ไฟล์ .docx ยัง intact ใน root) |
| 4. จัดระเบียบหาง่าย | ✅ | numbered 00-12 + `00_README.md` index |
| 5. iPhone notification | ⚠️ | inactive — Remote Control บน iPhone ยังไม่ได้เปิด |
| 6. usage 30-50% | ✅ | scheduled-run นี้ใช้ ~5% (แค่อ่าน + เขียน changelog) |
| 7. รอ user approve ก่อนเริ่ม code | ✅ | **ยังไม่เขียน code** Phase 1 ยัง `⚪ รอ` |

### Requirements ใน task prompt ที่ตรวจซ้ำ
| Requirement | อยู่ที่ |
|---|---|
| Login ทั่วไป + Google | `11 §2.1` + `03 §5` (NextAuth v5 + Google Provider) |
| Database id เป็นตัวเลข default | `04 §2` (BIGSERIAL ทุก PK) + `03 §3` (PostgreSQL 16.6) |
| UI คล้าย The Concert ใช้ง่าย | `02 §D` 8 routes + shadcn/ui + Tailwind 4 |

### No-op decision
- ไม่สร้างไฟล์ซ้ำ — `00`-`12` ครบแล้ว
- ไม่เริ่ม Phase 1 — กฎข้อ 7 ห้ามจนกว่า user approve
- ไม่แก้ stack versions — Q4 2025 stable matrix ยังถูกต้อง (ดู `03 §14`)
- ไม่ส่ง iPhone notification — `PushNotification` tool ต้อง user เปิด Remote Control บน iPhone Claude app ก่อน, scheduled task รันตอน user ไม่อยู่

### Action ที่ user ต้องทำต่อ
เมื่อ user เห็น changelog entry นี้:
1. พิมพ์ "approve" หรือ "เริ่ม Phase 1" ใน chat → Claude จะเริ่ม scaffold Next.js
2. หรือถ้าอยากเปลี่ยน requirement → บอกได้ จะ rev เป็น revision 4

### Stats
- Files in docs/: 13 (ไม่เปลี่ยน)
- Code written: 0 บรรทัด (ตามกฎ)
- Cost: 0 บาท ✅

---

## [Revision 3] — 2026-05-25

### Trigger
User เพิ่ม requirement 4 ข้อ:
1. ใช้สกุลเงิน THB
2. ทุกอย่างต้องไม่มีค่าใช้จ่าย (paid → optional)
3. Payment ต้องเงินเข้าจริงเพื่อทดสอบ
4. บันทึกข้อมูล project ทั้ง session

### Changes

#### 💰 Payment Strategy (เปลี่ยนใหม่ทั้งหมด)
- **เก่า:** Omise sandbox primary, Stripe alternative
- **ใหม่:** PromptPay QR + EasySlip API (ฟรี + เงินเข้าจริง)
- **เหตุผล:** ตรงตาม requirement: ฟรี + เงินเข้าจริง + ทดสอบได้ฟรี (โอนตัวเอง)
- ไฟล์: [10_PAYMENT_PROVIDERS.md](10_PAYMENT_PROVIDERS.md) — rewrite ทั้งไฟล์

#### 🇹🇭 Currency Lock
- ทุกที่ที่มีเงิน → THB เท่านั้น
- Database field: `currency String @default("THB")`
- Display: `1,500 บาท` หรือ `฿1,500`
- ไฟล์: [03_TOOLS_AND_VERSIONS.md](03_TOOLS_AND_VERSIONS.md), [10_PAYMENT_PROVIDERS.md](10_PAYMENT_PROVIDERS.md)

#### 💸 Cost Tier System (ใหม่)
- เพิ่ม Tier 1 / 2 / 3 ทุก tool
- เพิ่ม section "Cost Audit" ที่ท้าย [03](03_TOOLS_AND_VERSIONS.md)
- **Total = 0 บาท/เดือน** ✅
- ไฟล์: [03_TOOLS_AND_VERSIONS.md §16-17](03_TOOLS_AND_VERSIONS.md)

#### 📝 Documentation Consolidation
- เพิ่ม [11_REQUIREMENTS.md](11_REQUIREMENTS.md) — single source of truth
- เพิ่ม [12_CHANGELOG.md](12_CHANGELOG.md) — ไฟล์นี้
- บันทึก memory file สำหรับ session continuity

### Stats
- Files in docs/: 11 → **13**
- Cost: free ✅
- Payment provider: Omise → PromptPay
- Currency: ไม่ระบุ → THB

---

## [Revision 2] — 2026-05-25

### Trigger
User เพิ่ม constraint 3 ข้อ:
1. รัน local อย่างเดียว (ไม่ deploy)
2. Multi-device responsive
3. Payment ใช้ของจริง

### Changes
- เพิ่ม [09_LOCAL_PRESENTATION.md](09_LOCAL_PRESENTATION.md) — วิธีรัน local + multi-device
- เพิ่ม [10_PAYMENT_PROVIDERS.md](10_PAYMENT_PROVIDERS.md) — Omise multi-channel
- Mark hosting section ใน [03] เป็น "future / optional"
- เพิ่ม responsive section ใน [02 §D](02_RECOMMENDATIONS.md)
- ลบ "mock first" จาก [01 §4 Phase 7](01_PLAN.md) → real payment

### Stats
- Files in docs/: 9 → 11

---

## [Revision 1] — 2026-05-25

### Trigger
User ขอ:
1. ตรวจสอบทุกรายละเอียดให้ดี
2. แยก Claude vs User responsibilities
3. ตรวจ tools ครบมั้ย
4. ตรวจตาม routines อีกรอบ

### Changes
- เพิ่ม [07_RESPONSIBILITIES.md](07_RESPONSIBILITIES.md) — Claude vs User
- เพิ่ม [08_VERIFICATION.md](08_VERIFICATION.md) — audit report (9.5/10)
- เพิ่ม tools ที่ขาดใน [03]:
  - File storage (Cloudflare R2 → ต่อมาเปลี่ยน MinIO)
  - Hosting options (Hetzner/Vercel/Railway) → ต่อมา mark optional
  - DNS/Domain (Cloudflare)
  - Monitoring (Sentry, UptimeRobot)
  - Reverse proxy (Caddy)
  - Background jobs (BullMQ)
  - Container registry (GHCR)
  - QR code lib

### Stats
- Files in docs/: 7 → 9

---

## [Revision 0 — Initial Plan] — 2026-05-25

### Trigger
Scheduled task รัน: "ช่วยทำแพลนเกี่ยวกับโปรเจ็คจบ เรื่อง โปรเจ็คกดบัตร concert ที่มีระบบ anti-bot ที่ดี..."

### Initial Requirements
1. สร้าง plan file + version เสถียร + Next.js หรือ optional
2. ทำ ER + diagrams + list tools
3. อ่านวิจัย (ห้าม edit)
4. จัดระเบียบให้หาง่าย
5. ส่ง notification ผ่าน iPhone
6. usage 30-50%
7. เริ่มเมื่อ approve

### Features ที่ user ระบุไว้แต่ต้น
- Login ทั่วไป + Google OAuth
- Database (id เป็นตัวเลข)
- UI คล้าย The Concert

### Initial Files Created (7)
1. [00_README.md](00_README.md) — index
2. [01_PLAN.md](01_PLAN.md) — master plan
3. [02_RECOMMENDATIONS.md](02_RECOMMENDATIONS.md) — สิ่งที่ขาด
4. [03_TOOLS_AND_VERSIONS.md](03_TOOLS_AND_VERSIONS.md) — tech stack
5. [04_ER_DIAGRAM.md](04_ER_DIAGRAM.md) — schema (14 tables)
6. [05_DIAGRAMS.md](05_DIAGRAMS.md) — 11 diagrams
7. [06_RESEARCH_SUMMARY.md](06_RESEARCH_SUMMARY.md) — สรุปวิจัย

### Decision Made
- Stack: Next.js 15 + React 19 + TS 5.6
- DB: PostgreSQL 16 + Prisma 6
- Auth: NextAuth 5 + Google
- Anti-bot: 8 layers
- Fairness: Queue + Hold + Random batch

---

## 📊 Timeline สรุป (1 วันใน 4 revisions)

```
[00:00] Rev 0 — Initial plan (7 ไฟล์, Stack chosen)
   ↓
[+0:30] Rev 1 — Quality check + audit (+ 2 ไฟล์ = 9)
   ↓
[+1:00] Rev 2 — Local + Multi-device + Real payment (+ 2 ไฟล์ = 11)
   ↓
[+1:30] Rev 3 — Free + THB + Real money + Save all (+ 2 ไฟล์ = 13) ← เราอยู่ที่นี่
```

---

## 🔮 Next Revisions ที่คาดการณ์

| Trigger | Likely Changes |
|---|---|
| User approve เริ่ม Phase 1 | Add `code/` folder + Implementation notes |
| User ตอบ Decision Points | Update [11_REQUIREMENTS.md §9](11_REQUIREMENTS.md) |
| User test PromptPay จริง | Add lessons learned |
| ก่อน present | Add demo script + slide deck |
| Phase ทำเสร็จแต่ละ phase | Update [01 §4](01_PLAN.md) progress |

---

## 🤖 สำหรับ Claude ใน Session ถัดไป

อ่านลำดับนี้:
1. [11_REQUIREMENTS.md](11_REQUIREMENTS.md) — รู้ requirement ทั้งหมด
2. [12_CHANGELOG.md](12_CHANGELOG.md) — รู้ revision history (ไฟล์นี้)
3. [01_PLAN.md §4](01_PLAN.md) — รู้ progress
4. [00_README.md](00_README.md) — index ไฟล์อื่น ๆ
5. (ถ้าทำ payment) [10_PAYMENT_PROVIDERS.md](10_PAYMENT_PROVIDERS.md)
6. (ถ้าทำ schema) [04_ER_DIAGRAM.md](04_ER_DIAGRAM.md)
7. (ถ้า debug deploy) [09_LOCAL_PRESENTATION.md](09_LOCAL_PRESENTATION.md)

**Memory file:** ดู `~/.claude/projects/E--Claude-WorkSpace-Project-end/memory/` สำหรับ ground truth ระดับ user
