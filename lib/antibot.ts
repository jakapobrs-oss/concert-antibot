// ============================================================
// Anti-Bot Engine — Layer 1 (Phase 5)
// ============================================================
// ปรัชญา: SCORING ไม่ใช่ binary block — รวมหลายสัญญาณเป็นคะแนน 0-100
//   เหตุผล: ผู้ใช้จริงมีหลายแบบ (มือถือเก่า, เน็ตช้า, VPN, accessibility tools)
//          ถ้า block ทันทีจาก signal เดียว → false positive สูง = คนจริงเข้าไม่ได้
//   วิธี: รวมคะแนนจากหลาย signal แล้วตัดสิน:
//     score < 40  → ALLOW    (ผ่านเข้าคิวได้เลย)
//     40-69       → CHALLENGE (ให้ทำ Turnstile/ยืนยันเพิ่ม — ไม่ block)
//     >= 70       → BLOCK     (ปฏิเสธ — มั่นใจว่าบอท)
//
// Signals ใน Layer 1:
//   1. Turnstile result (สัญญาณหนักสุด)
//   2. User-Agent heuristics (headless / bot keyword / ว่างเปล่า)
//   3. Header completeness (บอทมักขาด accept-language / accept)
//   4. Fingerprint presence (ไม่มี fingerprint = น่าสงสัย เพราะ JS ไม่รัน)
// (Layer 2 = behavior analysis จะเพิ่ม Phase 6)
import { verifyTurnstile } from "@/lib/turnstile";

export type BotAction = "ALLOW" | "CHALLENGE" | "BLOCK";

export interface BotSignals {
  turnstile: "pass" | "fail" | "dev-pass" | "missing";
  userAgent: "ok" | "suspicious" | "bot" | "empty";
  headers: "complete" | "incomplete";
  fingerprint: "present" | "missing";
}

export interface BotAssessment {
  score: number; // 0-100
  action: BotAction;
  signals: BotSignals;
}

// threshold (ปรับผ่าน env ได้ — ค่า default จาก .env.example BOT_SCORE_THRESHOLD)
const CHALLENGE_THRESHOLD = 40;
const BLOCK_THRESHOLD = 70;

// keyword ที่บ่งชี้บอทใน User-Agent
const BOT_UA_KEYWORDS = [
  "bot", "crawler", "spider", "scraper", "headless", "phantom",
  "selenium", "puppeteer", "playwright", "python-requests", "curl",
  "wget", "axios", "go-http", "java/", "okhttp",
];

// ประเมิน UA → คืนคะแนนที่เพิ่ม + label
function scoreUserAgent(ua: string | null): { score: number; label: BotSignals["userAgent"] } {
  if (!ua || ua.trim() === "") return { score: 35, label: "empty" }; // ไม่มี UA = น่าสงสัยมาก
  const lower = ua.toLowerCase();
  if (BOT_UA_KEYWORDS.some((k) => lower.includes(k))) {
    return { score: 50, label: "bot" }; // เจอ keyword บอทชัด ๆ
  }
  // UA สั้นผิดปกติ (browser จริงยาว > 40 ตัว)
  if (ua.length < 30) return { score: 20, label: "suspicious" };
  return { score: 0, label: "ok" };
}

// ประเมิน header completeness — บอทมักขาด header ที่ browser จริงส่งเสมอ
function scoreHeaders(headers: Headers): { score: number; label: BotSignals["headers"] } {
  const hasAcceptLang = !!headers.get("accept-language");
  const hasAccept = !!headers.get("accept");
  if (!hasAcceptLang || !hasAccept) {
    return { score: 15, label: "incomplete" };
  }
  return { score: 0, label: "complete" };
}

// ประเมินรวม — เรียกตอน queue join
export async function assessRequest(params: {
  turnstileToken?: string | null;
  userAgent: string | null;
  headers: Headers;
  fingerprintHash?: string | null;
  ip?: string;
}): Promise<BotAssessment> {
  let score = 0;

  // --- Signal 1: Turnstile (หนักสุด) ---
  const ts = await verifyTurnstile(params.turnstileToken, params.ip);
  let turnstileSignal: BotSignals["turnstile"];
  if (!params.turnstileToken) {
    turnstileSignal = "missing";
    score += 40; // ไม่ส่ง token เลย → เข้าเกณฑ์ challenge
  } else if (ts.success) {
    turnstileSignal = ts.devMode ? "dev-pass" : "pass";
    // ผ่าน → ไม่เพิ่มคะแนน (เป็นสัญญาณว่าเป็นคนจริง)
  } else {
    turnstileSignal = "fail";
    score += 55; // Turnstile fail → น่าจะบอท
  }

  // --- Signal 2: User-Agent ---
  const uaResult = scoreUserAgent(params.userAgent);
  score += uaResult.score;

  // --- Signal 3: Headers ---
  const headerResult = scoreHeaders(params.headers);
  score += headerResult.score;

  // --- Signal 4: Fingerprint ---
  // ไม่มี fingerprint = JS ไม่รัน = น่าสงสัย (แต่คะแนนน้อย เพราะ privacy tool บางตัวบล็อก)
  const fpSignal: BotSignals["fingerprint"] = params.fingerprintHash ? "present" : "missing";
  if (!params.fingerprintHash) score += 10;

  // clamp 0-100
  score = Math.min(100, Math.max(0, score));

  // ตัดสิน action
  let action: BotAction;
  if (score >= BLOCK_THRESHOLD) action = "BLOCK";
  else if (score >= CHALLENGE_THRESHOLD) action = "CHALLENGE";
  else action = "ALLOW";

  return {
    score,
    action,
    signals: {
      turnstile: turnstileSignal,
      userAgent: uaResult.label,
      headers: headerResult.label,
      fingerprint: fpSignal,
    },
  };
}

export const ANTIBOT_CONFIG = { CHALLENGE_THRESHOLD, BLOCK_THRESHOLD };
