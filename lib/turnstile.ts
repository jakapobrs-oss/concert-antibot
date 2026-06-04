// Cloudflare Turnstile verification (server-side)
// ฟรี unlimited + privacy-friendly (ไม่ track user เหมือน reCAPTCHA)
//
// Dev mode: ถ้าไม่ตั้ง TURNSTILE_SECRET_KEY → ใช้ test keys ของ Cloudflare
//   - site key (always pass): 1x00000000000000000000AA
//   - secret key (always pass): 1x0000000000000000000000000000000AA
// อ้างอิง: https://developers.cloudflare.com/turnstile/troubleshooting/testing/

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// test secret ที่ Cloudflare ให้ — verify ผ่านเสมอ (ใช้ตอน dev ที่ยังไม่ขอ key จริง)
const DEV_SECRET = "1x0000000000000000000000000000000AA";

export interface TurnstileResult {
  success: boolean;
  // ถ้า dev mode (ใช้ test key) flag ไว้เพื่อ log
  devMode: boolean;
  errorCodes?: string[];
}

// production หรือยัง — ใช้ตัดสิน fail-closed
const isProduction = process.env.NODE_ENV === "production";

// ตั้ง secret จริงหรือยัง (ใช้เตือนตอน boot ใน lib/env.ts)
export const isTurnstileConfigured = !!process.env.TURNSTILE_SECRET_KEY;

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string
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
    const data = (await res.json()) as { success: boolean; "error-codes"?: string[] };

    return {
      success: data.success,
      devMode,
      errorCodes: data["error-codes"],
    };
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
