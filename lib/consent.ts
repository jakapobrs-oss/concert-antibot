// ความยินยอมตอนสมัครสมาชิก — pure module (ใช้ได้ทั้ง client form และ server action, unit test ได้โดยไม่ต้องมี env)
//
// เหตุ (gap map 2026-08-27): ระบบเก็บลายนิ้วมือเบราว์เซอร์ + พฤติกรรมเมาส์/คีย์ + รูปสลิป (เลขบัญชี/ชื่อผู้โอน)
//   แต่ไม่เคยแจ้งและไม่เคยขอความยินยอม → ขัด พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล 2562 (PDPA)
// กติกา: ฟอร์มสมัครต้องติ๊ก "ยอมรับข้อกำหนด + นโยบายความเป็นส่วนตัว" และ server ตรวจซ้ำ (ห้ามเชื่อ `required` ฝั่งเบราว์เซอร์)
//   ส่วนปุ่ม Google = แจ้งใต้ปุ่มว่าการกดถือเป็นการยอมรับ (OAuth ไม่มีฟอร์มให้ติ๊ก)

// ชื่อช่องในฟอร์ม (checkbox) — ใช้ร่วมกันระหว่าง register-form.tsx กับ app/actions/auth.ts
export const CONSENT_FIELD = "acceptTerms";

export const CONSENT_REQUIRED_MESSAGE =
  "กรุณายอมรับข้อกำหนดการใช้งานและนโยบายความเป็นส่วนตัวก่อนสมัครสมาชิก";

// ค่าที่ถือว่า "ติ๊กแล้ว" — checkbox HTML ส่ง "on"; เผื่อ client อื่นส่ง true/1/yes
const ACCEPTED_VALUES = new Set(["on", "true", "1", "yes"]);

export function hasAcceptedTerms(value: FormDataEntryValue | null | undefined): boolean {
  if (typeof value !== "string") return false; // ไม่ส่งมา / ส่งไฟล์มา = ไม่ยอมรับ
  return ACCEPTED_VALUES.has(value.trim().toLowerCase());
}
