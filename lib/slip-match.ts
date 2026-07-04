// Pure helpers สำหรับจับคู่ "บัญชีปลายทางในสลิป" กับ PROMPTPAY_ID ของระบบ
// แยกออกมาไม่ให้ import env เพื่อให้ unit test ได้ง่าย (ไม่ต้องตั้ง env ครบ)

// ดึงเฉพาะตัวเลขออกมา ตัด mask (x), dash, space ทิ้ง
// เช่น "0xx-xxx-5678" → "05678" , "xxx-x-x1234-5" → "12345"
export function digitsOnly(account: string): string {
  return account.replace(/\D/g, "");
}

// เบอร์รูปแบบ country code (+66 / 0066) → รูปแบบ 0 นำหน้า ให้ยาวเท่ากับ PROMPTPAY_ID ที่ตั้งไว้
function normalizeThaiPhone(digits: string): string {
  if (/^66\d{9}$/.test(digits)) return "0" + digits.slice(2);
  if (/^0066\d{9}$/.test(digits)) return "0" + digits.slice(4);
  return digits;
}

// แปลง string บัญชีจากสลิปเป็นลิสต์อักขระ: ตัวเลขคงไว้, อักขระ mask ทุกแบบ → "x", อย่างอื่นทิ้ง
function accountChars(account: string): string[] {
  return [...account.toLowerCase()]
    .filter((c) => /[0-9x*•●]/.test(c))
    .map((c) => (/[0-9]/.test(c) ? c : "x"));
}

// เช็คว่าเลขบัญชี/พร็อกซีปลายทางจากสลิปเป็นของระบบเราจริงไหม
//
// Codex #1 (เดิม HIGH): ของเดิมเทียบแค่ "เลขท้าย n หลัก" → บัญชีของคนโจมตีเอง
//   ที่เลขท้ายพ้องกับของร้าน ก็ผ่านได้ (หาเบอร์เลขท้ายเจาะจงได้ไม่ยาก)
// ของใหม่: เทียบจากขวา (เลขท้ายชิดกัน) แล้วบังคับว่า "ตัวเลขที่มองเห็นทุกหลัก"
//   ต้องตรงกับเลขของเราตามตำแหน่ง — ไม่ใช่แค่ 4 หลักท้าย:
//   - เลขเต็มไม่ถูก mask → กลายเป็นเทียบเต็มทุกหลักอัตโนมัติ (แข็งแรงสุด)
//   - ถูก mask บางส่วน → ทุกหลักที่โผล่ต้อง consistent กับบัญชีเรา (เช่นหลักแรก, หลักกลาง)
//   - เลขบนสลิปยื่นยาวเกินบัญชีเรา (หลังแปลง country code) → คนละบัญชี = ปฏิเสธ
//   - เห็นน้อยกว่า n หลัก = ตรวจไม่ได้ = ไม่ปลอดภัย = ไม่ผ่าน (fail-closed ตามเดิม)
// หมายเหตุ: mask แบบโชว์แค่เลขท้าย 4 ("xxx-xxx-5678") ยังเหลือช่องเลขท้ายพ้องกัน —
//   จึงต้องเช็ค "ชื่อบัญชีผู้รับ" ประกอบด้วย (receiverNameMatches ด้านล่าง + PAYMENTS_RECEIVER_NAME)
export function receiverMatchesPromptPay(
  receiverAccount: string,
  promptPayId: string,
  n = 4
): boolean {
  const ours = normalizeThaiPhone(digitsOnly(promptPayId));
  if (ours.length < n) return false;

  let recv = accountChars(receiverAccount);
  // แปลง country code ได้เฉพาะตอนเห็นเลขเต็ม (ไม่มี mask) — masked ปล่อยตามเดิม
  if (!recv.includes("x")) recv = [...normalizeThaiPhone(recv.join(""))];

  // เทียบจากขวา: ทุกตัวเลขที่มองเห็นต้องตรงตำแหน่งกับเลขของเรา
  let visible = 0;
  for (let i = 1; i <= recv.length; i++) {
    const rc = recv[recv.length - i];
    if (rc === "x") continue;
    const oc = ours[ours.length - i];
    if (oc === undefined) return false; // เลขจากสลิปยาวเกินบัญชีเรา = คนละบัญชี
    if (rc !== oc) return false;
    visible++;
  }
  return visible >= n;
}

// ============================================================
// ชื่อบัญชีผู้รับ (Codex #1 ชั้นเสริม) — บัญชีของ attacker เป็นชื่อตัวเอง ปลอมชื่อร้านไม่ได้
// ============================================================

// คำนำหน้าชื่อที่ธนาคารชอบใส่มาในสลิป — เรียงยาว→สั้น กัน "นาง" ไปตัด "นางสาว" ครึ่งเดียว
const TITLE_PREFIXES = [
  "นางสาว",
  "น.ส.",
  "ด.ช.",
  "ด.ญ.",
  "นาย",
  "นาง",
  "ดร.",
  "miss",
  "mrs.",
  "mrs",
  "mr.",
  "ms.",
  "dr.",
  "mr",
  "ms",
  "dr",
];

// ตัดคำนำหน้า + ช่องว่าง + จุด/ขีด แล้ว lowercase — ให้ "นาย จักรภพ ย." เทียบกับ "จักรภพ ยมรัตน์" ได้
export function normalizeAccountName(name: string): string {
  let s = name.trim().toLowerCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of TITLE_PREFIXES) {
      if (s.startsWith(t)) {
        s = s.slice(t.length).trimStart();
        changed = true;
      }
    }
  }
  return s.replace(/[\s.\-]/g, "");
}

// เช็คชื่อผู้รับจากสลิปกับ "ชื่อที่คาดหวัง" (จาก env — ใส่ได้หลายชื่อ ไทย/อังกฤษ)
// ธนาคารมัก "ตัดท้ายชื่อ" (เช่น "นาย จักรภพ ย.") → ใช้ prefix match สองทาง
// ชื่อสั้นกว่า 3 อักขระหลัง normalize = ข้อมูลไม่พอ = ไม่ผ่าน (fail-closed)
export function receiverNameMatches(
  slipName: string | null | undefined,
  expectedNames: string[]
): boolean {
  if (!slipName) return false;
  const slip = normalizeAccountName(slipName);
  if (slip.length < 3) return false;
  return expectedNames.some((expected) => {
    const e = normalizeAccountName(expected);
    if (e.length < 3) return false;
    return e.startsWith(slip) || slip.startsWith(e);
  });
}
