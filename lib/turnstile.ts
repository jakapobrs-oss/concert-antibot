// Cloudflare Turnstile verification (server-side)
// ฟรี unlimited + privacy-friendly (ไม่ track user เหมือน reCAPTCHA)
//
// Dev mode: ถ้าไม่ตั้ง TURNSTILE_SECRET_KEY → ใช้ test keys ของ Cloudflare
//   - site key (always pass): 1x00000000000000000000AA
//   - secret key (always pass): 1x0000000000000000000000000000000AA
// อ้างอิง: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
import type { TurnstileAction } from "@/lib/turnstile-actions";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// test secret ที่ Cloudflare ให้ — verify ผ่านเสมอ (ใช้ตอน dev ที่ยังไม่ขอ key จริง)
const DEV_SECRET = "1x0000000000000000000000000000000AA";

export interface TurnstileResult {
  success: boolean;
  // ถ้า dev mode (ใช้ test key) flag ไว้เพื่อ log
  devMode: boolean;
  errorCodes?: string[];
}

// สิ่งที่ token "ควรเป็น" — เทียบกับที่ Cloudflare ยืนยันกลับมา (SECURITY_TODO #2)
//   token ของ Turnstile ใช้ได้ครั้งเดียวอยู่แล้ว แต่ถ้าไม่เช็ค 2 ข้อนี้ token ที่แก้จาก "widget อื่น/โดเมนอื่น"
//   (เช่น มนุษย์แก้ให้ที่ด่านคิว แล้วสคริปต์เอาไปยิงด่านซื้อ) จะยังผ่านได้
export interface TurnstileExpectation {
  // ชื่อ widget ของด่านนี้ (data-action ตอน render) — token จาก widget ด่านอื่นใช้ที่นี่ไม่ได้
  action?: TurnstileAction;
  // host ของ "คำขอนี้" (Host header) — token ต้องถูกแก้บนโดเมนเดียวกับที่ยิงมา
  //   null/undefined = ไม่ทราบ host (เช่น ไม่มี header) = ข้ามเช็คข้อนี้ (ยังเช็ค action)
  hostname?: string | null;
}

// shape ของ siteverify response ที่ใช้ (มี field อื่นอีก: challenge_ts, cdata — ไม่ได้ใช้)
interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
  action?: string;
}

// production หรือยัง — ใช้ตัดสิน fail-closed
const isProduction = process.env.NODE_ENV === "production";

// ตั้ง secret จริงหรือยัง (ใช้เตือนตอน boot ใน lib/env.ts)
export const isTurnstileConfigured = !!process.env.TURNSTILE_SECRET_KEY;

// ทำ hostname ให้เทียบกันได้: ตัด port / ช่องว่าง / จุดท้าย + lower-case
//   Host header มาได้หลายแบบ: "concert-antibot.vercel.app" · "localhost:3000" · "[::1]:3000"
//   ส่วน Cloudflare คืนแค่ชื่อโฮสต์ที่ widget รัน (ไม่มี port) เช่น "localhost"
export function normalizeHostname(value: string | null | undefined): string {
  const host = (value ?? "").trim().toLowerCase();
  if (!host) return "";
  // IPv6 literal ใน Host header อยู่ในวงเล็บเสมอ: [::1]:3000 → ::1
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end > 0 ? host.slice(1, end) : host;
  }
  const withoutPort = host.split(":")[0] ?? host;
  return withoutPort.replace(/\.$/, "");
}

// เทียบผลจาก Cloudflare กับสิ่งที่ด่านนี้คาดหวัง — คืน error code ถ้าไม่ตรง, null = ตรงหมด
function findExpectationMismatch(
  expectation: TurnstileExpectation,
  data: SiteverifyResponse
): string | null {
  // action ต้องตรงเป๊ะ — Cloudflare ไม่คืน action เลย = widget ไม่ได้ตั้ง = ไม่ใช่ widget ของเรา
  if (expectation.action && data.action !== expectation.action) return "action-mismatch";
  const expectedHost = normalizeHostname(expectation.hostname);
  if (expectedHost && normalizeHostname(data.hostname) !== expectedHost) return "hostname-mismatch";
  return null;
}

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string,
  expectation?: TurnstileExpectation
): Promise<TurnstileResult> {
  const realSecret = process.env.TURNSTILE_SECRET_KEY;
  const devMode = !realSecret;

  // 🔒 fail-closed: production แต่ไม่ได้ตั้ง secret จริง = misconfig
  //    ห้าม fallback ไป test key (always-pass) เพราะจะเท่ากับ "ปิด CAPTCHA เงียบ ๆ" บน production
  //    คืน fail เพื่อให้ assessRequest ดันคะแนนขึ้น (CHALLENGE/BLOCK) แทนการปล่อยผ่าน
  if (!realSecret && isProduction) {
    return { success: false, devMode, errorCodes: ["not-configured"] };
  }

  const secret = realSecret || DEV_SECRET;

  // ไม่มี token เลย → fail (client ไม่ได้แก้ widget)
  if (!token) {
    return { success: false, devMode, errorCodes: ["missing-input-response"] };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.append("remoteip", remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as SiteverifyResponse;

    if (!data.success) {
      return { success: false, devMode, errorCodes: data["error-codes"] };
    }

    // 🔒 SECURITY_TODO #2: token ต้อง "ตรงจุด" — แก้จาก widget ของด่านนี้ บนโดเมนที่คำขอนี้ยิงมา
    //    ข้ามใน dev mode: test key ของ Cloudflare คืน hostname/action ค่าตายตัวของเขา ไม่ใช่ของเรา
    if (!devMode && expectation) {
      const mismatch = findExpectationMismatch(expectation, data);
      if (mismatch) return { success: false, devMode, errorCodes: [mismatch] };
    }

    return { success: true, devMode, errorCodes: data["error-codes"] };
  } catch {
    // network error ตอน verify Cloudflare:
    //   - production → fail-CLOSED (success:false) — เรื่อง anti-bot ห้ามปล่อยผ่านเพราะ network พลาด
    //   - development → fail-open (success:true) กัน false positive ตอน dev/เน็ตหลุด
    return { success: !isProduction, devMode, errorCodes: ["verify-network-error"] };
  }
}

// site key ฝั่ง client (ส่งไปให้หน้าเว็บ render widget)
export function getTurnstileSiteKey(): string {
  // test site key (always pass) ถ้ายังไม่ตั้งของจริง
  return process.env.TURNSTILE_SITE_KEY || "1x00000000000000000000AA";
}

export const isTurnstileDevMode = !process.env.TURNSTILE_SECRET_KEY;
