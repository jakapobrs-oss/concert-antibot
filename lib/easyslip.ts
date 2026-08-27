// EasySlip API — ผู้ให้บริการตรวจสลิปเจ้าแรก (ค่าเริ่มต้นของ SLIP_PROVIDER) — verify สลิปโอนเงิน (กันสลิปปลอม + กันโอนผิดบัญชี)
// แอปฟรีมีวันหมดอายุ + โควต้า 50 — ดูจาก /api/v1/me (เคยหมดอายุเงียบ ๆ 10 มิ.ย.–27 ส.ค. 2026)
//
// กติกาเงินทั้งหมด (ต้องแนบสลิป / fail-closed / mock บน dev / บัญชีปลายทาง / transRef) อยู่ที่ lib/slip-policy.ts
//   ไฟล์นี้ทำแค่ "คุยกับ EasySlip แล้วแกะคำตอบ" — SlipOK อยู่ที่ lib/slipok.ts, สวิตช์อยู่ที่ lib/slip-verify.ts
//
// บทเรียน 2026-08-27 (โอนจริงครั้งแรกบน prod): EasySlip ตอบ 403 application_expired (แอปหมดอายุตั้งแต่ 10 มิ.ย.)
//   แต่โค้ดเดิมกลืน data.message ทิ้ง → ผู้ใช้เห็น "สลิปอาจไม่ถูกต้อง" ทั้งที่สลิปถูก + log ไม่มีอะไรให้ไล่
//   → ตอนนี้แยก "ระบบ/บัญชีเราพัง" ออกจาก "สลิปมีปัญหา" + log รหัส error เสมอ + มี fetchEasySlipAccountStatus()
import { env, isEasySlipConfigured } from "@/lib/env";
import { parseSlipDate } from "@/lib/slip-date";
import {
  applySlipPolicy,
  decodeSlipImage,
  runSlipVerification,
  type SlipProviderAdapter,
  type SlipVerifyParams,
  type SlipVerifyResult,
} from "@/lib/slip-policy";

export type { SlipVerifyResult, SlipVerifyParams };
export { decodeSlipImage };

const EASYSLIP_BASE_URL = "https://developer.easyslip.com/api/v1";
const EASYSLIP_VERIFY_URL = `${EASYSLIP_BASE_URL}/verify`;
const EASYSLIP_ME_URL = `${EASYSLIP_BASE_URL}/me`;
// EasySlip ตอบช้าได้เป็นวินาทีตอนธนาคารหน่วง — แต่ห้ามค้างจน order หมดอายุ (VERIFY_LEASE ใน booking.ts)
const EASYSLIP_TIMEOUT_MS = 20_000;

// ============================================================
// รหัส error ของ EasySlip (v1 คืน { status, message }) — แยก 2 กลุ่มตามว่า "ใครแก้ได้"
//   system = ฝั่งเรา/บัญชี EasySlip ของร้าน (ผู้ใช้ทำอะไรไม่ได้ ต้องแอดมิน)
//   slip   = ตัวสลิป/รูปที่ผู้ใช้ส่งมา (ผู้ใช้แก้เองได้ — บอกให้ชัดว่าต้องทำอะไร)
// ============================================================
export const EASYSLIP_SYSTEM_ERRORS: Record<string, string> = {
  unauthorized: "คีย์ EasySlip ไม่ถูกต้อง (EASYSLIP_API_KEY)",
  application_expired:
    "แอปพลิเคชัน EasySlip หมดอายุ — ต่ออายุ/สร้างแอปใหม่ที่ easyslip.com แล้วอัปเดต EASYSLIP_API_KEY บน production (หรือสลับ SLIP_PROVIDER=slipok)",
  application_deactivated: "แอปพลิเคชัน EasySlip ถูกปิดใช้งาน",
  account_not_verified: "บัญชี EasySlip ยังไม่ผ่านการยืนยันตัวตน",
  access_denied: "EasySlip ปฏิเสธการเข้าถึง (สิทธิ์/IP ของแอป)",
  quota_exceeded: "โควต้าตรวจสลิปของ EasySlip หมดแล้ว — เพิ่มโควต้าหรือรอรอบเดือนใหม่",
  server_error: "EasySlip ขัดข้องภายใน (server_error)",
};

const SLIP_UNREADABLE =
  "อ่านสลิปจากรูปไม่ได้ — กรุณาอัปโหลดรูปสลิปเต็มใบที่บันทึกจากแอปธนาคาร (ต้องเห็น QR บนสลิปชัด ไม่ครอป/ไม่ถ่ายหน้าจอ)";
export const EASYSLIP_SLIP_ERRORS: Record<string, string> = {
  invalid_image: SLIP_UNREADABLE,
  qrcode_not_found: SLIP_UNREADABLE,
  invalid_payload: SLIP_UNREADABLE,
  image_size_too_large: "รูปสลิปใหญ่เกินไป (EasySlip รับไม่เกิน 4MB) — กรุณาใช้รูปที่บันทึกจากแอปธนาคารโดยตรง",
  slip_not_found:
    "ไม่พบรายการโอนนี้ในระบบธนาคาร — ตรวจสอบว่าเป็นสลิปจริงที่โอนสำเร็จแล้ว หากเพิ่งโอน รอสักครู่แล้วลองใหม่",
  slip_pending: "ธนาคารยังไม่ยืนยันรายการนี้ (บางธนาคารใช้เวลาสักครู่) — กรุณาลองใหม่ในอีก 1–2 นาที",
  duplicate_slip: "สลิปนี้ถูกใช้ยืนยันการชำระเงินไปแล้ว — ใช้สลิปซ้ำไม่ได้",
  rate_limit_exceeded: "ส่งสลิปถี่เกินไป กรุณารอสักครู่แล้วลองใหม่",
  too_many_requests: "ส่งสลิปถี่เกินไป กรุณารอสักครู่แล้วลองใหม่",
};

export type EasySlipErrorKind = "system" | "slip" | "unknown";

// แปลรหัส error → ข้อความ 2 ชุด: ให้ผู้ใช้ (ไม่หลอกว่าสลิปผิดถ้าเป็นเราพัง) + ให้แอดมิน/log (บอกวิธีแก้)
export function describeEasySlipError(code: string | undefined): {
  kind: EasySlipErrorKind;
  userMessage: string;
  adminMessage: string;
} {
  if (code && EASYSLIP_SYSTEM_ERRORS[code]) {
    return {
      kind: "system",
      // บอกผู้ใช้ตรง ๆ ว่าไม่ใช่ความผิดของสลิป + แนบรหัสสั้น ๆ ให้แจ้งแอดมินได้ (ไม่เปิดเผยอะไรลับ)
      userMessage: `ระบบตรวจสอบสลิปขัดข้องชั่วคราว ไม่ใช่ความผิดของสลิปคุณ — กรุณาติดต่อผู้ดูแล (รหัส: ${code})`,
      adminMessage: EASYSLIP_SYSTEM_ERRORS[code],
    };
  }
  if (code && EASYSLIP_SLIP_ERRORS[code]) {
    return { kind: "slip", userMessage: EASYSLIP_SLIP_ERRORS[code], adminMessage: `สลิปมีปัญหา (${code})` };
  }
  return {
    kind: "unknown",
    userMessage: `ตรวจสอบสลิปไม่สำเร็จ — สลิปอาจไม่ถูกต้อง หากมั่นใจว่าโอนแล้ว กรุณาติดต่อผู้ดูแล${
      code ? ` (รหัส: ${code})` : ""
    }`,
    adminMessage: `EasySlip ตอบรหัสที่ไม่รู้จัก (${code ?? "ไม่มี message"})`,
  };
}

// ประกอบคำขอ verify ตามเอกสาร EasySlip v1:
//   - รูป → POST multipart/form-data ฟิลด์ "file" (ไบนารี)
//   - payload จาก QR → POST JSON { payload }
function buildVerifyRequest(params: { slipImageBase64?: string; payload?: string }): RequestInit {
  const auth = { Authorization: `Bearer ${env.EASYSLIP_API_KEY}` };
  if (params.payload) {
    return {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ payload: params.payload }),
      signal: AbortSignal.timeout(EASYSLIP_TIMEOUT_MS),
    };
  }
  const { bytes, mime, ext } = decodeSlipImage(params.slipImageBase64 ?? "");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), `slip.${ext}`);
  return { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(EASYSLIP_TIMEOUT_MS) };
}

// เรียก EasySlip จริง → แกะคำตอบ → ด่านนโยบายกลาง (บัญชีปลายทาง/ชื่อผู้รับ/transRef)
async function verifyWithEasySlip(params: SlipVerifyParams): Promise<SlipVerifyResult> {
  try {
    const res = await fetch(EASYSLIP_VERIFY_URL, buildVerifyRequest(params));
    const data = await res.json();

    // EasySlip คืน { status, data: { amount: { amount }, sender, receiver, transRef } }
    //   ไม่ผ่าน → { status: 4xx/5xx, message: "<รหัส>" } — ต้อง log รหัสเสมอ ไม่งั้นไล่ปัญหาบน prod ไม่ได้
    if (data.status !== 200 || !data.data) {
      const code = typeof data.message === "string" ? data.message : undefined;
      const described = describeEasySlipError(code);
      console.error(
        `🚨 [PAYMENT][EASYSLIP] verify ไม่ผ่าน status=${data.status ?? res.status ?? "?"} code=${code ?? "-"} (${described.kind}) — ${described.adminMessage}`
      );
      return { success: false, devMode: false, error: described.userMessage, errorCode: code };
    }

    const d = data.data;
    console.info(`[PAYMENT][EASYSLIP] verify ผ่าน ref=${String(d.transRef ?? d.ref ?? "-")} amount=${String(d.amount?.amount ?? d.amount ?? "?")}`);
    return applySlipPolicy({
      amount: d.amount?.amount ?? d.amount,
      ref: d.transRef ?? d.ref,
      senderName: d.sender?.account?.name?.th ?? d.sender?.account?.name?.en ?? d.sender?.name,
      // เลขบัญชี/พร็อกซี "ผู้จ่าย" (shape เดียวกับ receiver) — ใช้เป็นคีย์ per-payer cap
      //   มัก masked (เช่น xxx-x-x1234-5) แต่เสถียรพอใช้เป็น identity ของบัญชีธนาคารต้นทาง
      senderAccount: d.sender?.account?.proxy?.account ?? d.sender?.account?.bank?.account ?? "",
      // ธนาคารต้นทาง (EasySlip: sender.bank = { id: "004", name, short: "KBANK" }) — รหัส id เสถียรสุด
      //   ใช้เสริมคีย์ผู้จ่ายเฉพาะกรณีสลิปไม่มีเลขบัญชีเลย (lib/payer-key.ts, SECURITY_TODO #3)
      senderBank: d.sender?.bank?.id ?? d.sender?.bank?.short ?? d.sender?.bank?.name ?? undefined,
      // เลขบัญชี/พร็อกซีปลายทาง — ลองหลายตำแหน่งตาม shape ของ EasySlip
      receiverAccount:
        d.receiver?.account?.proxy?.account ??
        d.receiver?.account?.bank?.account ??
        d.receiver?.account?.name?.th ??
        "",
      receiverNames: [d.receiver?.account?.name?.th, d.receiver?.account?.name?.en, d.receiver?.name].filter(
        (v): v is string => typeof v === "string" && v.length > 0
      ),
      // เวลาธุรกรรมจากสลิป (EasySlip คืน ISO string ใน data.date)
      // F6: parse ผ่าน helper — ถ้า string ไม่มี timezone ถือเป็นเวลาไทย (กันเพี้ยน 7 ชม.)
      transAt: parseSlipDate(d.date),
    });
  } catch (err) {
    // network/timeout/JSON พัง — log ไว้ให้ไล่ได้ แต่ไม่ throw ออกไป (ผู้ใช้ได้ข้อความปลอดภัย)
    console.error(
      `🚨 [PAYMENT][EASYSLIP] เรียก EasySlip ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`
    );
    return { success: false, devMode: false, error: "เชื่อมต่อ EasySlip ไม่ได้ กรุณาลองใหม่" };
  }
}

export const easySlipAdapter: SlipProviderAdapter = {
  name: "easyslip",
  label: "EasySlip",
  configured: isEasySlipConfigured,
  missingEnv: isEasySlipConfigured ? [] : ["EASYSLIP_API_KEY"],
  verify: verifyWithEasySlip,
};

// verify สลิปผ่าน EasySlip (รวมด่าน ต้องแนบสลิป / fail-closed บน production / mock บน dev)
//   เส้นทางจริงเรียกผ่าน lib/slip-verify.ts ตามสวิตช์ SLIP_PROVIDER — ตัวนี้คงไว้ให้เทส/สคริปต์เดิม
export function verifySlip(params: SlipVerifyParams): Promise<SlipVerifyResult> {
  return runSlipVerification(easySlipAdapter, params);
}

// ============================================================
// สถานะบัญชี/แอป EasySlip ของร้าน (GET /api/v1/me) — ไว้โชว์ในแดชบอร์ดแอดมิน + เตือนตอน boot
//   ตอบ { status:200, data:{ application, usedQuota, maxQuota, remainingQuota, expiredAt, currentCredit } }
// ============================================================
export interface EasySlipAccountStatus {
  configured: boolean;
  ok: boolean; // ติดต่อได้ + แอปยังใช้งานได้ (ไม่หมดอายุ, โควต้ายังเหลือ)
  application?: string;
  usedQuota?: number;
  maxQuota?: number;
  remainingQuota?: number;
  expiredAt?: Date;
  expired?: boolean;
  daysLeft?: number; // จำนวนวันก่อนหมดอายุ (ติดลบ = หมดแล้ว)
  error?: string; // รหัส/สาเหตุที่ติดต่อไม่ได้ (เช่น application_expired, unauthorized, timeout)
}

export async function fetchEasySlipAccountStatus(
  opts: { timeoutMs?: number; now?: Date } = {}
): Promise<EasySlipAccountStatus> {
  if (!isEasySlipConfigured) return { configured: false, ok: false, error: "not_configured" };
  const now = opts.now ?? new Date();
  try {
    const res = await fetch(EASYSLIP_ME_URL, {
      headers: { Authorization: `Bearer ${env.EASYSLIP_API_KEY}` },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
      cache: "no-store",
    });
    const data = await res.json();
    if (data.status !== 200 || !data.data) {
      const code = typeof data.message === "string" ? data.message : `http_${res.status}`;
      return { configured: true, ok: false, error: code };
    }
    const d = data.data;
    const expiredAt = d.expiredAt ? new Date(d.expiredAt) : undefined;
    const daysLeft = expiredAt ? Math.floor((expiredAt.getTime() - now.getTime()) / 86_400_000) : undefined;
    const expired = expiredAt ? expiredAt.getTime() <= now.getTime() : false;
    const remainingQuota = typeof d.remainingQuota === "number" ? d.remainingQuota : undefined;
    return {
      configured: true,
      ok: !expired && (remainingQuota === undefined || remainingQuota > 0),
      application: typeof d.application === "string" ? d.application : undefined,
      usedQuota: typeof d.usedQuota === "number" ? d.usedQuota : undefined,
      maxQuota: typeof d.maxQuota === "number" ? d.maxQuota : undefined,
      remainingQuota,
      expiredAt,
      expired,
      daysLeft,
    };
  } catch (err) {
    return { configured: true, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// เตือนใน log ตอน boot (production) ถ้าแอป EasySlip หมดอายุ/ใกล้หมด/โควต้าใกล้หมด
//   ไม่ throw ไม่บล็อกการ boot — เป็นสัญญาณให้แอดมินเห็นก่อนลูกค้าจ่ายไม่ได้
export const EASYSLIP_EXPIRY_WARN_DAYS = 7;
export const EASYSLIP_QUOTA_WARN_REMAINING = 10;

export function easySlipHealthWarnings(s: EasySlipAccountStatus): string[] {
  if (!s.configured) return [];
  const warnings: string[] = [];
  if (s.error) {
    warnings.push(
      `ติดต่อ EasySlip ไม่ได้ / คีย์ใช้ไม่ได้ (${s.error}) — การจ่ายเงินจะถูกปฏิเสธทุกรายการจนกว่าจะแก้`
    );
    return warnings;
  }
  if (s.expired) {
    warnings.push(
      `แอป EasySlip "${s.application ?? "-"}" หมดอายุแล้ว (${s.expiredAt?.toISOString() ?? "?"}) — ต่ออายุที่ easyslip.com แล้วอัปเดต EASYSLIP_API_KEY`
    );
  } else if (s.daysLeft !== undefined && s.daysLeft <= EASYSLIP_EXPIRY_WARN_DAYS) {
    warnings.push(`แอป EasySlip จะหมดอายุในอีก ${s.daysLeft} วัน (${s.expiredAt?.toISOString() ?? "?"})`);
  }
  if (s.remainingQuota !== undefined && s.remainingQuota <= EASYSLIP_QUOTA_WARN_REMAINING) {
    warnings.push(`โควต้าตรวจสลิป EasySlip เหลือ ${s.remainingQuota}/${s.maxQuota ?? "?"} ครั้ง`);
  }
  return warnings;
}

export async function warnEasySlipAccountHealth(): Promise<void> {
  const status = await fetchEasySlipAccountStatus();
  for (const w of easySlipHealthWarnings(status)) console.error(`🚨 [PAYMENT][EASYSLIP] ${w}`);
}

export { isEasySlipConfigured };
