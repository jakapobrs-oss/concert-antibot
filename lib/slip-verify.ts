// จุดเข้าเดียวของการตรวจสลิป — เลือกผู้ให้บริการตาม SLIP_PROVIDER (easyslip | slipok) ไม่ต้องแก้โค้ดตอนสลับ
//   เหตุ (2026-08-27 rev 40): แอปทดลอง EasySlip หมดอายุ → สลับไป SlipOK (ฟรี 100 สลิป/เดือน) และเก็บ EasySlip ไว้เป็นตัวสำรอง
//   กติกาเงิน (ยอด/บัญชีปลายทาง/transRef/สลิปซ้ำ) อยู่ที่ lib/slip-policy.ts + booking.ts เหมือนกันทุกเจ้า
import { env } from "@/lib/env";
import { formatThaiDate } from "@/lib/format";
import {
  runSlipVerification,
  type SlipProviderAdapter,
  type SlipVerifyParams,
  type SlipVerifyResult,
} from "@/lib/slip-policy";
import {
  easySlipAdapter,
  fetchEasySlipAccountStatus,
  easySlipHealthWarnings,
  EASYSLIP_EXPIRY_WARN_DAYS,
  EASYSLIP_QUOTA_WARN_REMAINING,
} from "@/lib/easyslip";
import { slipOkAdapter, fetchSlipOkQuotaStatus, slipOkHealthWarnings, SLIPOK_QUOTA_WARN_REMAINING } from "@/lib/slipok";

export type SlipProvider = "easyslip" | "slipok";
export type { SlipVerifyParams, SlipVerifyResult };

export const SLIP_PROVIDER_LABEL: Record<SlipProvider, string> = { easyslip: "EasySlip", slipok: "SlipOK" };

export function getSlipAdapter(provider: SlipProvider = env.SLIP_PROVIDER): SlipProviderAdapter {
  return provider === "slipok" ? slipOkAdapter : easySlipAdapter;
}

export const activeSlipProvider: SlipProvider = env.SLIP_PROVIDER;
export const isSlipVerifierConfigured = getSlipAdapter().configured;

// ⭐ ทางเงินเรียกตัวนี้ (app/actions/booking.ts)
export function verifySlip(params: SlipVerifyParams): Promise<SlipVerifyResult> {
  return runSlipVerification(getSlipAdapter(), params);
}

// ============================================================
// สถานะผู้ให้บริการที่เปิดใช้ — แดชบอร์ดแอดมิน + boot-warn ใช้ร่วมกัน
// ============================================================
export interface SlipProviderStatus {
  provider: SlipProvider;
  label: string;
  configured: boolean;
  tone: "danger" | "warning" | "success";
  line: string; // ประโยคเดียวสรุปสถานะ (โชว์บนการ์ด)
  hint?: string; // วิธีแก้เมื่อไม่เขียว
  warnings: string[]; // ข้อความสำหรับ log ตอน boot
}

export async function getSlipProviderStatus(opts: { timeoutMs?: number; now?: Date } = {}): Promise<SlipProviderStatus> {
  const provider = env.SLIP_PROVIDER;
  const label = SLIP_PROVIDER_LABEL[provider];
  const adapter = getSlipAdapter(provider);

  if (!adapter.configured) {
    return {
      provider,
      label,
      configured: false,
      tone: "danger",
      line: `ยังไม่ได้ตั้ง ${adapter.missingEnv.join(" + ")} — จ่ายเงินจริงไม่ได้ (fail-closed)`,
      hint: `SLIP_PROVIDER=${provider} ต้องมี ${adapter.missingEnv.join(" + ")} บน Vercel แล้ว redeploy`,
      warnings: [],
    };
  }

  if (provider === "slipok") {
    const s = await fetchSlipOkQuotaStatus({ timeoutMs: opts.timeoutMs });
    const warnings = slipOkHealthWarnings(s);
    const line = s.error
      ? `ใช้งานไม่ได้: ${s.error}`
      : `สาขา ${env.SLIPOK_BRANCH_ID} · โควต้าเหลือ ${s.remaining ?? "?"} สลิป${
          s.specialQuota ? ` (รวมพิเศษ ${s.specialQuota})` : ""
        }${s.overQuota ? ` · ใช้เกินมา ${s.overQuota}` : ""}`;
    const tone: SlipProviderStatus["tone"] = s.error
      ? "danger"
      : (s.remaining ?? 99) <= 0
        ? "danger"
        : (s.remaining ?? 99) <= SLIPOK_QUOTA_WARN_REMAINING
          ? "warning"
          : "success";
    return {
      provider,
      label,
      configured: true,
      tone,
      line,
      hint:
        tone === "success"
          ? undefined
          : "แพ็กฟรี OK BASIC ได้ 100 สลิป/เดือน (เกินคิด ฿1/สลิป) — ต่อ/อัปเกรดแพ็กเกจในเมนู SlipOK บน LINE",
      warnings,
    };
  }

  const s = await fetchEasySlipAccountStatus({ timeoutMs: opts.timeoutMs, now: opts.now });
  const warnings = easySlipHealthWarnings(s);
  const expiredAtText = s.expiredAt ? formatThaiDate(s.expiredAt) : "?";
  const line = s.error
    ? `ใช้งานไม่ได้: ${s.error}`
    : s.expired
      ? `แอป "${s.application ?? "-"}" หมดอายุแล้วตั้งแต่ ${expiredAtText}`
      : `แอป "${s.application ?? "-"}" ใช้ได้ถึง ${expiredAtText} (อีก ${s.daysLeft ?? "?"} วัน) · โควต้าเหลือ ${
          s.remainingQuota ?? "?"
        }/${s.maxQuota ?? "?"}`;
  const tone: SlipProviderStatus["tone"] =
    s.error || s.expired
      ? "danger"
      : (s.daysLeft ?? 99) <= EASYSLIP_EXPIRY_WARN_DAYS || (s.remainingQuota ?? 99) <= EASYSLIP_QUOTA_WARN_REMAINING
        ? "warning"
        : "success";
  return {
    provider,
    label,
    configured: true,
    tone,
    line,
    hint:
      tone === "success"
        ? undefined
        : "ต่ออายุ/สร้างแอปใหม่ที่ easyslip.com → อัปเดต EASYSLIP_API_KEY บน Vercel → redeploy (หรือสลับ SLIP_PROVIDER=slipok)",
    warnings,
  };
}

// เตือนใน log ตอน boot (production) — ไม่ throw ไม่บล็อกการ boot
export async function warnSlipProviderHealth(): Promise<void> {
  const status = await getSlipProviderStatus();
  const tag = status.provider === "slipok" ? "SLIPOK" : "EASYSLIP";
  if (!status.configured) {
    console.error(`🚨 [PAYMENT][${tag}] ${status.line}`);
    return;
  }
  for (const w of status.warnings) console.error(`🚨 [PAYMENT][${tag}] ${w}`);
}
