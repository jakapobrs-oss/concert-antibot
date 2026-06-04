# 16 — Peak Load / Flash-Crowd: รับมือคนแห่กดบัตรตอนเปิดขาย

> โจทย์ใหญ่สุดของระบบขายบัตร: ตอน `saleStartAt` คนหลายหมื่นกระแทกพร้อมกัน (flash-crowd / thundering herd)
> เหมาะเขียน thesis หัวข้อ **"Scalability under Flash-Crowd"**
> **อัปเดต:** 2026-06-04 — implement load shedding + non-blocking audit + backoff polling

---

## 0. TL;DR

ระบบมี **Virtual Waiting Room** (ห้องรอ) เป็นแกนอยู่แล้ว = วิธีมาตรฐานอุตสาหกรรม
หลักการ: **เปลี่ยน "ฝูงชนกระแทกพร้อมกัน" → "สายน้ำที่ปล่อยทีละ batch"** เพื่อปกป้องทรัพยากรแพง (DB + payment)

เพิ่ม 3 มาตรการกันล่มตอน peak:
| # | มาตรการ | แก้คอขวด |
|---|---------|----------|
| 1 | Audit write แบบ non-blocking (`after()`) | DB write ออกจาก hot path ของ `/api/queue/join` |
| 2 | Backoff polling ตามตำแหน่งคิว | ลด RPS ของ `/api/queue/status` ~7.5× |
| 3 | Load shedding (in-flight cap) | เกินเพดาน → 503 เร็ว ๆ กัน cascading failure |

---

## 1. คอขวดที่เจอในโค้ด (ตอน 50,000 คนกระแทกพร้อมกัน)

| คอขวด | ที่ | อาการ |
|-------|-----|-------|
| ทุก join เขียน DB `BotEvent`+`QueueToken` แบบ `await` | `api/queue/join` | 50k insert กระแทก → Prisma pool หมด = ตัวแรกที่ล้ม |
| ทุกคน poll `/status` ทุก 2.5s คงที่ | `waiting-room.tsx` | 50k คน = 20,000 rps แค่ polling |
| ไม่มี load shedding | ทั้งระบบ | รับไม่ไหวแล้วยัง queue request จนช้าหมด (ตายยกแผง) |

---

## 2. มาตรการที่ทำ

### 2.1 Non-blocking audit write (#1) — `app/api/queue/join/route.ts`
- `BotEvent` (ทุก request) + `QueueToken` (ทุก slot ใหม่) เป็น **audit/analytics ไม่ใช่ critical path**
  (สถานะคิวจริงอยู่ใน Redis) → ไม่ควรให้ user รอ DB write
- เขียนผ่าน `after()` ของ Next 15 → รันหลังส่ง response แล้ว (รองรับทั้ง Node + serverless)
- มี env `QUEUE_SYNC_AUDIT=1` เพื่อสลับกลับเป็น blocking (ใช้ทำ A/B benchmark)
- **trade-off:** audit อาจหลุดบางแถวถ้า process ตายก่อน flush (แลกกับ throughput) — ข้อมูล thesis ส่วนใหญ่ยังอยู่

### 2.2 Backoff polling (#2) — `components/waiting-room.tsx`
- เดิม `setInterval(poll, 2500)` คงที่ → เปลี่ยนเป็น `setTimeout` ที่คำนวณ delay ตามตำแหน่งคิว + jitter ±25%
- คนอยู่ท้ายคิว (ยังไงก็อีกนาน) poll ห่างขึ้น → ลด RPS รวมหลายเท่า

| ตำแหน่งคิว | poll ทุก |
|---|---|
| ≤ 50 (ใกล้ถึง) | 2.5s |
| ≤ 500 | 5s |
| ≤ 2000 | 10s |
| > 2000 | 20s |

**คำนวณกับ 50,000 คน:**
- เดิม: 50,000 / 2.5s = **20,000 rps**
- ใหม่: 20 + 90 + 150 + 2,400 ≈ **2,660 rps** → **ลด ~7.5×**

### 2.3 Load shedding (#3) — `lib/load-shed.ts` + join route
- Redis counter นับ in-flight request; เกิน `MAX_INFLIGHT_JOINS` (default 500) → ตอบ 503 + `Retry-After` ทันที
- safety TTL 15s กัน counter ค้างถ้า process ตายก่อน release
- "ยอมทิ้งโหลดส่วนเกินเร็ว ๆ ดีกว่ารับทุกอันแล้วตายยกแผง"

---

## 3. ผล Load Test (prod build, single node, Postgres local)

> tool: `scripts/load-test-join.ts` (ยิง concurrent, IP/fingerprint ไม่ซ้ำ, ไม่ส่ง turnstile → วัด path เขียน BotEvent)
> ⚠️ single node + DB local — ตัวเลข **absolute** ไม่ใช่ capacity จริง production; ดูที่ **เทียบ A/B** + พฤติกรรม

### 3.1 #1 A/B (concurrency 80, 2000 req)
| โหมด | throughput | p95 | p99 |
|------|-----------|-----|-----|
| A: blocking audit (`QUEUE_SYNC_AUDIT=1`) | 515 rps | 236ms | 324ms |
| B: non-blocking `after()` | 520 rps | 260ms | 306ms |

**ต่างกันใน noise** — ที่ load ระดับนี้ Postgres local ยังไม่อิ่มตัว (insert เดียวเร็วมาก) #1 จึงเป็น **safeguard ที่ผลชัดตอน DB เป็นคอขวดจริง** (pool หมด / DB remote ช้า / scale สูงกว่านี้) ไม่ใช่ตอน DB ว่าง

### 3.2 #3 Load-shed (concurrency 150 vs cap 30, 3000 req)
| status | จำนวน |
|--------|------|
| 428 (รับเข้า) | 570 |
| 503 (shed) | 2,430 (81%) |
| error/timeout | **0** |

✅ โหลดส่วนเกิน **81% ถูกปฏิเสธแบบ controlled (503 เร็ว)** ระบบไม่ล่ม ไม่มี timeout — พิสูจน์ว่า gate ป้องกัน cascading failure ได้จริง

---

## 4. ระดับ Infra (ตอน deploy จริง — นอกเหนือจากโค้ด)

- **Scale Next แนวนอน** หลาย instance หลัง load balancer — app เป็น stateless (state อยู่ Redis/Postgres ที่ shared) scale ได้ทันที
- **PgBouncer** หน้า Postgres (transaction pooling) + ปรับ Prisma `connection_limit`
- **CDN + static holding page** ก่อนเปิดขาย (อย่าให้ SSR ทุก refresh)
- **Redis** sizing/cluster ให้พอกับ peak (queue + lock + rate limit + load-shed อยู่บนนี้หมด)

## 5. งานต่อ (ถ้าจะทำต่อ)
- [ ] SSE/WebSocket push แทน polling (ตัด poll RPS เหลือ ~0)
- [ ] cache concert status ใน Redis (เลี่ยง `concert.findUnique` ทุก join)
- [ ] batch audit write ผ่าน Redis stream → flush เป็นชุด (แทน after() ทีละแถว)
- [ ] load test บน prod build หลาย node + DB remote เพื่อหา capacity จริง
