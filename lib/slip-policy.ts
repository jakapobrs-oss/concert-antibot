// ด่านนโยบายกลางของการตรวจสลิป — ใช้ร่วมกันทุกผู้ให้บริการ (EasySlip / SlipOK / เจ้าถัดไป)
//
// แยกออกมาจาก lib/easyslip.ts (2026-08-27, rev 40) ตอนเพิ่มสวิตช์ SLIP_PROVIDER:
//   ผู้ให้บริการแต่ละเจ้าตอบ JSON คนละหน้าตา แต่ "กติกาเงิน" ต้องเหมือนกันเป๊ะ —
//   adapter ของแต่ละเจ้ามีหน้าที่แค่ "แกะคำตอบ" เป็น ParsedSlip แล้วส่งเข้าด่านนี้
//
// นโยบายความปลอดภัย (สำคัญ — งานนี้เกี่ยวกับเงินจริง):
//   1. ต้อง "แนบสลิป" เสมอ — ไม่มีสลิป = ไม่ผ่าน (ทุกโหมด)
//   2. ตั้งค่าผู้ให้บริการครบ → ตรวจจริง: ยอด (booking.ts) + บัญชีปลายทาง (ด่านนี้) + transRef (ด่านนี้)
//   3. ตั้งค่าไม่ครบ:
//        - production → ปฏิเสธทันที (fail-closed) ไม่แจกตั๋วฟรีเด็ดขาด
//        - development → mock ผ่าน (ยังบังคับต้องแนบสลิป) + เตือนดังๆ ว่าไม่ใช่การตรวจจริง
import { env, isProduction } from "@/lib/env";
import { receiverMatchesPromptPay, receiverNameMatches } from "@/lib/slip-match";

export interface SlipVerifyResult {
  success: boolean;
  amount?: number; // ยอดที่โอนจริง (จากสลิป)
  senderName?: string;
  senderAccount?: string; // เลขบัญชี/พร็อกซีผู้จ่าย (อาจถูก mask) — ใช้ทำ per-payer cap กัน account farming
  senderBank?: string; // รหัส/ชื่อย่อธนาคารต้นทาง (เช่น "004") — เสริมคีย์ผู้จ่ายเมื่อสลิปไม่มีเลขบัญชี (SECURITY_TODO #3)
  receiverAccount?: string; // เลขบัญชี/พร็อกซีปลายทางที่อ่านได้จากสลิป (อาจถูก mask)
  transAt?: Date; // เวลาที่โอนตามสลิป — ใช้เช็ค freshness (Level 2)
  ref?: string; // transaction ref — ใช้กันสลิปซ้ำ
  devMode: boolean;
  error?: string;
  errorCode?: string; // รหัส error ดิบจากผู้ให้บริการ — ไว้ให้ log/เทส ไม่ใช่ข้อความให้ผู้ใช้
}

export interface SlipVerifyParams {
  slipImageBase64?: string;
  payload?: string; // ข้อมูลจาก QR ในสลิป (ถ้า client อ่านได้)
  expectedAmount: number; // ยอดที่ order ต้องการ (ใช้ mock ใน dev + ส่งให้ผู้ให้บริการเทียบซ้ำได้)
}

// สิ่งที่ adapter แกะได้จากคำตอบของผู้ให้บริการ (ก่อนเข้าด่านนโยบาย)
export interface ParsedSlip {
  amount: number | undefined;
  ref: string | undefined;
  senderName?: string;
  senderAccount: string;
  senderBank?: string;
  receiverAccount: string;
  receiverNames: string[]; // ชื่อผู้รับทุกรูปแบบที่สลิปให้มา (ไทย/อังกฤษ/displayName)
  transAt?: Date;
}

// ตัวแทนผู้ให้บริการ 1 เจ้า
export interface SlipProviderAdapter {
  name: "easyslip" | "slipok";
  label: string; // ชื่อไว้โชว์/ log
  configured: boolean;
  missingEnv: string[]; // env ที่ยังไม่ได้ตั้ง (ไว้บอกใน log ตอน fail-closed)
  verify(params: SlipVerifyParams): Promise<SlipVerifyResult>;
}

// 🔒 ชั้นที่ 2: เช็คว่าเงินเข้าบัญชีของเราจริง (กันแนบสลิปที่โอนหาคนอื่น) + ต้องมี transRef
export function applySlipPolicy(slip: ParsedSlip): SlipVerifyResult {
  if (env.PAYMENTS_RECEIVER_CHECK) {
    if (!env.PROMPTPAY_ID) {
      // เปิดเช็คแต่ไม่ได้ตั้งบัญชีรับเงิน = misconfig → ปฏิเสธ (fail-closed)
      return {
        success: false,
        devMode: false,
        error: "ระบบยังไม่ได้ตั้งค่าบัญชีรับเงิน (PROMPTPAY_ID)",
      };
    }
    if (!receiverMatchesPromptPay(slip.receiverAccount, env.PROMPTPAY_ID)) {
      return {
        success: false,
        devMode: false,
        error: "สลิปนี้ไม่ได้โอนเข้าบัญชีของระบบ — ตรวจสอบบัญชีปลายทางอีกครั้ง",
      };
    }
    // 🔒 ชั้นที่ 2.5 (Codex #1): เลขบัญชีบนสลิปถูก mask จนบางเจ้าเทียบได้แค่เลขท้าย
    //    → บัญชีของ attacker เองที่ "เลขท้ายพ้องกับร้าน" อาจรอดชั้นบน
    //    ถ้าตั้ง PAYMENTS_RECEIVER_NAME ต้องเช็คชื่อบัญชีผู้รับให้ตรงด้วย (ชื่อปลอมไม่ได้)
    //    สลิปไม่มีชื่อผู้รับเลย = ตรวจไม่ได้ = ปฏิเสธ (fail-closed เหมือนนโยบายข้ออื่น)
    if (env.PAYMENTS_RECEIVER_NAME) {
      const expectedNames = env.PAYMENTS_RECEIVER_NAME.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const candidates = slip.receiverNames.filter((v) => typeof v === "string" && v.length > 0);
      const nameOk = candidates.some((nm) => receiverNameMatches(nm, expectedNames));
      if (!nameOk) {
        return {
          success: false,
          devMode: false,
          error: "ชื่อบัญชีผู้รับในสลิปไม่ตรงกับบัญชีของระบบ — ตรวจสอบบัญชีปลายทางอีกครั้ง",
        };
      }
    }
  }

  // 🔒 ต้องมี transaction ref เสมอ — ระบบกันสลิปซ้ำ (T4) พึ่ง slipRef ที่เป็น UNIQUE
  //    ถ้าผู้ให้บริการไม่คืน ref จะถูกเก็บเป็น NULL ซึ่ง Postgres ยอมให้ NULL ซ้ำได้
  //    → กันซ้ำหลุด (เอาสลิปเดียวจ่ายได้หลาย order) ดังนั้นไม่มี ref = ปฏิเสธ (fail-closed)
  if (!slip.ref) {
    return {
      success: false,
      devMode: false,
      error: "สลิปนี้ไม่มีเลขอ้างอิงธุรกรรม (transRef) — ยืนยันไม่ได้ กรุณาใช้สลิปที่ถูกต้อง",
    };
  }

  return {
    success: true,
    amount: slip.amount === undefined ? undefined : Number(slip.amount),
    senderName: slip.senderName,
    senderAccount: slip.senderAccount,
    senderBank: slip.senderBank ? String(slip.senderBank) : undefined,
    receiverAccount: slip.receiverAccount,
    transAt: slip.transAt,
    ref: slip.ref,
    devMode: false,
  };
}

// ชั้นนอกสุดที่ทุก adapter ใช้ร่วมกัน: ต้องมีสลิป → ตั้งค่าครบไหม → ตรวจจริง / fail-closed / mock
export async function runSlipVerification(
  adapter: SlipProviderAdapter,
  params: SlipVerifyParams
): Promise<SlipVerifyResult> {
  // 🔒 ชั้นที่ 1: ต้องมีสลิปเสมอ (รูป หรือ payload) — ปิดช่องโหว่ "กดจ่ายโดยไม่แนบสลิป"
  if (!params.slipImageBase64 && !params.payload) {
    return { success: false, devMode: false, error: "กรุณาแนบสลิปการโอนเงินก่อนยืนยัน" };
  }

  // ---- ตั้งค่าครบ → ตรวจจริงเสมอ (ทั้ง dev และ production) ----
  if (adapter.configured) {
    return adapter.verify(params);
  }

  // ---- ตั้งค่าไม่ครบ + production → ปฏิเสธ (fail-closed) ----
  if (isProduction) {
    console.error(
      `🚨 [PAYMENT] ไม่มี ${adapter.missingEnv.join(" + ") || "คีย์ผู้ให้บริการตรวจสลิป"} บน production (SLIP_PROVIDER=${adapter.name}) — ปฏิเสธการชำระเงิน`
    );
    return {
      success: false,
      devMode: false,
      error: "ระบบยืนยันการชำระเงินยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล",
    };
  }

  // ---- ตั้งค่าไม่ครบ + development → mock (ยังบังคับต้องแนบสลิปตามชั้นที่ 1) ----
  console.warn(
    `⚠️  [PAYMENT][DEV] ยอมรับสลิปโดยไม่ได้ตรวจจริง (mock) — ตั้ง ${adapter.missingEnv.join(" + ") || "คีย์ผู้ให้บริการ"} เพื่อตรวจจริงผ่าน ${adapter.label}`
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

// แกะ base64 ของรูปสลิปจาก client (FileReader.readAsDataURL ให้ "data:image/jpeg;base64,....")
//   → bytes + mime สำหรับส่งเป็นไฟล์ (multipart) — ผู้ให้บริการอ่านรูปไบนารีตรง ๆ ไม่ต้องเดาว่ารับ prefix ไหม
export function decodeSlipImage(input: string): { bytes: Uint8Array; mime: string; ext: string } {
  const trimmed = input.trim();
  const m = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(trimmed);
  const mime = m ? m[1].toLowerCase() : "image/jpeg";
  const body = (m ? trimmed.slice(m[0].length) : trimmed).replace(/\s/g, "");
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
  return { bytes: new Uint8Array(Buffer.from(body, "base64")), mime, ext };
}
