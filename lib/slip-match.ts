// Pure helpers สำหรับจับคู่ "บัญชีปลายทางในสลิป" กับ PROMPTPAY_ID ของระบบ
// แยกออกมาไม่ให้ import env เพื่อให้ unit test ได้ง่าย (ไม่ต้องตั้ง env ครบ)

// ดึงเฉพาะตัวเลขออกมา ตัด mask (x), dash, space ทิ้ง
// เช่น "0xx-xxx-5678" → "05678" , "xxx-x-x1234-5" → "12345"
export function digitsOnly(account: string): string {
  return account.replace(/\D/g, "");
}

// เช็คว่าเลขบัญชี/พร็อกซีปลายทางจากสลิป "น่าจะ" เป็นของระบบเรา
// เทียบเลขท้าย n หลัก (default 4) เพราะสลิปมัก mask ตัวหน้า
// (สลิป PromptPay ไทยมักโชว์เลขท้ายของเบอร์/เลขบัตรปลายทาง)
// คืน false ถ้าฝั่งใดเห็นเลขน้อยกว่า n หลัก = ตรวจไม่ได้ = ไม่ปลอดภัย = ไม่ผ่าน
export function receiverMatchesPromptPay(
  receiverAccount: string,
  promptPayId: string,
  n = 4
): boolean {
  const recv = digitsOnly(receiverAccount);
  const ours = digitsOnly(promptPayId);
  if (recv.length < n || ours.length < n) return false;
  // F5: ถ้าทั้งสองฝั่ง "ยาวเท่ากัน" = น่าจะไม่ถูก mask (เลขเต็มรูปแบบเดียวกัน)
  //     → เทียบเต็มทั้งหมด (แข็งแรงสุด: จับเคสเลขท้าย 4 ตัวบังเอิญชนแต่บัญชีคนละเลข)
  if (recv.length === ours.length) return recv === ours;
  // ฝั่งใดถูก mask (ยาวไม่เท่ากัน) → เทียบเลขท้าย n หลักตามเดิม
  //   (ไม่เทียบยาวขึ้นเพราะ mask/country-code/เลข 0 นำหน้า อาจทำให้ false-negative)
  return recv.slice(-n) === ours.slice(-n);
}
