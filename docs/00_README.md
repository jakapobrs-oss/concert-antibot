# 📚 Project-end Docs Index

> **โปรเจ็คจบ: ระบบจองบัตรคอนเสิร์ตที่มี Anti-Bot**
> ดูทุกอย่างเริ่มจากไฟล์นี้

---

## 🎯 อ่านตามลำดับนี้ (สำหรับ user/Claude/อาจารย์/คนใหม่)

| # | ไฟล์ | สำหรับ | สรุป |
|---|---|---|---|
| 0 | [00_README.md](00_README.md) | ทุกคน | index — ไฟล์นี้ |
| 1 | [01_PLAN.md](01_PLAN.md) | ทุกคน | แผนหลัก + progress tracker + checklist |
| 2 | [02_RECOMMENDATIONS.md](02_RECOMMENDATIONS.md) | user | สิ่งที่แนะนำเพิ่ม + เหตุผล |
| 3 | [03_TOOLS_AND_VERSIONS.md](03_TOOLS_AND_VERSIONS.md) | dev | tech stack + version lock (12 หมวด) |
| 4 | [04_ER_DIAGRAM.md](04_ER_DIAGRAM.md) | dev / thesis | database schema + Prisma skeleton |
| 5 | [05_DIAGRAMS.md](05_DIAGRAMS.md) | thesis | use case, sequence, architecture, DFD, state, deployment |
| 6 | [06_RESEARCH_SUMMARY.md](06_RESEARCH_SUMMARY.md) | thesis | สรุปวิจัยเดิม + gap analysis |
| 7 | [07_RESPONSIBILITIES.md](07_RESPONSIBILITIES.md) | user | Claude ทำอะไร vs User ต้องทำอะไร + Decision Points |
| 8 | [08_VERIFICATION.md](08_VERIFICATION.md) | ทุกคน | รายงาน audit ครบทุกด้าน (9.5/10) |
| 9 | [09_LOCAL_PRESENTATION.md](09_LOCAL_PRESENTATION.md) | user | รัน local + multi-device demo + responsive |
| 10 | [10_PAYMENT_PROVIDERS.md](10_PAYMENT_PROVIDERS.md) | user / dev | **PromptPay + Slip verify** (ฟรี + เงินเข้าจริง) |
| 11 | [11_REQUIREMENTS.md](11_REQUIREMENTS.md) | ทุกคน | **Single source of truth** — ทุก requirement รวมที่เดียว |
| 12 | [12_CHANGELOG.md](12_CHANGELOG.md) | ทุกคน | **Session history** — ทุก revision + เหตุผล |
| 13 | [13_THESIS_EVALUATION.md](13_THESIS_EVALUATION.md) | **thesis** | **บทผลการทดลอง** — abstract + ผล load test/anti-bot/fairness (ตัวเลขจริง) |
| 14 | [14_SCREENSHOTS_GUIDE.md](14_SCREENSHOTS_GUIDE.md) | user | คู่มือถ่ายภาพหน้าจอ 14 หน้า + demo script + คำสั่งเก็บผล |
| 15 | [15_PAYMENT_SECURITY.md](15_PAYMENT_SECURITY.md) | dev / **thesis** | **ความปลอดภัยการตรวจจ่ายเงิน** — threat model, defense levels, ข้อจำกัด + Level 3 future work |

---

## 🚦 สถานะปัจจุบัน — 🟢 เสร็จครบ 11/11 phases (verified)

| Phase | สถานะ |
|---|---|
| 0 Planning & Docs | ✅ |
| 1 Setup | ✅ verified (build ผ่าน 22 routes) |
| 2 Auth (NextAuth v5 + RBAC) | ✅ verified |
| 3 Concert/Seat CRUD | ✅ verified |
| 4 Virtual Waiting Room (fairness) | ✅ verified (inversion 96.8%) |
| 5 Anti-Bot L1 (Turnstile/fingerprint) | ✅ verified |
| 6 Anti-Bot L2 (behavior + rate limit) | ✅ verified |
| 7 Seat Hold + Payment (PromptPay) | ✅ verified (race 1/2000) |
| 8 Admin Dashboard | ✅ verified |
| 9 Testing + Load test | ✅ verified (unit 9/9, load 2000 คน) |
| 10 Documentation | ✅ (doc 13-14) |

> **โปรเจ็คพร้อมส่ง** — รันจริง + verified ทุก phase, production build ผ่าน, 0 บาท/เดือน
> เริ่มอ่านบทผลการทดลองที่ [13_THESIS_EVALUATION.md](13_THESIS_EVALUATION.md)

---

## 🧭 Quick Navigation

**อยากรู้ว่าโปรเจ็คนี้คืออะไร?** → [01_PLAN.md §1](01_PLAN.md)
**อยากรู้ว่าจะใช้อะไรบ้าง?** → [03_TOOLS_AND_VERSIONS.md](03_TOOLS_AND_VERSIONS.md)
**อยากดู database schema?** → [04_ER_DIAGRAM.md](04_ER_DIAGRAM.md)
**อยากเขียน thesis ใช้ diagram ไหน?** → [05_DIAGRAMS.md §12](05_DIAGRAMS.md)
**อยากเทียบกับวิจัยเดิม?** → [06_RESEARCH_SUMMARY.md](06_RESEARCH_SUMMARY.md)
**อยากให้แนะนำเพิ่ม?** → [02_RECOMMENDATIONS.md](02_RECOMMENDATIONS.md)
**อยากรู้ว่าใครทำอะไร (Claude vs User)?** → [07_RESPONSIBILITIES.md](07_RESPONSIBILITIES.md)
**อยากดูว่า audit ผ่านมั้ย?** → [08_VERIFICATION.md](08_VERIFICATION.md)
**อยากรู้วิธีรัน local + ให้อาจารย์เปิดดูบนมือถือ?** → [09_LOCAL_PRESENTATION.md](09_LOCAL_PRESENTATION.md)
**อยากรู้จ่ายเงินใช้อะไรดี?** → [10_PAYMENT_PROVIDERS.md](10_PAYMENT_PROVIDERS.md)
**อยากรู้ว่าระบบจ่ายเงินปลอดภัยแค่ไหน + ช่องโหว่?** → [15_PAYMENT_SECURITY.md](15_PAYMENT_SECURITY.md)
**อยากรู้ requirements ทั้งหมด?** → [11_REQUIREMENTS.md](11_REQUIREMENTS.md)
**อยากดู changelog?** → [12_CHANGELOG.md](12_CHANGELOG.md)

---

## 📁 โครงสร้างโฟลเดอร์ (ปัจจุบัน)

```
E:\Claude-WorkSpace\Project-end\
├── วิจัยระบบแอนติบอท finish.docx    ← วิจัยอ้างอิง (อ่านอย่างเดียว)
└── docs/
    ├── 00_README.md                  ← คุณอยู่ที่นี่
    ├── 01_PLAN.md
    ├── 02_RECOMMENDATIONS.md
    ├── 03_TOOLS_AND_VERSIONS.md
    ├── 04_ER_DIAGRAM.md
    ├── 05_DIAGRAMS.md
    ├── 06_RESEARCH_SUMMARY.md
    ├── 07_RESPONSIBILITIES.md
    ├── 08_VERIFICATION.md
    ├── 09_LOCAL_PRESENTATION.md
    ├── 10_PAYMENT_PROVIDERS.md
    ├── 11_REQUIREMENTS.md
    ├── 12_CHANGELOG.md
    ├── 13_THESIS_EVALUATION.md
    ├── 14_SCREENSHOTS_GUIDE.md
    └── 15_PAYMENT_SECURITY.md
```

## 🎯 Project Constraints (revision 3 — 2026-05-25)

1. 🏠 **Local-only** — run บน laptop ตัวเอง, ไม่ deploy cloud
2. 📱 **Multi-device** — iPhone/iPad/Android/Desktop ทุก browser
3. 💰 **Real payment + เงินเข้าจริง** — PromptPay QR + EasySlip verify
4. 🇹🇭 **THB เท่านั้น**
5. 💸 **0 บาท/เดือน** — Tier 1 (ฟรี) ทั้งหมด, paid = optional only

## 📁 โครงสร้างที่จะมีหลังเริ่ม Phase 1 (Setup)

```
E:\Claude-WorkSpace\Project-end\
├── docs/                             ← เอกสารทั้งหมด
├── app/                              ← Next.js app router
├── components/                       ← React components
├── lib/                              ← utility libraries
├── prisma/                           ← schema + migrations + seed
├── public/                           ← static assets
├── tests/                            ← unit + e2e + load
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md                         ← root (สำหรับ git)
```

---

## ❓ FAQ

**Q: ใช้ Next.js หรืออะไรอย่างอื่นดี?**
A: Next.js 15 + TypeScript ดีที่สุด เพราะ all-in-one (frontend+backend), ตลาดงานใหญ่, รองรับ SSR/Server Actions. ดู alternatives ใน [01_PLAN.md §3.2](01_PLAN.md)

**Q: Database ใช้ตัวไหน?**
A: PostgreSQL 16 (default) — ใช้ BIGSERIAL เป็น id ตัวเลข. ถ้าอยากใช้ MySQL 8.4 (ตามวิจัยเดิม) ก็ทำได้ เปลี่ยน Prisma provider อย่างเดียว

**Q: ทำไมต้องมี Queue + Virtual Waiting Room?**
A: เพื่อให้ "ทุกคนมีสิทธิ์เท่ากัน" ตาม requirement — ดู [02_RECOMMENDATIONS.md §B](02_RECOMMENDATIONS.md)

**Q: Anti-bot มีกี่ชั้น?**
A: 8 ชั้น defense-in-depth — ดู [02_RECOMMENDATIONS.md §A](02_RECOMMENDATIONS.md)

**Q: เริ่ม code ได้เมื่อไหร่?**
A: เมื่อ user approve — พิมพ์ "approve" หรือ "เริ่มได้" ในแชท แล้วจะเริ่ม Phase 1

---

## 🤖 หมายเหตุสำหรับ Claude (Agent)

- ไฟล์ docs ทั้งหมดอ่าน/แก้ได้
- ไฟล์ `วิจัยระบบแอนติบอท finish.docx` **อ่านได้อย่างเดียว ห้ามแก้**
- ทุกครั้งที่ทำงานเสร็จในแต่ละ phase → update progress ใน [01_PLAN.md §4](01_PLAN.md)
- ทุก dependency ใหม่ → เช็คก่อนว่าตรงกับ [03_TOOLS_AND_VERSIONS.md](03_TOOLS_AND_VERSIONS.md)
- ใช้ usage limit 30-50% — ถ้าใกล้เต็ม ให้สรุปและ commit, ค่อยทำต่อรอบใหม่
