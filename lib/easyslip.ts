// EasySlip API — verify สลิปโอนเงิน (กันสลิปปลอม + กันโอนผิดบัญชี)
// ฟรี 500 calls/เดือน, TH-native
//
// นโยบายความปลอดภัย (สำคัญ — งานนี้เกี่ยวกับเงินจริง):
//   1. ต้อง "แนบสลิป" เสมอ — ไม่มีสลิป = ไม่ผ่าน (ทุกโหมด)
//   2. มี EASYSLIP_API_KEY → ตรวจจริง: เช็คทั้ง "ยอด" และ "บัญชีปลายทาง" ตรงกับ PROMPTPAY_ID ของระบบ
//   3. ไม่มี key:
//        - production → ปฏิเสธทันที (fail-closed) ไม่แจกตั๋วฟรีเด็ดขาด
//        - development → mock ผ่าน (ยังบังคับต้องแนบสลิป) + เตือนดังๆ ว่าไม่ใช่การตรวจจริง
import { env, isEasySlipConfigured, isProduction } from "@/lib/env";
import { receiverMatchesPromptPay } from "@/lib/slip-match";
import { parseSlipDate } from "@/lib/slip-date";

export interface SlipVerifyResult {
  success: boolean;
  amount?: number; // ยอดที่โอนจริง (จากสลิป)
  senderName?: string;
  receiverAccount?: string; // เลขบัญชี/พร็อกซีปลายทางที่อ่านได้จากสลิป (อาจถูก mask)
  transAt?: Date; // เวลาที่โอนตามสลิป — ใช้เช็ค freshness (Level 2)
  ref?: string; // transaction ref — ใช้กันสลิปซ้ำ
  devMode: boolean;
  error?: string;
}

const EASYSLIP_URL = "https://developer.easyslip.com/api/v1/verify";

// verify สลิปจากรูป (base64) หรือ payload string
// expectedAmount: ยอดที่ order ต้องการ (ใช้ mock ใน dev + อ้างอิงใน error)
export async function verifySlip(params: {
  slipImageBase64?: string;
  payload?: string; // ข้อมูลจาก QR ในสลิป (ถ้า client อ่านได้)
  expectedAmount: number;
}): Promise<SlipVerifyResult> {
  // 🔒 ชั้นที่ 1: ต้องมีสลิปเสมอ (รูป หรือ payload) — ปิดช่องโหว่ "กดจ่ายโดยไม่แนบสลิป"
  if (!params.slipImageBase64 && !params.payload) {
    return { success: false, devMode: false, error: "กรุณาแนบสลิปการโอนเงินก่อนยืนยัน" };
  }

  // ---- มี key → ตรวจจริงเสมอ (ทั้ง dev และ production) ----
  if (isEasySlipConfigured) {
    return verifyWithEasySlip(params);
  }

  // ---- ไม่มี key + production → ปฏิเสธ (fail-closed) ----
  if (isProduction) {
    console.error("🚨 [PAYMENT] ไม่มี EASYSLIP_API_KEY บน production — ปฏิเสธการชำระเงิน");
    return {
      success: false,
      devMode: false,
      error: "ระบบยืนยันการชำระเงินยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล",
    };
  }

  // ---- ไม่มี key + development → mock (ยังบังคับต้องแนบสลิปตามชั้นที่ 1) ----
  console.warn(
    "⚠️  [PAYMENT][DEV] ยอมรับสลิปโดยไม่ได้ตรวจจริง (mock) — ตั้ง EASYSLIP_API_KEY เพื่อตรวจจริง"
  );
  const ref = `DEV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    success: true,
    amount: params.expectedAmount, // mock: ถือว่าโอนตรงยอด
    senderName: "ผู้ทดสอบ (dev mode)",
    receiverAccount: env.PROMPTPAY_ID || undefined,
    transAt: new Date(), // mock: ถือว่าเพิ่งโอน (ผ่าน freshness)
    ref,
    devMode: true,
  };
}

// เรียก EasySlip จริง + ตรวจบัญชีปลายทาง
async function verifyWithEasySlip(params: {
  slipImageBase64?: string;
  payload?: string;
}): Promise<SlipVerifyResult> {
  try {
    const body: Record<string, string> = {};
    if (params.payload) body.payload = params.payload;
    else if (params.slipImageBase64) body.image = params.slipImageBase64;

    const res = await fetch(EASYSLIP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.EASYSLIP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    // EasySlip คืน { status, data: { amount: { amount }, sender, receiver, transRef } }
    if (data.status !== 200 || !data.data) {
      return { success: false, devMode: false, error: "ตรวจสอบสลิปไม่สำเร็จ — สลิปอาจไม่ถูกต้อง" };
    }

    const d = data.data;
    const slipAmount = d.amount?.amount ?? d.amount;
    const ref = d.transRef ?? d.ref;
    const senderName = d.sender?.account?.name?.th ?? d.sender?.account?.name?.en ?? d.sender?.name;
    // เวลาธุรกรรมจากสลิป (EasySlip คืน ISO string ใน data.date)
    // F6: parse ผ่าน helper — ถ้า string ไม่มี timezone ถือเป็นเวลาไทย (กันเพี้ยน 7 ชม.)
    const transAt = parseSlipDate(d.date);

    // เลขบัญชี/พร็อกซีปลายทาง — ลองหลายตำแหน่งตาม shape ของ EasySlip
    const receiverAccount: string =
      d.receiver?.account?.proxy?.account ??
      d.receiver?.account?.bank?.account ??
      d.receiver?.account?.name?.th ??
      "";

    // 🔒 ชั้นที่ 2: เช็คว่าเงินเข้าบัญชีของเราจริง (กันแนบสลิปที่โอนหาคนอื่น)
    if (env.PAYMENTS_RECEIVER_CHECK) {
      if (!env.PROMPTPAY_ID) {
        // เปิดเช็คแต่ไม่ได้ตั้งบัญชีรับเงิน = misconfig → ปฏิเสธ (fail-closed)
        return {
          success: false,
          devMode: false,
          error: "ระบบยังไม่ได้ตั้งค่าบัญชีรับเงิน (PROMPTPAY_ID)",
        };
      }
      if (!receiverMatchesPromptPay(receiverAccount, env.PROMPTPAY_ID)) {
        return {
          success: false,
          devMode: false,
          error: "สลิปนี้ไม่ได้โอนเข้าบัญชีของระบบ — ตรวจสอบบัญชีปลายทางอีกครั้ง",
        };
      }
    }

    // 🔒 ต้องมี transaction ref เสมอ — ระบบกันสลิปซ้ำ (T4) พึ่ง slipRef ที่เป็น UNIQUE
    //    ถ้า EasySlip ไม่คืน ref จะถูกเก็บเป็น NULL ซึ่ง Postgres ยอมให้ NULL ซ้ำได้
    //    → กันซ้ำหลุด (เอาสลิปเดียวจ่ายได้หลาย order) ดังนั้นไม่มี ref = ปฏิเสธ (fail-closed)
    if (!ref) {
      return {
        success: false,
        devMode: false,
        error: "สลิปนี้ไม่มีเลขอ้างอิงธุรกรรม (transRef) — ยืนยันไม่ได้ กรุณาใช้สลิปที่ถูกต้อง",
      };
    }

    return {
      success: true,
      amount: Number(slipAmount),
      senderName,
      receiverAccount,
      transAt,
      ref,
      devMode: false,
    };
  } catch {
    return { success: false, devMode: false, error: "เชื่อมต่อ EasySlip ไม่ได้ กรุณาลองใหม่" };
  }
}

export { isEasySlipConfigured };
