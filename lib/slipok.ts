// SlipOK — ผู้ให้บริการตรวจสลิปเจ้าที่ 2 (เปิดด้วย SLIP_PROVIDER=slipok) — แพ็กเกจ OK BASIC ฟรี 100 สลิป/เดือน ต่ออายุเอง
//   เหตุที่เพิ่ม (2026-08-27 rev 40): แอปทดลอง EasySlip หมดอายุแล้วต้องเสียเงิน — user เลือก SlipOK ที่มีชั้นฟรีถาวร
//
// สัญญา API (เอกสาร v1.8 https://slipok.com/api-documentation/ — ยืนยัน shape จาก SDK ชุมชน PrakritManStudio/slipok-sdk):
//   POST https://api.slipok.com/api/line/apikey/{branchId}   header  x-authorization: <API key>
//        multipart/form-data: files (รูปสลิป) | data (payload จาก QR) | url (ลิงก์รูป)
//        + amount (เทียบยอดฝั่ง SlipOK → ไม่ตรง = 1013) + log ("true" = SlipOK บันทึก+กันสลิปซ้ำเอง → 1012)
//   GET  https://api.slipok.com/api/line/apikey/{branchId}/quota → { quota, specialQuota, overQuota }
//   สำเร็จ { success:true, data:{ transRef, sendingBank, receivingBank, transDate "YYYYMMDD", transTime "HH:mm:ss",
//          transTimestamp, sender|receiver:{ displayName, name, proxy:{type,value}, account:{type,value} }, amount, … } }
//   ไม่ผ่าน { success:false, code:"1000".."1014", message, data? (1012/1013/1014 แนบข้อมูลสลิปมาด้วย) }
import { env, isSlipOkConfigured } from "@/lib/env";
import { parseSlipDate } from "@/lib/slip-date";
import {
  applySlipPolicy,
  decodeSlipImage,
  runSlipVerification,
  type SlipProviderAdapter,
  type SlipVerifyParams,
  type SlipVerifyResult,
} from "@/lib/slip-policy";

export const SLIPOK_BASE_URL = "https://api.slipok.com/api/line/apikey";
const SLIPOK_TIMEOUT_MS = 20_000;

// ============================================================
// รหัส error ของ SlipOK — แยกตาม "ใครแก้ได้" เหมือน lib/easyslip.ts
// ============================================================
// ฝั่งเรา/บัญชี SlipOK ของร้าน (ผู้ใช้ทำอะไรไม่ได้ ต้องแอดมิน)
export const SLIPOK_SYSTEM_ERRORS: Record<string, string> = {
  "1001": "ไม่พบสาขา — SLIPOK_BRANCH_ID ไม่ถูกต้อง (ดูไอดีสาขาในเมนู API ของ LINE SlipOK)",
  "1002": "API key ไม่ถูกต้อง — ตรวจ SLIPOK_API_KEY",
  "1003": "แพ็กเกจ SlipOK หมดอายุ — ต่ออายุแพ็กเกจใน LINE SlipOK",
  "1004": "ใช้เกินโควต้าจนค้างชำระถึงเพดาน — ต่อ/อัปเกรดแพ็กเกจ SlipOK",
};
// ชั่วคราวฝั่งธนาคาร/SlipOK — ผู้ใช้แค่รอแล้วส่งใหม่ (ไม่ใช่ความผิดของสลิป และไม่ต้องเรียกแอดมิน)
export const SLIPOK_TRANSIENT_ERRORS: Record<string, string> = {
  "1009": "ระบบข้อมูลธนาคารขัดข้องชั่วคราว — กรุณาลองส่งสลิปเดิมใหม่ในอีก 15 นาที (ไม่เสียโควต้า)",
  "1010": "ธนาคารต้นทางยังไม่ยืนยันรายการโอนนี้ — กรุณารอสักครู่แล้วส่งสลิปเดิมใหม่",
};
const SLIP_UNREADABLE =
  "อ่านสลิปจากรูปไม่ได้ — กรุณาอัปโหลดรูปสลิปเต็มใบที่บันทึกจากแอปธนาคาร (ต้องเห็น QR บนสลิปชัด ไม่ครอป/ไม่ถ่ายหน้าจอ)";
// ตัวสลิป/รูปที่ผู้ใช้ส่งมา (ผู้ใช้แก้เองได้)
export const SLIPOK_SLIP_ERRORS: Record<string, string> = {
  "1000": SLIP_UNREADABLE,
  "1005": "ไฟล์ไม่ใช่รูปภาพ — รองรับเฉพาะ .jpg .jpeg .png .jfif .webp",
  "1006": SLIP_UNREADABLE,
  "1007": "ไม่พบ QR บนรูปสลิป — กรุณาใช้รูปสลิปเต็มใบจากแอปธนาคาร (QR อยู่มุมล่างของสลิป)",
  "1008": "QR ในรูปไม่ใช่ QR ของสลิปโอนเงิน — กรุณาอัปโหลดสลิปโอนเงินจริงจากแอปธนาคาร",
  "1011": "ไม่พบรายการโอนนี้ในระบบธนาคาร หรือ QR หมดอายุแล้ว — ตรวจสอบว่าโอนสำเร็จจริงแล้วลองใหม่",
  "1012": "สลิปนี้ถูกใช้ยืนยันการชำระเงินไปแล้ว — ใช้สลิปซ้ำไม่ได้",
  "1013": "ยอดโอนในสลิปไม่ตรงกับยอดที่ต้องชำระ",
  "1014": "สลิปนี้ไม่ได้โอนเข้าบัญชีของระบบ — ตรวจสอบบัญชีปลายทางอีกครั้ง",
};

export type SlipOkErrorKind = "system" | "transient" | "slip" | "unknown";

// แปลรหัส error → ข้อความ 2 ชุด (ให้ผู้ใช้ / ให้แอดมิน+log) — body ใช้ดึงรายละเอียดเสริม (ยอดในสลิป, เวลารอ)
export function describeSlipOkError(
  code: string | undefined,
  body: { message?: unknown; data?: Record<string, unknown> } = {},
  expectedAmount?: number
): { kind: SlipOkErrorKind; userMessage: string; adminMessage: string } {
  const data = body.data ?? {};
  if (code && SLIPOK_SYSTEM_ERRORS[code]) {
    return {
      kind: "system",
      userMessage: `ระบบตรวจสอบสลิปขัดข้องชั่วคราว ไม่ใช่ความผิดของสลิปคุณ — กรุณาติดต่อผู้ดูแล (รหัส: SlipOK ${code})`,
      adminMessage: SLIPOK_SYSTEM_ERRORS[code],
    };
  }
  if (code === "1010") {
    // ธนาคารบางแห่ง (BBL/SCB) ต้องรอหลายนาทีก่อนตรวจได้ — SlipOK บอกชื่อธนาคาร + นาทีที่ต้องรอมาด้วย
    const bank = typeof data.bankName === "string" ? data.bankName : "";
    const delay = typeof data.delay === "number" ? data.delay : undefined;
    const wait = delay ? `ประมาณ ${delay} นาที` : "สักครู่";
    return {
      kind: "transient",
      userMessage: `${bank ? `ธนาคาร${bank}` : "ธนาคารต้นทาง"}ยังไม่ยืนยันรายการโอนนี้ — กรุณารอ${wait} แล้วส่งสลิปเดิมใหม่`,
      adminMessage: `SlipOK 1010 รอธนาคาร ${bank} ${delay ?? "?"} นาที`,
    };
  }
  if (code && SLIPOK_TRANSIENT_ERRORS[code]) {
    return { kind: "transient", userMessage: SLIPOK_TRANSIENT_ERRORS[code], adminMessage: `SlipOK ${code} ชั่วคราว` };
  }
  if (code === "1013") {
    const slipAmount = typeof data.amount === "number" ? data.amount : undefined;
    return {
      kind: "slip",
      userMessage:
        slipAmount !== undefined && expectedAmount !== undefined
          ? `ยอดไม่ตรง: โอนมา ${slipAmount} บาท แต่ต้องชำระ ${expectedAmount} บาท`
          : SLIPOK_SLIP_ERRORS["1013"],
      adminMessage: `SlipOK 1013 ยอดไม่ตรง (สลิป ${slipAmount ?? "?"} / ต้องการ ${expectedAmount ?? "?"})`,
    };
  }
  if (code && SLIPOK_SLIP_ERRORS[code]) {
    return { kind: "slip", userMessage: SLIPOK_SLIP_ERRORS[code], adminMessage: `สลิปมีปัญหา (SlipOK ${code})` };
  }
  const raw = typeof body.message === "string" ? body.message : "";
  return {
    kind: "unknown",
    userMessage: `ตรวจสอบสลิปไม่สำเร็จ — สลิปอาจไม่ถูกต้อง หากมั่นใจว่าโอนแล้ว กรุณาติดต่อผู้ดูแล${
      code ? ` (รหัส: SlipOK ${code})` : ""
    }`,
    adminMessage: `SlipOK ตอบรหัสที่ไม่รู้จัก (${code ?? "ไม่มี code"}) ${raw}`.trim(),
  };
}

// SlipOK ให้วันที่เป็น "YYYYMMDD" + เวลา "HH:mm:ss" (เวลาไทย) — ประกอบเป็น ISO ไม่มี TZ ให้ parseSlipDate เติม +07:00
export function parseSlipOkDateTime(transDate?: unknown, transTime?: unknown): Date | undefined {
  if (typeof transDate !== "string" || !/^\d{8}$/.test(transDate)) return undefined;
  const time = typeof transTime === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(transTime) ? transTime : "00:00:00";
  const iso = `${transDate.slice(0, 4)}-${transDate.slice(4, 6)}-${transDate.slice(6, 8)}T${time.length === 5 ? `${time}:00` : time}`;
  return parseSlipDate(iso);
}

function pick(...values: unknown[]): string {
  for (const v of values) if (typeof v === "string" && v.length > 0) return v;
  return "";
}

// เรียก SlipOK จริง → แกะคำตอบ → ด่านนโยบายกลาง
async function verifyWithSlipOk(params: SlipVerifyParams): Promise<SlipVerifyResult> {
  try {
    const form = new FormData();
    if (params.payload) {
      form.append("data", params.payload);
    } else {
      const { bytes, mime, ext } = decodeSlipImage(params.slipImageBase64 ?? "");
      form.append("files", new Blob([bytes], { type: mime }), `slip.${ext}`);
    }
    // ให้ SlipOK เทียบยอดซ้ำอีกชั้น (ไม่ตรง = 1013 พร้อมยอดในสลิป) — booking.ts ยังเทียบเป็นสตางค์เองอยู่ดี
    form.append("amount", String(params.expectedAmount));
    // log=false โดยปริยาย: ระบบเรากันสลิปซ้ำด้วย slipRef UNIQUE อยู่แล้ว และถ้าให้ SlipOK กันซ้ำเอง
    //   การส่งสลิปเดิมซ้ำหลังระบบเราล้มกลางทาง (จ่ายแล้วแต่ยังไม่ได้ตั๋ว) จะโดนปฏิเสธ = ลูกค้าเสียเงินฟรี
    form.append("log", env.SLIPOK_LOG ? "true" : "false");

    const res = await fetch(`${SLIPOK_BASE_URL}/${env.SLIPOK_BRANCH_ID}`, {
      method: "POST",
      headers: { "x-authorization": env.SLIPOK_API_KEY ?? "" },
      body: form,
      signal: AbortSignal.timeout(SLIPOK_TIMEOUT_MS),
    });
    const body = await res.json();

    // สำเร็จ = success:true + มี data + ไม่มี code (SlipOK แนบ data มากับ 1012/1013/1014 ด้วย ห้ามดูแค่ data)
    if (!body?.success || !body?.data || body?.code) {
      const code = body?.code !== undefined && body?.code !== null ? String(body.code) : undefined;
      const described = describeSlipOkError(code, body ?? {}, params.expectedAmount);
      console.error(
        `🚨 [PAYMENT][SLIPOK] verify ไม่ผ่าน http=${res.status} code=${code ?? "-"} (${described.kind}) — ${described.adminMessage}`
      );
      return { success: false, devMode: false, error: described.userMessage, errorCode: code };
    }

    const d = body.data as Record<string, unknown>;
    const sender = (d.sender ?? {}) as Record<string, unknown>;
    const receiver = (d.receiver ?? {}) as Record<string, unknown>;
    const senderProxy = (sender.proxy ?? {}) as Record<string, unknown>;
    const senderAccount = (sender.account ?? {}) as Record<string, unknown>;
    const receiverProxy = (receiver.proxy ?? {}) as Record<string, unknown>;
    const receiverAccount = (receiver.account ?? {}) as Record<string, unknown>;

    return applySlipPolicy({
      amount: typeof d.amount === "number" ? d.amount : Number(d.amount),
      ref: pick(d.transRef) || undefined,
      senderName: pick(sender.displayName, sender.name) || undefined,
      // ผู้จ่าย: เลขบัญชี (masked) ก่อน แล้วค่อยพร็อกซี — ใช้เป็นคีย์ per-payer cap
      senderAccount: pick(senderAccount.value, senderProxy.value),
      senderBank: pick(d.sendingBank) || undefined,
      // ปลายทาง: PromptPay เบอร์โทร/บัตร ปชช. อยู่ใน proxy.value (masked "xxx-xxx-1966") — เทียบกับ PROMPTPAY_ID
      receiverAccount: pick(receiverProxy.value, receiverAccount.value),
      receiverNames: [receiver.displayName, receiver.name].filter(
        (v): v is string => typeof v === "string" && v.length > 0
      ),
      transAt:
        (typeof d.transTimestamp === "string" ? parseSlipDate(d.transTimestamp) : undefined) ??
        parseSlipOkDateTime(d.transDate, d.transTime),
    });
  } catch (err) {
    console.error(`🚨 [PAYMENT][SLIPOK] เรียก SlipOK ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, devMode: false, error: "เชื่อมต่อระบบตรวจสลิปไม่ได้ กรุณาลองใหม่" };
  }
}

export const slipOkAdapter: SlipProviderAdapter = {
  name: "slipok",
  label: "SlipOK",
  configured: isSlipOkConfigured,
  missingEnv: [!env.SLIPOK_API_KEY && "SLIPOK_API_KEY", !env.SLIPOK_BRANCH_ID && "SLIPOK_BRANCH_ID"].filter(
    (v): v is string => typeof v === "string"
  ),
  verify: verifyWithSlipOk,
};

// ทางลัดสำหรับเทส/สคริปต์ — เส้นทางจริงเรียกผ่าน lib/slip-verify.ts ตามสวิตช์ SLIP_PROVIDER
export function verifySlipWithSlipOk(params: SlipVerifyParams): Promise<SlipVerifyResult> {
  return runSlipVerification(slipOkAdapter, params);
}

// ============================================================
// โควต้าคงเหลือ (GET /quota) — ไว้โชว์แดชบอร์ดแอดมิน + เตือนตอน boot
// ============================================================
export interface SlipOkQuotaStatus {
  configured: boolean;
  ok: boolean;
  quota?: number; // โควต้าตามแพ็กเกจที่เหลือในเดือนนี้
  specialQuota?: number; // โควต้าพิเศษ/แถม
  overQuota?: number; // จำนวนที่ใช้เกินไปแล้ว (คิดเงินเพิ่มต่อรายการ)
  remaining?: number; // quota + specialQuota
  error?: string;
}

export const SLIPOK_QUOTA_WARN_REMAINING = 10;

export async function fetchSlipOkQuotaStatus(opts: { timeoutMs?: number } = {}): Promise<SlipOkQuotaStatus> {
  if (!isSlipOkConfigured) return { configured: false, ok: false, error: "not_configured" };
  try {
    const res = await fetch(`${SLIPOK_BASE_URL}/${env.SLIPOK_BRANCH_ID}/quota`, {
      headers: { "x-authorization": env.SLIPOK_API_KEY ?? "", "Content-Type": "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
      cache: "no-store",
    });
    const body = await res.json();
    if (!body?.success || !body?.data) {
      const code = body?.code !== undefined && body?.code !== null ? String(body.code) : `http_${res.status}`;
      return { configured: true, ok: false, error: code };
    }
    const d = body.data as Record<string, unknown>;
    const quota = typeof d.quota === "number" ? d.quota : undefined;
    const specialQuota = typeof d.specialQuota === "number" ? d.specialQuota : undefined;
    const overQuota = typeof d.overQuota === "number" ? d.overQuota : undefined;
    const remaining = quota === undefined ? undefined : quota + (specialQuota ?? 0);
    return { configured: true, ok: remaining === undefined || remaining > 0, quota, specialQuota, overQuota, remaining };
  } catch (err) {
    return { configured: true, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function slipOkHealthWarnings(s: SlipOkQuotaStatus): string[] {
  if (!s.configured) return [];
  if (s.error) {
    return [`ติดต่อ SlipOK ไม่ได้ / คีย์หรือสาขาไม่ถูกต้อง (${s.error}) — การจ่ายเงินจะถูกปฏิเสธทุกรายการจนกว่าจะแก้`];
  }
  const warnings: string[] = [];
  if (s.remaining !== undefined && s.remaining <= 0) {
    warnings.push(`โควต้า SlipOK เดือนนี้หมดแล้ว (ใช้เกินมา ${s.overQuota ?? 0} รายการ — แพ็กฟรีคิดเพิ่ม ฿1/สลิป)`);
  } else if (s.remaining !== undefined && s.remaining <= SLIPOK_QUOTA_WARN_REMAINING) {
    warnings.push(`โควต้า SlipOK เหลือ ${s.remaining} สลิป`);
  }
  return warnings;
}
