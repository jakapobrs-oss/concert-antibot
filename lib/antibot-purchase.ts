// ============================================================
// Anti-Bot ด่านที่ 2 — ตอน "กดซื้อ" (SECURITY_TODO #1)
// ============================================================
// ทำไมต้องมีด่านนี้ ทั้งที่ด่านคิวตรวจไปแล้ว:
//   ด่านคิว (`app/api/queue/join/route.ts`) ปฏิเสธ 403 ทันทีเมื่อ BLOCK
//   → ใครก็ตามที่ถือ queue token ที่ admit แล้ว ย่อมเคยได้ ALLOW (<40) มาก่อนเสมอ
//   → การ "อ่านคะแนนเก่าของ user มาเทียบ threshold" จึงผ่านเกือบทุกกรณี = แทบไม่กันอะไรเลย
//
//   ช่องที่ยังเปิดอยู่จริงคือ **ตัวคำขอตอนกดซื้อไม่เคยถูกประเมิน**:
//     - คนเข้าคิวเป็นมนุษย์ แล้วส่ง session/cookie ให้สคริปต์ยิงขั้นซื้อต่อ
//     - สัญญาณ Layer 2 (`BehaviorSession.isLikelyBot`) ที่เพิ่งติดตอนเลือกที่นั่ง ไม่มีใครอ่านซ้ำ
//   ด่านนี้จึงประเมิน "คำขอนี้" ใหม่ ไม่ใช่เอาผลเก่ามาใช้ซ้ำ
//
// ต่างจาก assessRequest() ของด่านคิวตรงไหน:
//   ด่านคิวบังคับ Turnstile (ไม่ส่ง token = +40) แต่ตอนกดซื้อ **ไม่มี token ติดมือมาตั้งแต่แรก**
//   ถ้าใช้กติกาเดียวกันจะบวก 40 ให้ทุกคน = คนจริงโดน CHALLENGE ยกแผงบนเส้นทางเงิน
//   → ที่นี่ "ไม่ส่ง token" = 0 คะแนน (ไม่ใช่ความผิด) · ส่งมาแล้วผ่าน = หลักฐานว่าเป็นคน
import { scoreUserAgent, scoreHeaders, ANTIBOT_CONFIG, type BotAction } from "@/lib/antibot";
import { verifyTurnstile } from "@/lib/turnstile";
import { TURNSTILE_ACTIONS } from "@/lib/turnstile-actions";

export interface PurchaseSignals {
  turnstile: "pass" | "fail" | "dev-pass" | "not-required";
  userAgent: "ok" | "suspicious" | "bot" | "empty";
  headers: "complete" | "incomplete";
  behavior: "ok" | "likely-bot";
  history: "clean" | "recent-block";
}

export interface PurchaseAssessment {
  score: number; // 0-100
  action: BotAction;
  signals: PurchaseSignals;
}

// น้ำหนักของสัญญาณที่ด่านนี้เพิ่มเข้ามาเอง (UA/headers ใช้น้ำหนักเดียวกับด่านคิว)
const BEHAVIOR_LIKELY_BOT_SCORE = 30; // Layer 2 บอกว่า botlike — ยกได้ถึง CHALLENGE แต่ลำพังไม่ถึง BLOCK
const RECENT_BLOCK_SCORE = 45; // เคยโดน BLOCK สด ๆ ในหน้าต่างเวลา — สัญญาณหนัก
const TURNSTILE_FAIL_SCORE = 55; // ส่ง token มาแล้วไม่ผ่าน = แย่กว่าไม่ส่ง

/** หน้าต่างเวลาที่ยังนับ BotEvent เก่าว่า "สด" — เกินนี้ถือว่าคนละเซสชัน ไม่เอามาลงโทษซ้ำ */
export const RECENT_BLOCK_WINDOW_MS = 30 * 60_000; // 30 นาที

/**
 * ประเมินคำขอ "ตอนกดซื้อ" — บริสุทธิ์ ไม่แตะ DB (ผู้เรียกเป็นคนอ่าน DB มาป้อน)
 * แยกแบบนี้เพื่อให้เทสได้ตรง ๆ โดยไม่ต้อง mock Prisma
 */
export async function assessPurchase(params: {
  userAgent: string | null;
  headers: Headers;
  /** token จาก Turnstile — มีเฉพาะตอนผู้ใช้เพิ่งทำ challenge ผ่านหน้า checkout */
  turnstileToken?: string | null;
  ip?: string;
  /** ผลจาก Layer 2 ที่ผู้เรียกอ่านมาจาก BehaviorSession (scope userId แล้ว) */
  behaviorLikelyBot?: boolean;
  /** มี BotEvent action=BLOCK ของ user คนนี้ภายใน RECENT_BLOCK_WINDOW_MS หรือไม่ */
  hasRecentBlock?: boolean;
}): Promise<PurchaseAssessment> {
  let score = 0;

  // --- สัญญาณ 1: Turnstile (ไม่บังคับ) ---
  let turnstileSignal: PurchaseSignals["turnstile"] = "not-required";
  let turnstilePassed = false;
  if (params.turnstileToken) {
    // SECURITY_TODO #2: token ต้องแก้จาก widget ของด่านซื้อ (action) บนโดเมนที่คำขอนี้ยิงมา (Host)
    //   token ที่มนุษย์แก้ให้ที่ด่านคิวแล้วสคริปต์เอามาใช้ตรงนี้ = action-mismatch → นับเป็น "fail" (+55)
    const ts = await verifyTurnstile(params.turnstileToken, params.ip, {
      action: TURNSTILE_ACTIONS.PURCHASE,
      hostname: params.headers.get("host"),
    });
    if (ts.success) {
      turnstileSignal = ts.devMode ? "dev-pass" : "pass";
      turnstilePassed = true;
    } else {
      turnstileSignal = "fail";
      score += TURNSTILE_FAIL_SCORE;
    }
  }

  // --- สัญญาณ 2-3: UA + headers ของคำขอนี้ (น้ำหนักเดียวกับด่านคิว) ---
  const ua = scoreUserAgent(params.userAgent);
  const hdr = scoreHeaders(params.headers);
  score += ua.score + hdr.score;

  // --- สัญญาณ 4: Layer 2 behavior ---
  const behaviorSignal: PurchaseSignals["behavior"] = params.behaviorLikelyBot ? "likely-bot" : "ok";
  if (params.behaviorLikelyBot) score += BEHAVIOR_LIKELY_BOT_SCORE;

  // --- สัญญาณ 5: ประวัติโดน BLOCK สด ๆ ---
  const historySignal: PurchaseSignals["history"] = params.hasRecentBlock ? "recent-block" : "clean";
  if (params.hasRecentBlock) score += RECENT_BLOCK_SCORE;

  score = Math.min(100, Math.max(0, score));

  let action: BotAction;
  if (score >= ANTIBOT_CONFIG.BLOCK_THRESHOLD) action = "BLOCK";
  else if (score >= ANTIBOT_CONFIG.CHALLENGE_THRESHOLD) action = "CHALLENGE";
  else action = "ALLOW";

  // ผ่าน Turnstile สด ๆ = เพิ่งพิสูจน์ว่าเป็นคน → ห้ามเด้ง CHALLENGE ซ้ำ (กันวนลูปไม่จบ
  // แบบเดียวกับที่ด่านคิวเคยเจอ: แก้ challenge ผ่านแล้วยังโดนเด้งเพราะ row เก่าค้าง)
  // แต่ **ไม่ปลด BLOCK** — UA ที่เขียนว่า python-requests ต่อให้ทำ Turnstile ผ่านก็ยังคือสคริปต์
  if (turnstilePassed && action === "CHALLENGE") action = "ALLOW";

  return {
    score,
    action,
    signals: {
      turnstile: turnstileSignal,
      userAgent: ua.label,
      headers: hdr.label,
      behavior: behaviorSignal,
      history: historySignal,
    },
  };
}

export const PURCHASE_ANTIBOT_CONFIG = {
  BEHAVIOR_LIKELY_BOT_SCORE,
  RECENT_BLOCK_SCORE,
  TURNSTILE_FAIL_SCORE,
  RECENT_BLOCK_WINDOW_MS,
};
