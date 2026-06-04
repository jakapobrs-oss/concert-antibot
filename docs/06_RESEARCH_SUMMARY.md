# 06 — สรุปวิจัยอ้างอิง

> ไฟล์อ้างอิง: `วิจัยระบบแอนติบอท finish.docx` (ในโฟลเดอร์ root)
> ผู้วิจัย: นางสาวพรชนก ยมรัตน์ รหัส 6507533
> สถาบัน: ภาควิชาวิทยาการคอมพิวเตอร์ วิทยาลัยนวัตกรรมดิจิทัลเทคโนโลยี ม.รังสิต
> ปีการศึกษา: 2567
> อาจารย์ที่ปรึกษา: ผศ.ดร.ธรรณพ อารีพรรค

---

## 1. โครงสร้างวิจัยเดิม

| บท | หัวข้อ | เนื้อหาหลัก |
|---|---|---|
| 1 | บทนำ | ปัญหาบอทจองบัตร, วัตถุประสงค์ 4 ข้อ, ขอบเขต 4 ข้อ |
| 2 | ทบทวนเอกสาร | Behavioral Analysis, CAPTCHA, AI/ML, VS Code, MySQL |
| 3 | ขั้นตอนดำเนินงาน | Gantt, 5 modules, 7 steps, Use Case, ER, 7 tables |
| 4 | สรุปและข้อเสนอแนะ | สรุป + ยอมรับว่ายังขาด demo + evaluation |

---

## 2. 5 โมดูลในวิจัย (ใช้ต่อใน implement)

1. **Request Handling Module** — รับคำขอ + ตรวจ User-Agent, Cookies, HTTP Headers
2. **Behavior Analysis Module** — ML supervised + unsupervised, วัด click speed, scroll
3. **CAPTCHA Verification Module** — รูปภาพ / ตัวอักษร / reCAPTCHA, ปรับยากตามความน่าสงสัย
4. **Authentication Module** — 2FA, OTP, biometric (face/finger/voice)
5. **Logging and Reporting Module** — บันทึก, รายงาน, แจ้งเตือนอีเมล admin

> **โปรเจ็คของเรา:** ขยายโมดูลทั้ง 5 + เพิ่ม Queue, Seat Hold, Payment, Trust Score

---

## 3. 7 ขั้นตอนการทำงาน (ใช้เป็น Sequence Diagram)

1. ผู้ใช้ login
2. วิเคราะห์ข้อมูลเบื้องต้น (UA, Cookies, Headers, Proxy/VPN)
3. ตรวจสอบพฤติกรรม (mouse, scroll, typing)
4. CAPTCHA
5. ยืนยันตัวตน (OTP / email)
6. อนุมัติคำขอ
7. บันทึกข้อมูล

> ตรงกับ Sequence Diagram ที่เขียนใน [05_DIAGRAMS.md #3](05_DIAGRAMS.md)

---

## 4. 7 ตารางใน research (เทียบกับ schema ของเรา)

| ตารางใน research | สถานะในโปรเจ็คเรา |
|---|---|
| User | ✅ ขยาย field (password_hash, oauth, trust_score, ฯลฯ) |
| Admin | ✅ เพิ่ม role |
| Ticket | ✅ ขยาย (order_id, qr_code, price snapshot) |
| Concert | ✅ ขยาย (sale_start/end, status, slug, ฯลฯ) |
| Bot Detection Log | ✅ ขยาย (score, action_taken, fingerprint) |
| CAPTCHA Test | ⚠️ แทนด้วย BehaviorEvent (รวมหลาย type) |
| Report | ✅ คงไว้ + เพิ่ม Audit Log |

**ตารางใหม่ที่เพิ่ม:** Zone, Seat, QueueToken, SeatHold, Order, Payment, UserOAuth, Session, BehaviorEvent, AuditLog

---

## 5. งานวิจัยที่เกี่ยวข้อง (ตามที่อ้างใน thesis)

1. **ธัญลักษณ์ รามโกมุท (2557)** — โดมิโนแคปท์ช่า — เกม-style CAPTCHA, ผลทดลอง 428 คน
2. **ธัญญรักษ์ บุญตามหนุน (2562)** — ปัจจัยยอมรับ AI/ML — sample 160 คน, Multiple Regression

---

## 6. เครื่องมือที่ research อ้างถึง

- **Visual Studio Code** — code editor (ใช้ต่อ ✅)
- **MySQL** — database (เราเลือก Postgres แต่ MySQL ใช้ได้, ดูใน [03](03_TOOLS_AND_VERSIONS.md))

---

## 7. จุดอ่อนที่ research ยอมรับ (จากบทสรุป 4.1)

> "ยังขาดคุณสมบัติในการนำไปใช้งานจริงเพราะยังไม่มีการแสดงตัวอย่างระบบให้เห็นถึงการทำงาน"

ข้อเสนอแนะ 4.2:
- ตัวอย่างหน้าจอแสดงระบบการทำงาน
- การทดสอบและประเมินประสิทธิภาพของระบบ

👉 **สอง point นี้คือสิ่งที่โปรเจ็คเราต้องทำเพิ่ม** เพื่อปิด gap ของ thesis เดิม

---

## 8. บรรณานุกรมที่อ้างถึง (เก็บไว้ใช้ใน thesis เรา)

- Glassbox — Behavioral Analytics https://www.glassbox.com/behavioral-analytics/
- Google Support — CAPTCHA https://support.google.com/a/answer/1217728
- Cloud Ace — AI & Machine Learning https://cloud-ace.co.th/blogs/o0v9a6-ai-machine-learning-ml-ai-ml-goog
- OpenLandscape — MySQL https://blog.openlandscape.cloud/mysql
- ธัญลักษณ์ รามโกมุท (2557) — โดมิโนแคปท์ช่า — ม.ธรรมศาสตร์
- ธัญญรักษ์ บุญตามหนุน (2562) — AI/ML acceptance — ม.ธรรมศาสตร์

---

## 9. References ที่ควรเพิ่มสำหรับโปรเจ็คใหม่

- Cloudflare Turnstile Documentation
- FingerprintJS Open Source paper
- OWASP Automated Threats Handbook (OAT-021 Denial of Inventory)
- "Fairness in Online Ticketing" — เปเปอร์/article ไทย/อังกฤษ ที่หาเพิ่ม
- "Queue Theory in Web Systems" — Little's Law
- Redis Documentation — distributed locks (Redlock)
- Next.js 15 docs
- Auth.js (NextAuth v5) docs
