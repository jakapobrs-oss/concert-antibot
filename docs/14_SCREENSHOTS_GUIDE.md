# 14 — Screenshots & Demo Guide (คู่มือถ่ายภาพหน้าจอ + สาธิต)

> ใช้สำหรับเก็บภาพหน้าจอใส่ปริญญานิพนธ์ (บท "ผลการพัฒนาระบบ") + เตรียมสาธิตวันนำเสนอ
> ทุกหน้าทดสอบแล้วว่า render จริง — ทำตามลำดับนี้จะได้ภาพครบทุกฟีเจอร์

---

## 0. เตรียมระบบก่อนถ่าย

```powershell
# 1. start docker (ถ้ายังไม่รัน)
docker compose up -d

# 2. seed ข้อมูลใหม่ให้สะอาด (admin + user + 2 คอนเสิร์ต)
$env:PATH = "$env:APPDATA\npm;$env:PATH"
pnpm db:seed

# 3. รัน dev server
pnpm dev
```

เปิด http://localhost:3000

**บัญชีทดสอบ:**
| Role | Email | Password |
|---|---|---|
| Admin | admin@local | Admin123! |
| User | user@local | Password123! |

---

## 1. รายการภาพที่ต้องถ่าย (เรียงตาม flow ผู้ใช้)

| # | หน้า | URL | สิ่งที่ต้องเห็นในภาพ |
|---|---|---|---|
| 1 | หน้าแรก (Landing) | `/` | hero + คอนเสิร์ตเด่น 2 รายการ (BTS, Ed Sheeran) |
| 2 | รายการคอนเสิร์ต | `/concerts` | grid คอนเสิร์ตทั้งหมด + badge สถานะ |
| 3 | รายละเอียดคอนเสิร์ต | `/concerts/bts-bangkok-2026` | โซน VIP/R1/R2 + ราคา + ที่นั่งคงเหลือ + ปุ่ม "เข้าคิวจองตั๋ว" |
| 4 | สมัครสมาชิก | `/register` | ฟอร์มสมัคร |
| 5 | เข้าสู่ระบบ | `/login` | ฟอร์ม login (+ ปุ่ม Google ถ้าตั้ง env) |
| 6 | **ห้องรอเสมือน** | `/concerts/bts-bangkok-2026/queue` | ตำแหน่งคิว + progress bar (ฟีเจอร์เด่น!) |
| 7 | **เลือกที่นั่ง** | (เข้าผ่านคิว) | seat map + เวที + legend สี + สรุปราคา |
| 8 | **ชำระเงิน** | `/checkout/[id]` | QR PromptPay + countdown + upload สลิป |
| 9 | **ตั๋วของฉัน** | `/account/tickets` | ตั๋ว + QR เข้างาน |
| 10 | Admin Dashboard | `/admin` | รายได้ + bot stats + queue real-time |
| 11 | **Bot Detection Log** | `/admin/bot-log` | ตาราง event + behavior summary (ฟีเจอร์เด่น!) |
| 12 | Sales Report | `/admin/sales` | ยอดขาย + progress bar ต่อคอนเสิร์ต |
| 13 | จัดการคอนเสิร์ต | `/admin/concerts` | รายการ + ปุ่มเปิด/ปิดขาย |
| 14 | สร้างคอนเสิร์ต | `/admin/concerts/new` | ฟอร์มสร้าง |

---

## 2. สคริปต์สาธิต (Demo Script — วันนำเสนอ ~5 นาที)

### ฉากที่ 1: มุมผู้ใช้ (2 นาที)
1. เปิดหน้าแรก → ชี้คอนเสิร์ตเด่น
2. คลิก BTS → ดูรายละเอียด/โซน → กด **"เข้าคิวจองตั๋ว"**
3. **ห้องรอ** → อธิบายว่า "ระบบจัดคิวเป็นธรรม ทุกคนพร้อมกันมีโอกาสเท่ากัน"
   (ถ้าคิวว่างจะเข้าทันที)
4. **เลือกที่นั่ง** → คลิกที่นั่ง 2 ที่ → กด "ดำเนินการชำระเงิน"
5. **หน้าชำระเงิน** → ชี้ QR PromptPay + countdown 5 นาที → upload สลิป (dev: ผ่านทันที)
6. **ได้ตั๋ว** → ชี้ QR ticket

### ฉากที่ 2: มุม Admin (1.5 นาที)
7. logout → login admin → เข้า `/admin`
8. ชี้ **รายได้รวม + สถิติ anti-bot** (ALLOW/CHALLENGE/BLOCK)
9. เข้า **Bot Detection Log** → ชี้ตาราง + เปรียบเทียบ behavior human vs bot

### ฉากที่ 3: หลักฐานเชิงเทคนิค (1.5 นาที)
10. เปิด terminal → รัน `pnpm exec vitest run` → โชว์ 9/9 ผ่าน
11. รัน `node tests/load/concurrent-fairness.mjs` → โชว์ผล 2000 คน:
    - inversion 96.8% (เป็นธรรม)
    - 1/2000 winner (ไม่จองซ้ำ)
12. สรุป: "ระบบป้องกันบอทได้ + ยุติธรรม + รับโหลดได้จริง"

---

## 3. คำสั่งสร้างหลักฐานเชิงตัวเลข (ใส่ในเล่ม)

```powershell
$env:PATH = "$env:APPDATA\npm;$env:PATH"

# Unit tests (capture ผล 9/9 passed)
pnpm exec vitest run

# Load test fairness + race (capture ผลตัวเลข)
node tests/load/concurrent-fairness.mjs          # 500 คน (default)
$env:N=2000; node tests/load/concurrent-fairness.mjs   # 2000 คน

# ถ้าติดตั้ง k6 แล้ว (choco install k6) — HTTP load จริง
pnpm test:load
```

---

## 4. การถ่ายภาพ multi-device (responsive — ตาม requirement)

ระบบเป็น responsive (Tailwind mobile-first) — ถ่ายภาพแสดงว่าใช้ได้ทุกอุปกรณ์:
1. **Desktop:** เบราว์เซอร์เต็มจอ
2. **Mobile:** เปิด DevTools (F12) → Toggle device toolbar → เลือก iPhone → ถ่าย
3. **Tablet:** เลือก iPad ใน DevTools

> หรือเปิดบนมือถือจริงผ่าน Wi-Fi เดียวกัน: `http://<IP-ของเครื่อง>:3000`
> (ดูวิธีหา IP + setup ใน [09_LOCAL_PRESENTATION.md](09_LOCAL_PRESENTATION.md))

---

## 5. Checklist ก่อนนำเสนอ

- [ ] docker compose up — ทุก container healthy
- [ ] seed ข้อมูลสด (ที่นั่งครบ 160 available)
- [ ] dev server รันได้ที่ :3000
- [ ] ถ่ายภาพครบ 14 หน้า
- [ ] รัน unit test + load test เก็บผล
- [ ] เตรียม diagram จาก [04_ER_DIAGRAM.md](04_ER_DIAGRAM.md) + [05_DIAGRAMS.md](05_DIAGRAMS.md)
- [ ] อ่าน [13_THESIS_EVALUATION.md](13_THESIS_EVALUATION.md) เป็นบทผลการทดลอง
