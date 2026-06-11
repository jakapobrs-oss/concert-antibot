# Design — "Midnight Stage"

ระบบ design ของ Concert Anti-Bot (redesign 2026-06-10)
คอนเซ็ปต์: **กลางคืนหน้าเวที** — ทั้งเว็บโทนมืดอมแดงอุ่น มีไฟเวที 2 ดวง
(แดง scarlet = action/แบรนด์, ทองอำพัน = spotlight/ตัวเลขสำคัญ)
ตัวเลขสำคัญทุกตัว (คิว, นับถอยหลัง, ราคา) เป็น "ป้าย LED"
Source of truth ของ token จริง: `app/globals.css` (`@theme`)

## Theme

- **Dark เท่านั้น** ทั้ง public + admin (`color-scheme: dark`)
- Contrast เข้มงวดกว่า AA เพราะต้องฉายโปรเจคเตอร์ตอนสอบ: ตัวหนังสือหลัก ~14:1, รอง ~8:1, caption ~5:1
- texture: `.bg-grain` (SVG noise overlay) กันพื้นไล่เฉดดูแบน, `.bg-stage` (พื้นลึก + ambience แดงมุมจอ), `.bg-spotlight` (แสงสาดจากบน)

## Colors (OKLCH ทั้งหมด — ดูค่าจริงใน globals.css)

| Role | Token | ใช้กับ |
|---|---|---|
| พื้น body | `ink-950` | ทั้งเว็บ |
| พื้นลึกสุด | `ink-deep` | hero, footer, ป้าย LED |
| Surface การ์ด | `ink-850` (hover `ink-800`) | การ์ด, แผง, ตาราง |
| เส้นขอบ | `fg/10` – `fg/15` | ขอบการ์ด/ช่องกรอก |
| ตัวหนังสือ | `fg` / `fg-dim` / `fg-faint` | หลัก / รอง / caption |
| แบรนด์ (ไฟแดง) | `brand-600` ปุ่ม, `brand-400/300` ตัวหนังสือ-ไอคอน, `brand-500` glow | action, สถานะ live |
| Spotlight (อำพัน) | `spot-300` เลข LED ใหญ่, `spot-400` ราคา | ราคา, เลขคิว, เลขสถิติ |
| Semantic | `success / warning / danger / info` + พื้น `/10`–`/12` | สถานะ |

ห้าม: เทาจางบนดำ (ต่ำกว่า `fg-faint`), สี accent เต็มความอิ่มบน state ที่ไม่ active

## Typography

- **Anuphan** (`--font-sans`) — เนื้อหา, ฟอร์ม, ตาราง
- **Chakra Petch** (`--font-display`, weight 400–700) — หัวข้อ, ปุ่ม, ป้าย, ตัวเลข LED
- `.text-led` = display + tabular-nums — ใช้กับเลขคิว/นับถอยหลัง/ราคา
- hero: `text-5xl sm:text-7xl` bold, tracking-tight; หัวข้อ section: `text-3xl`; การ์ด: base–xl

## Components (`components/ui/*` + shared)

- `Button` — primary (แดง + glow), secondary, outline, ghost, subtle, danger · sm/md/lg · ครบ state + loading
- `Card / Badge / Input / Label / Textarea` — โทนมืดทั้งชุด; Badge มี tone `spot` เพิ่ม
- `EqBars` — แท่ง equalizer เด้ง (currentColor) = สัญลักษณ์ "กำลังขาย/มีชีวิต" ใช้ใน logo, badge, dashboard
- `Marquee` — แถบตัววิ่ง (เนื้อหาซ้ำ 2 ชุด เลื่อน -50%)
- `SiteHeader` (sticky, ink-deep/85 + blur) / `SiteFooter` (stage + แถบ barcode)
- การ์ดตั๋ว (account/tickets) — ticket stub: QR บนพื้นขาว + รอยปรุ `.border-perforated-y` + รูเจาะ + `.bg-barcode`
- **QR ทุกตัวต้องอยู่บนพื้นขาวเสมอ** (สแกนได้)

## Motion (ทุกตัวมี reduced-motion fallback ใน globals.css)

- `animate-fade-in-up` + `animationDelay` = stagger ตอนเข้า hero/รายการ
- `animate-marquee` ป้ายวิ่ง · `animate-eq` equalizer · `animate-drift-a/b` แสงไฟลอยใน hero
- `animate-glow-pulse` ที่นั่งที่เลือก · `animate-blink` โคลอนนาฬิกา LED · `animate-shimmer` แสงวิ่งบน progress
- admin = product register: ไม่มี motion ตกแต่ง ใช้เฉพาะสื่อสถานะ

## Register ต่อหน้า

- หน้า public (home, listing, detail) = brand energy เต็มที่ (แสง, marquee, stagger)
- flow จอง (queue, seats, checkout) = ความชัดเจนมาก่อน — ตัวเลขใหญ่ สถานะชัด
- admin = เรียบ อ่านเร็ว ข้อมูลแน่น

## เครื่องมือตรวจงาน

- `pnpm exec tsx scripts/shoot-design.ts` — screenshot ทุกหน้า (รวม login + flow จองจริง) ลง `.shots/design/`
  ต้องมี dev server `:3000` + `pnpm db:up` ก่อน
