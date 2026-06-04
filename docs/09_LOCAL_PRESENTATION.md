# 09 — Local Setup สำหรับ Presentation อาจารย์ + Multi-Device

> ไม่มี cloud deploy — run บน **laptop ตัวเอง** แล้วให้ **iPhone / iPad / Android / Notebook อื่น** เข้ามาดูพร้อมกันได้
> ต้อง **responsive ทุกอุปกรณ์**

---

## 1. สถาปัตยกรรมตอน Presentation

```
[ Laptop ของเรา (host) ]
   ├── Next.js dev server     :3000
   ├── PostgreSQL (Docker)    :5432
   ├── Redis (Docker)         :6379
   └── MinIO (Docker)         :9000 (file storage local)

  ↕ Wi-Fi เดียวกัน (router ห้อง / hotspot ของเรา)

[ อาจารย์ iPhone ] [ iPad ] [ เพื่อน Android ] [ Laptop อาจารย์ ]
   เข้าผ่าน:  http://192.168.x.x:3000
```

> เรา **เป็น host** — เปิด server บน laptop ตัวเอง
> คนอื่น **เป็น client** — เปิด browser เข้ามาที่ IP ของเรา

---

## 2. การเตรียม Network (สำคัญ)

### Option A: ใช้ Wi-Fi เดียวกัน (แนะนำ)
ทุกคนต่อ Wi-Fi เดียวกัน (router ห้องเรียน หรือ Wi-Fi มหาวิทยาลัย)

**ข้อระวัง:** บาง Wi-Fi มี **Client Isolation** เปิดไว้ จะติดต่อกันไม่ได้ → ต้องลอง ping ก่อน

### Option B: Hotspot ของเรา (สำรอง — ใช้เกือบทุกที่ได้)
- เปิด **Mobile Hotspot** จาก iPhone/Android ของตัวเอง
- Laptop ต่อ Hotspot นี้
- อาจารย์ + เพื่อน ต่อ Hotspot เดียวกัน
- ทุกคนอยู่ในวง LAN เดียวกัน → เห็นกันได้แน่นอน

**ข้อระวัง:** กิน data มือถือ + อาจารย์ต้องยอมต่อ network เรา

### Option C: USB Tethering สำรองสุด
ถ้า Hotspot ไม่ stable

---

## 3. หา IP ของ Laptop

### Windows (PowerShell)
```powershell
ipconfig | Select-String "IPv4"
# ดู IPv4 Address ของ Wi-Fi adapter: เช่น 192.168.1.42
```

### macOS / Linux
```bash
ipconfig getifaddr en0   # macOS
hostname -I              # Linux
```

> จด IP ไว้ — เช่น `192.168.1.42`
> อาจารย์เปิด: `http://192.168.1.42:3000`

---

## 4. รัน Next.js ให้เครื่องอื่นเข้าได้

### 4.1 package.json
```json
{
  "scripts": {
    "dev": "next dev -H 0.0.0.0 -p 3000",
    "dev:lan": "next dev -H 0.0.0.0 -p 3000",
    "start:demo": "docker-compose up -d && pnpm dev:lan"
  }
}
```

> Flag `-H 0.0.0.0` = bind ทุก network interface (default คือ localhost เท่านั้น → เครื่องอื่นเห็นไม่ได้)

### 4.2 Windows Firewall
PowerShell run as Admin (รันแค่ครั้งแรก):
```powershell
New-NetFirewallRule -DisplayName "Next.js Dev (3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

### 4.3 ตั้ง Environment Variable
ใน `.env.local`:
```
NEXTAUTH_URL=http://192.168.1.42:3000     # ใช้ IP จริงของ laptop
NEXT_PUBLIC_APP_URL=http://192.168.1.42:3000
```

> เปลี่ยน IP ทุกครั้งที่ network เปลี่ยน
> เขียน script auto-detect ก็ได้

---

## 5. Workaround สำหรับ Google OAuth (สำคัญ)

Google OAuth ต้องใช้ redirect URL ที่ลงทะเบียนใน Google Console:
- ❌ `http://192.168.1.42:3000/api/auth/callback/google` — Google รับ
- ⚠️ แต่ต้อง **add ใน Authorized redirect URIs** ใน Google Cloud Console ก่อน

### ขั้นตอน
1. ไป [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. แก้ OAuth Client → เพิ่ม Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `http://192.168.1.42:3000/api/auth/callback/google` (IP ของ laptop)
3. Save

### ปัญหา: Google ไม่ให้ใช้ private IP บางครั้ง
- ✅ `http://localhost:3000` Google ยอม
- ⚠️ `http://192.168.x.x:3000` Google ยอม (พวก private IP ใช้ได้แต่ไม่มี TLS)
- ❌ `https://192.168.x.x:3000` ต้องมี cert จริง

**ทางแก้ที่ดีกว่า:**

### Option: ใช้ `mDNS / .local` hostname
- macOS / iOS รองรับ Bonjour โดยอัตโนมัติ
- Windows: ติดตั้ง [Bonjour Print Services](https://support.apple.com/kb/DL999) หรือ Apple iTunes
- ตั้งชื่อ laptop เช่น `concertdemo.local`
- ทุกอุปกรณ์เปิด `http://concertdemo.local:3000`
- จด redirect URI: `http://concertdemo.local:3000/api/auth/callback/google`

### Option ดีที่สุด: Cloudflare Tunnel (free, ชั่วคราว)
```bash
# install cloudflared แล้วรัน
cloudflared tunnel --url http://localhost:3000
# ได้ URL ชั่วคราว เช่น https://random-name.trycloudflare.com
```
- มี **HTTPS** + accessible จากทุกที่ (ไม่ต้องอยู่ Wi-Fi เดียวกัน)
- Google OAuth ใช้ได้สบาย
- Payment provider webhook callback ได้ด้วย!
- **ฟรี ไม่ต้องสมัคร**

> **แนะนำ:** ใช้ Cloudflare Tunnel ตอน present จริง = อาจารย์เปิดจากที่ไหนก็ได้

---

## 6. Responsive Design Requirements

### 6.1 Breakpoint Strategy (Tailwind 4)
| Device | Width | Tailwind prefix |
|---|---|---|
| Mobile (iPhone SE) | 320-480px | (default) |
| Phablet | 481-640px | `sm:` |
| Tablet portrait (iPad) | 641-768px | `md:` |
| Tablet landscape / Small laptop | 769-1024px | `lg:` |
| Desktop | 1025-1280px | `xl:` |
| Large desktop | 1281+ | `2xl:` |

### 6.2 ต้องทดสอบบนอุปกรณ์จริง (ของอาจารย์/เพื่อน)
- ✅ iPhone 13 Pro (user ใช้อยู่)
- ✅ iPad (อาจารย์อาจมี)
- ✅ Android phone อย่างน้อย 1 รุ่น
- ✅ Notebook 13"
- ✅ Desktop monitor 24"+

### 6.3 Mobile-First Components ที่ต้องระวังเป็นพิเศษ
| Component | Mobile | Desktop |
|---|---|---|
| **Seat Map** | pinch-zoom + pan, big tap target (44px min) | mouse hover, scroll wheel |
| **Queue position** | full-screen, big countdown | corner widget |
| **Booking form** | single column, sticky CTA bottom | 2-column, side panel |
| **Admin dashboard** | hamburger menu, simplified table | sidebar nav, full table |
| **Concert card** | 1 col → 2 col `sm:` | 3-4 col `lg:` |

### 6.4 Touch Optimization
- Minimum tap target: **44x44px** (Apple HIG) / **48x48dp** (Material)
- Hover state → tap feedback (`active:` class)
- ห้ามใช้ `:hover` เป็น primary interaction
- Disable double-tap zoom: `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">`
- Smooth scroll, momentum scrolling (`-webkit-overflow-scrolling: touch`)

### 6.5 PWA (Progressive Web App) — แนะนำ
ทำให้ "เพิ่มไปหน้าจอหลัก" บน iPhone/iPad ได้ → ดูเหมือนแอป

```bash
pnpm add next-pwa
# หรือ
pnpm add @ducanh2912/next-pwa  # better Next 15 support
```

- มี `manifest.json`
- มี Service Worker (basic offline)
- icon 512x512 + 192x192
- works on iOS Safari (Add to Home Screen)

### 6.6 Testing บน device จริง (วิธี)
1. **Safari iOS Inspector:** Mac + iPhone → USB → Safari → Develop menu → เห็น DOM ของ iPhone
2. **Chrome Android Inspector:** USB debug → chrome://inspect
3. **BrowserStack** (free trial) — ทดสอบ device ที่ไม่มี
4. **Responsively App** (free, open source) — ดู mockup หลาย device พร้อมกัน

---

## 7. Demo Day Checklist (1 ชม. ก่อน present)

### Pre-flight
- [ ] Laptop ชาร์จเต็ม + adapter
- [ ] Docker Desktop เปิดอยู่
- [ ] รัน `docker-compose up -d` (postgres + redis + minio)
- [ ] รัน `pnpm db:seed` ใส่ demo concert + admin
- [ ] รัน `pnpm dev:lan`
- [ ] ทดสอบเปิดจากมือถือตัวเองก่อน (smoke test)

### Network
- [ ] ตั้ง Hotspot สำรอง พร้อม password ที่จำง่าย
- [ ] เตรียม **QR code** ชี้ไป URL → อาจารย์สแกนเปิดได้เลย
- [ ] หรือใช้ Cloudflare Tunnel ได้ URL HTTPS ฟรี

### Content
- [ ] มี demo concert อย่างน้อย 2-3 รายการ
- [ ] มี admin account demo + user account demo
- [ ] เตรียม script presentation 10-15 นาที
- [ ] มี slide PowerPoint backup (ถ้าระบบเจ๊ง)

### Backup
- [ ] บันทึก video demo ระบบไว้ (เผื่อ live demo เจ๊ง)
- [ ] เตรียม screenshot ทุกหน้าจอใน slide
- [ ] export ER diagram + diagrams เป็น PNG

---

## 8. Multi-User Concurrent Demo

ตอน present จะให้อาจารย์ + เพื่อนกดเข้าคิวพร้อมกัน → demo ให้เห็น queue + anti-bot ทำงาน:

### Script Demo (5 นาที)
1. **เปิดขาย** (admin set `sale_start_at = now`)
2. **อาจารย์** กด "ซื้อบัตร" บน iPad → ถูกส่งไปคิว → ตำแหน่ง 1
3. **เพื่อน 1** กด → คิวตำแหน่ง 2
4. **เพื่อน 2 (bot จำลอง — curl rapid fire)** → โดน Turnstile / rate limit → block
5. **เพื่อน 3** กดผ่าน browser ปกติ → คิว ตำแหน่ง 3
6. ระบบปล่อย batch → ทุกคนเข้าหน้าเลือกที่นั่ง
7. เลือก → 5-min hold timer
8. จ่ายเงิน (sandbox) → ได้บัตร QR

**Key talking points:**
- ✅ Fairness: ทุกคนเข้าคิว FIFO + randomized batch
- ✅ Anti-bot: bot ถูก block แต่คนจริงผ่าน
- ✅ Real-time: SSE update queue position
- ✅ Multi-device: ดูได้ทั้ง iPad, มือถือ, laptop พร้อมกัน

---

## 9. แก้ปัญหาที่พบบ่อย

| ปัญหา | สาเหตุ | แก้ |
|---|---|---|
| มือถือเปิดไม่ได้ | Wi-Fi Client Isolation | ใช้ Hotspot ของตัวเอง |
| มือถือเปิดได้ แต่ image ไม่โหลด | `next.config.js` images domain ไม่มี IP | เพิ่ม IP ใน `remotePatterns` |
| Google login fail | redirect URI ไม่ตรง | เพิ่ม IP ใน Google Console |
| SSE/WebSocket disconnect บนมือถือ | Wi-Fi sleep, mobile data switch | ใส่ auto-reconnect logic |
| ช้ามากตอนหลายคนเปิด | dev mode ช้า | ใช้ `next build && next start` แทน `next dev` |
| Payment webhook ไม่มา | webhook ต้อง public URL | ใช้ Cloudflare Tunnel ตอน demo |

---

## 10. สรุป: Stack สำหรับ Local Demo (ไม่ deploy)

| Layer | ใช้ | หมายเหตุ |
|---|---|---|
| App | Next.js dev/prod build, port 3000 | bind 0.0.0.0 |
| DB | PostgreSQL ใน Docker | persistent volume |
| Cache | Redis ใน Docker | |
| File | MinIO ใน Docker | S3-compatible local |
| Email | Resend (cloud) | dev key ใช้ได้ทันที |
| OAuth | Google Cloud (cloud) | ต้องเพิ่ม redirect URI |
| Payment | Omise sandbox / Stripe test | ดู `10_PAYMENT_PROVIDERS.md` |
| Tunnel (ถ้าจำเป็น) | Cloudflare Tunnel (ฟรี) | สำหรับ HTTPS + webhook |

### ❌ ไม่ต้องใช้ (ตัดออกจากแผน)
- ~~VPS / Hetzner / Vercel~~
- ~~Caddy / Nginx production~~
- ~~DNS / Domain~~
- ~~Container registry~~
- ~~pg_dump backup automation~~ (ทำ manual ก็ได้)
- ~~Sentry / UptimeRobot~~ (optional)
- ~~Cloudflare R2~~ (ใช้ MinIO local แทน)

> สิ่งที่ตัดออกยังอยู่ในไฟล์ `03_TOOLS_AND_VERSIONS.md` ในกรณีอนาคตอยาก deploy จริง
