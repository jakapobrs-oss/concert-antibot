# 05 — Diagrams ที่จำเป็นสำหรับโครงงาน / ปริญญานิพนธ์ / วิจัย

> ทุก diagram ใช้ Mermaid เพื่อให้แก้ง่าย + ฝังใน docs ได้
> ตอน export ขึ้น Word/PDF ใช้ mermaid-cli render เป็น PNG/SVG

---

## 1. System Architecture (High-Level)

```mermaid
flowchart TB
    subgraph Client["Client (Browser)"]
        UI[Next.js UI<br/>React 19]
        FP[FingerprintJS<br/>collector]
        BH[Behavior collector<br/>mouse/keys/scroll]
    end

    subgraph Edge["Edge Layer"]
        CDN[Cloudflare CDN]
        WAF[Cloudflare WAF<br/>+ Turnstile]
    end

    subgraph App["Application Layer (Next.js Server)"]
        MW[Middleware<br/>rate limit + bot score]
        API[Route Handlers<br/>+ Server Actions]
        Q[Queue Service]
        AB[Anti-Bot Engine]
        AUTH[NextAuth<br/>credentials + Google]
    end

    subgraph Data["Data Layer"]
        PG[(PostgreSQL 16<br/>BIGSERIAL ids)]
        RD[(Redis 7.4<br/>queue + locks + rate)]
    end

    subgraph External["External"]
        TS[Turnstile API]
        GOO[Google OAuth]
        SMTP[Resend Email]
        PAY[Stripe/Omise<br/>future]
    end

    UI --> CDN --> WAF --> MW
    FP --> MW
    BH --> API
    MW --> API
    API --> Q --> RD
    API --> AB --> RD
    AB --> PG
    API --> AUTH
    AUTH --> GOO
    AUTH --> PG
    API --> SMTP
    API --> PAY
    WAF --> TS
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
    participant E as Edge/WAF
    participant A as App Server
    participant Q as Queue (Redis)
    participant DB as PostgreSQL
    participant T as Turnstile

    U->>B: Click "Buy Ticket"
    B->>E: GET /book/123
    E->>T: Verify (invisible)
    T-->>E: OK
    E->>A: Forward + bot_score header
    A->>A: Check sale_start_at
    alt Before sale time
        A-->>B: Redirect /queue/wait
    end
    A->>Q: Issue queue token
    Q-->>A: token + position 1247
    A-->>B: 302 → /queue?token=...
    B->>A: SSE /queue/stream
    A-->>B: position: 1247 → 800 → ... → 0
    A-->>B: redirect /book/123/select
    B->>A: GET /book/123/select (with token)
    A->>DB: SELECT available seats
    DB-->>A: list
    A-->>B: render seat map
    U->>B: pick seats
    B->>A: POST /seats/hold
    A->>Q: SETNX seat:lock:X with TTL 5min
    Q-->>A: OK
    A->>DB: insert SeatHold
    A-->>B: hold success, countdown 5:00
    U->>B: confirm + pay
    B->>A: POST /order/checkout
    A->>DB: transaction: order + tickets + seat=sold
    A->>Q: release locks
    A-->>B: order confirmed
    B->>A: GET /my-tickets
    A-->>B: QR code list
```

---

## 4. Anti-Bot Decision Flow

```mermaid
flowchart TD
    REQ[Incoming Request] --> L1{Layer 1:<br/>IP/Rate/UA?}
    L1 -- bad --> BLK1[Block 403]
    L1 -- ok --> L2{Layer 2:<br/>Header/TLS<br/>fingerprint?}
    L2 -- suspicious --> CH1[Challenge:<br/>Invisible Turnstile]
    L2 -- ok --> L3{Layer 3:<br/>Browser FP<br/>+ headless?}
    L3 -- headless --> CH2[Challenge:<br/>Visible CAPTCHA]
    L3 -- ok --> L4{Layer 4:<br/>Behavior score}
    L4 -- low score --> CH2
    L4 -- ok --> ALLOW[Allow + log]
    CH1 -- pass --> L4
    CH1 -- fail --> CH2
    CH2 -- pass --> STEP[Step-up:<br/>OTP/Email]
    CH2 -- fail --> BLK2[Block + raise log]
    STEP -- pass --> ALLOW
    STEP -- fail --> BLK2
```

---

## 5. Data Flow Diagram (DFD Level 1)

```mermaid
flowchart LR
    U[User]
    A[Admin]

    P1((1.0<br/>Authenticate))
    P2((2.0<br/>Queue Mgmt))
    P3((3.0<br/>Anti-Bot Engine))
    P4((4.0<br/>Booking))
    P5((5.0<br/>Payment))
    P6((6.0<br/>Reporting))

    D1[(D1: Users)]
    D2[(D2: Concerts/Seats)]
    D3[(D3: Queue Tokens)]
    D4[(D4: Behavior + Bot Logs)]
    D5[(D5: Orders/Tickets)]
    D6[(D6: Audit/Reports)]

    U -- credentials --> P1
    P1 -- read/write --> D1
    U -- buy intent --> P2
    P2 -- token --> D3
    P2 -- behavior --> P3
    P3 -- score --> D4
    P3 -- decision --> P2
    P2 -- allow --> P4
    P4 -- read/write --> D2
    P4 -- create order --> P5
    P5 -- update --> D5
    A -- query --> P6
    P6 -- read --> D4
    P6 -- read --> D5
    P6 -- write --> D6
```

---

## 6. Component Diagram (Next.js Project Structure)

```mermaid
flowchart TB
    subgraph App["app/"]
        ROOT[layout.tsx + page.tsx]
        AUTH_R["(auth)/login, register"]
        CONCERT_R["(public)/concert/[slug]"]
        QUEUE_R["queue/[concertId]"]
        BOOK_R["book/[concertId]"]
        CO_R["checkout"]
        ME_R["my-tickets"]
        ADMIN_R["(admin)/dashboard"]
        API_R["api/* route handlers"]
    end

    subgraph Lib["lib/"]
        AUTH_L[auth.ts NextAuth config]
        DB_L[db.ts Prisma client]
        REDIS_L[redis.ts ioredis]
        QUEUE_L[queue/ service]
        ANTIBOT_L[antibot/ engine]
        CAPTCHA_L[captcha/ turnstile]
        FP_L[fingerprint/ verify]
        PAYMENT_L[payment/ mock+stripe]
    end

    subgraph Comp["components/"]
        UI_C[ui/* shadcn]
        SEAT_C[SeatMap.tsx]
        QUEUE_C[QueueWidget.tsx]
        FORM_C[forms/*]
    end

    subgraph PR["prisma/"]
        SCH[schema.prisma]
        MIG[migrations/]
        SEED[seed.ts]
    end

    App --> Lib
    App --> Comp
    Lib --> PR
```

---

## 7. State Diagram — Order Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created: user starts checkout
    Created --> Pending: submit payment
    Pending --> Paid: provider confirms
    Pending --> Failed: provider rejects
    Pending --> Cancelled: timeout 15min
    Failed --> Pending: retry
    Paid --> Refunded: admin refund
    Cancelled --> [*]
    Refunded --> [*]
    Paid --> [*]: tickets issued
```

---

## 8. State Diagram — Seat Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Available
    Available --> Held: user clicks
    Held --> Available: TTL 5min expires
    Held --> Available: user cancels
    Held --> Sold: order paid
    Sold --> Available: admin refund
    Sold --> [*]: event ended
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
