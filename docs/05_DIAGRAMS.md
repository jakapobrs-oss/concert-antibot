# 05 — Diagrams ที่จำเป็นสำหรับโครงงาน / ปริญญานิพนธ์ / วิจัย

> ทุก diagram ใช้ Mermaid เพื่อให้แก้ง่าย + ฝังใน docs ได้
> ตอน export ขึ้น Word/PDF ใช้ mermaid-cli render เป็น PNG/SVG
>
> ✅ **ปรับให้ตรงโค้ดจริง 2026-06-12** — sync กับ `prisma/schema.prisma` + `lib/` + `app/actions/booking.ts`
> แก้จากฉบับร่างเดิม: payment Stripe → **PromptPay + EasySlip** · คิว SSE → **HTTP poll** · anti-bot 4 ชั้น → **2 ชั้น** · order timeout 15→**5 นาที** · ตัด SeatHold/Audit table ที่ไม่มีจริง (ดูตรงกับ [04_ER_DIAGRAM.md](04_ER_DIAGRAM.md))

---

## 1. System Architecture (High-Level)

```mermaid
flowchart TB
    subgraph Client["Client (Browser)"]
        UI[Next.js 15 UI<br/>React 19]
        FP[FingerprintJS<br/>collector]
        BH[Behavior collector<br/>mouse/keys/timing]
    end

    subgraph Edge["Edge"]
        CDN[Cloudflare CDN]
        TS[Cloudflare Turnstile<br/>invisible CAPTCHA]
    end

    subgraph App["Application Layer (Next.js Server)"]
        MW[Middleware<br/>rate limit + load shed]
        API[Route Handlers<br/>+ Server Actions]
        Q[Queue Service<br/>fairness + admit]
        AB[Anti-Bot Engine<br/>L1 scoring + L2 behavior]
        AUTH[NextAuth v5<br/>credentials + Google]
        PAYSVC[Payment<br/>PromptPay QR + slip verify]
    end

    subgraph Data["Data Layer"]
        PG[(PostgreSQL 16<br/>BIGSERIAL ids)]
        RD[(Redis 7<br/>queue + seat locks + rate)]
    end

    subgraph External["External Services"]
        GOO[Google OAuth]
        SMTP[Resend Email]
        ES[EasySlip API<br/>slip verification]
    end

    UI --> CDN --> MW
    FP --> API
    BH --> API
    MW --> API
    API --> Q --> RD
    API --> AB --> RD
    AB --> PG
    API --> AUTH --> GOO
    AUTH --> PG
    API --> SMTP
    API --> PAYSVC --> ES
    UI -.->|verify| TS
    AB -.->|check token| TS
```

---

## 2. Use Case Diagram

```mermaid
flowchart LR
    User((User))
    Admin((Admin))
    System[(System)]

    User --> UC1[Register / Login]
    User --> UC2[Login with Google]
    User --> UC3[Browse Concerts]
    User --> UC4[Join Queue]
    User --> UC5[Select Seats]
    User --> UC6[Pay & Get Ticket]
    User --> UC7[View My Tickets]
    User --> UC8[Verify OTP / CAPTCHA]
    User --> UC9[Report Problem]

    Admin --> UCA1[Manage Concerts]
    Admin --> UCA2[Manage Zones/Seats]
    Admin --> UCA3[View Bot Detection Log]
    Admin --> UCA4[Manage Users<br/>block/unblock]
    Admin --> UCA5[Generate Report]
    Admin --> UCA6[Adjust Anti-Bot Rules]

    System --> UCS1[Auto-detect Bot]
    System --> UCS2[Auto-release Held Seats]
    System --> UCS3[Auto-expire Queue Tokens]
    System --> UCS4[Send Notifications]
```

---

## 3. Sequence Diagram — Concert Ticket Purchase (Golden Path)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant B as Browser
    participant A as App Server
    participant R as Redis
    participant DB as PostgreSQL
    participant TS as Turnstile
    participant ES as EasySlip

    U->>B: เปิดหน้าคอนเสิร์ต → กด "เข้าคิว"
    B->>TS: render invisible Turnstile
    TS-->>B: token
    B->>A: join queue (+ turnstileToken, fingerprint)
    A->>A: Anti-Bot L1 scoring (0-100)
    alt score >= 70
        A-->>B: BLOCK 403
    else 40-69
        A-->>B: CHALLENGE (Turnstile เพิ่ม)
    end
    A->>R: issue queue token<br/>(fairness: timeBucket + randomScore)
    R-->>A: WAITING + position
    loop poll ทุก 2-20 วิ (backoff ตามตำแหน่ง)
        B->>A: GET /api/queue/status?token=...
        A->>R: on-demand admit batch
        A-->>B: position / ADMITTED
    end
    A-->>B: ADMITTED → ไปหน้าเลือกที่นั่ง
    B->>A: GET seats (เฉพาะ token ที่ถูก admit)
    A->>DB: SELECT seats WHERE status=AVAILABLE
    DB-->>A: seat list
    U->>B: เลือกที่นั่ง → ยืนยัน
    B->>A: holdAndCreateOrder(seatIds, token)
    A->>R: SET seat:lock:{id} NX EX 300 (all-or-nothing)
    A->>DB: Order(PENDING, expiresAt=+5m)<br/>+ OrderItems + Payment(PENDING)
    A->>DB: Seat.status = HELD
    A-->>B: PromptPay QR + นับถอยหลัง 5:00
    U->>B: โอนเงิน → อัปโหลดสลิป
    B->>A: submitSlip(orderId, slipImage)
    A->>A: rate limit + ตรวจชนิด/ขนาดรูป
    A->>ES: verify slip
    ES-->>A: amount, ref, senderAccount, transAt
    A->>A: ยอดตรง? + สลิปสด? + payerKey ไม่เกินเพดาน?
    A->>DB: TX: Tickets + Seat=SOLD<br/>+ Payment=SUCCESS (slipRef UNIQUE)
    A->>R: release seat locks
    A-->>B: ออกตั๋วสำเร็จ → ดู QR ตั๋ว
```

---

## 4. Anti-Bot Decision Flow

> ระบบจริงมี **2 ชั้น** (ไม่ใช่ 4): **Layer 1 = scoring** ตอนเข้าคิว (`lib/antibot.ts`) และ **Layer 2 = behavior** ตอนเลือกที่นั่ง (`lib/behavior.ts`) — ผลทั้งสองชั้น log ลง `bot_events` / `behavior_sessions`

```mermaid
flowchart TD
    REQ[Request เข้าคิว] --> RL{Rate limit<br/>+ load shed?}
    RL -- เกิน --> B429[429 Too Many]
    RL -- ok --> L1[Layer 1: Scoring 0-100]

    subgraph L1S["Signals — lib/antibot.ts"]
        S1[Turnstile pass/fail/missing]
        S2[User-Agent heuristics]
        S3[Header completeness]
        S4[Fingerprint present?]
    end
    L1 --- L1S

    L1 --> DEC{score?}
    DEC -- "&lt; 40" --> ALLOW[ALLOW → ออก queue token]
    DEC -- "40-69" --> CH[CHALLENGE<br/>Turnstile เพิ่ม]
    DEC -- "&ge; 70" --> BLK[BLOCK 403]
    CH -- pass --> ALLOW
    CH -- fail --> BLK

    ALLOW --> L2[Layer 2: Behavior<br/>ตอนเลือกที่นั่ง]
    subgraph L2S["Features — lib/behavior.ts"]
        F1[mouse timing variance<br/>ต่ำ = บอท]
        F2[mouse path entropy<br/>ต่ำ = เส้นตรง]
        F3[dwell time / move count]
    end
    L2 --- L2S
    L2 --> BS{behaviorScore}
    BS -- ปกติ --> OK[ผ่าน — log BehaviorSession]
    BS -- isLikelyBot --> FLAG[flag + log ไว้ดูใน dashboard]

    BLK --> LOG[(bot_events)]
    ALLOW --> LOG
```

---

## 5. Data Flow Diagram (DFD Level 1)

> ไม่มี data store แยกสำหรับ Audit/Report — admin dashboard อ่านตรงจาก `bot_events`/`behavior_sessions` (D4) และ `orders`/`payments` (D5)

```mermaid
flowchart LR
    U[User]
    A[Admin]

    P1((1.0<br/>Authenticate))
    P2((2.0<br/>Queue Mgmt))
    P3((3.0<br/>Anti-Bot Engine))
    P4((4.0<br/>Booking))
    P5((5.0<br/>Payment + Slip))
    P6((6.0<br/>Admin Dashboard))

    D1[(D1: users / accounts)]
    D2[(D2: concerts / zones / seats)]
    D3[(D3: queue_tokens + Redis)]
    D4[(D4: bot_events + behavior_sessions)]
    D5[(D5: orders / order_items / payments / tickets)]

    U -- credentials --> P1
    P1 -- read/write --> D1
    U -- เข้าคิว --> P2
    P2 -- token --> D3
    P2 -- signals --> P3
    P3 -- score/decision --> P2
    P3 -- log --> D4
    P2 -- admitted --> P4
    P4 -- read seats --> D2
    P4 -- create order --> P5
    P5 -- verify slip + issue tickets --> D5
    A -- query --> P6
    P6 -- read --> D4
    P6 -- read --> D5
    P6 -- read --> D2
```

---

## 6. Component Diagram (Next.js Project Structure)

```mermaid
flowchart TB
    subgraph App["app/"]
        ROOT[layout.tsx + page.tsx]
        AUTH_R["(auth)/login · register · verify"]
        CONCERT_R["(public)/concerts/[slug]"]
        QUEUE_R["concerts/[slug]/queue"]
        SEAT_R["concerts/[slug]/seats"]
        CO_R["(public)/checkout/[orderId]"]
        ME_R["(public)/account/tickets"]
        ADMIN_R["(admin)/admin/* concerts·bot-log·sales"]
        ACT["actions/* booking · auth"]
        API_R["api/queue/status"]
    end

    subgraph Lib["lib/"]
        AUTH_L[auth.ts NextAuth]
        DB_L[prisma.ts]
        REDIS_L[redis.ts ioredis]
        QUEUE_L[queue.ts fairness/admit]
        ANTIBOT_L[antibot.ts L1 + behavior.ts L2]
        TS_L[turnstile.ts]
        HOLD_L[seat-hold.ts Redis NX]
        PAY_L[promptpay.ts + easyslip.ts + slip-*.ts]
        FINAL_L[order-finalize.ts + order-sweeper.ts]
        LIMIT_L[ticket-limit.ts + payer-key.ts]
        RL_L[rate-limit.ts + load-shed.ts]
    end

    subgraph Comp["components/"]
        UI_C[ui/* shadcn]
        SEAT_C[seat-map.tsx]
        QUEUE_C[waiting-room.tsx]
        CO_C[checkout-client.tsx]
        TS_C[turnstile-widget.tsx]
    end

    subgraph PR["prisma/"]
        SCH[schema.prisma 14 models]
        SEED[seed.ts]
    end

    App --> Lib
    App --> Comp
    Lib --> PR
```

> หมายเหตุ: โปรเจกต์ใช้ `prisma db push` (ไม่มีโฟลเดอร์ `migrations/`) — `schema.prisma` คือ source of truth

---

## 7. State Diagram — Order Lifecycle

> สถานะตรง enum `OrderStatus` = `PENDING · PAID · CANCELLED · REFUNDED` (ไม่มี `FAILED` ใน order — สลิปผิดยอด/ซ้ำจะคง PENDING ให้ลองใหม่จนหมดอายุ)

```mermaid
stateDiagram-v2
    [*] --> Pending: holdAndCreateOrder<br/>(hold ที่นั่ง + PromptPay QR)
    Pending --> Paid: submitSlip → EasySlip verify ผ่าน<br/>(ออกตั๋ว, seat=SOLD)
    Pending --> Cancelled: timeout 5 นาที (sweeper)<br/>หรือผู้ใช้กดยกเลิก
    Pending --> Pending: สลิปยอดไม่ตรง/ซ้ำ → ลองใหม่
    Paid --> Refunded: admin คืนเงิน (manual)
    Cancelled --> [*]
    Refunded --> [*]
    Paid --> [*]: ตั๋วออกแล้ว
```

---

## 8. State Diagram — Seat Lifecycle

> สถานะตรง enum `SeatStatus` = `AVAILABLE · HELD · SOLD · BLOCKED` · hold อยู่ใน Redis (`SET NX EX 300`), DB sync `HELD` ตอนสร้าง order

```mermaid
stateDiagram-v2
    [*] --> Available
    Available --> Held: hold (Redis SET NX, TTL 5min)
    Held --> Available: TTL 5min หมด / ยกเลิก / order expire
    Held --> Sold: ชำระเงินสำเร็จ (ออกตั๋ว)
    Available --> Blocked: admin ปิดที่นั่ง
    Blocked --> Available: admin เปิดคืน
    Sold --> Available: admin refund
    Sold --> [*]: จบงาน
```

---

## 9. State Diagram — User Trust Score

```mermaid
stateDiagram-v2
    [*] --> New: trust=50
    New --> Verified: email+phone confirmed (+20)
    Verified --> Trusted: 3 successful purchases (+15)
    Trusted --> Suspicious: behavior anomaly (-30)
    Verified --> Suspicious: failed challenges (-25)
    Suspicious --> Verified: pass step-up challenge
    Suspicious --> Blocked: repeated violations
    Blocked --> Suspicious: admin unblock
```

---

## 10. Deployment Diagram

```mermaid
flowchart TB
    subgraph Internet
        Users[Users<br/>Browser]
    end

    subgraph Cloudflare
        CF[CDN + WAF<br/>+ Turnstile]
    end

    subgraph Production["Production VPS / Cloud"]
        N[Nginx Reverse Proxy<br/>+ TLS]
        APP1[Next.js App<br/>Docker container 1]
        APP2[Next.js App<br/>Docker container 2]
        PG_D[(PostgreSQL 16<br/>persistent volume)]
        RD_D[(Redis 7.4<br/>persistent volume)]
    end

    subgraph External_Svc["External Services"]
        GO[Google OAuth]
        RS[Resend Email]
        SE[Sentry optional]
    end

    Users --> CF --> N
    N --> APP1
    N --> APP2
    APP1 --> PG_D
    APP2 --> PG_D
    APP1 --> RD_D
    APP2 --> RD_D
    APP1 --> GO
    APP1 --> RS
    APP1 --> SE
```

---

## 11. Gantt Chart — Project Timeline (สำหรับ thesis)

```mermaid
gantt
    title โครงงานระบบแอนติบอท - Timeline 12 weeks
    dateFormat YYYY-MM-DD
    section Phase 0-1
    Planning & Docs           :done, p0, 2026-05-20, 7d
    Setup project             :p1, after p0, 5d
    section Phase 2-3
    Auth + OAuth              :p2, after p1, 7d
    Concert/Ticket CRUD       :p3, after p2, 7d
    section Phase 4-7
    Queue + Realtime          :p4, after p3, 10d
    Anti-Bot Layers           :p5, after p4, 10d
    Behavior Analysis         :p6, after p5, 7d
    Seat Hold + Payment       :p7, after p6, 7d
    section Phase 8-10
    Admin Dashboard           :p8, after p7, 7d
    Testing (unit/e2e/load)   :p9, after p8, 10d
    Documentation + thesis    :p10, after p9, 7d
```

---

## 12. Diagram Checklist สำหรับเขียน thesis

| Chapter | Diagram ที่ต้องมี | สถานะ |
|---|---|---|
| 1 บทนำ | — | — |
| 2 ทบทวนวรรณกรรม | (มีจาก research เดิมแล้ว) | ✅ |
| 3 ขั้นตอนดำเนินงาน | Gantt (#11), System Architecture (#1), DFD (#5) | ✅ ในไฟล์นี้ |
| 3 ออกแบบระบบ | Use Case (#2), ER Diagram ([04](04_ER_DIAGRAM.md)), Sequence (#3), Anti-Bot Flow (#4) | ✅ |
| 3 รายละเอียดเพิ่ม | Component (#6), State diagrams (#7, #8, #9) | ✅ |
| 4 ผลและการทดสอบ | Screenshots + load test charts | ⏳ ทำตอน implement |
| 4 Deployment | Deployment (#10) | ✅ |

---

## 13. วิธี export เป็นรูป (สำหรับใส่ Word)

```bash
# install mermaid-cli
pnpm add -g @mermaid-js/mermaid-cli

# render diagram ทั้งไฟล์เป็น svg/png
mmdc -i docs/05_DIAGRAMS.md -o thesis/img/diagram-%d.png -t neutral -b white
```
