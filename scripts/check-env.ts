// ============================================================
// .env Validator — ตรวจว่า env ของ concert-antibot "ใช้งานได้จริงทุกตัว"
// ============================================================
// 3 ชั้น: (1) presence มีครบ/ไม่พึ่ง insecure-default  (2) format รูปแบบถูก (zod)
//         (3) functional ยิงจริง read-only พิสูจน์ว่า key/connection ใช้ได้
// 2 โหมด: --env dev|prod  (default อ่านจาก NODE_ENV ในไฟล์) — prod เกณฑ์เข้มกว่า
// side-effect: read-only ล้วน — EasySlip/Google ที่ตรวจ auto ไม่ได้ = MANUAL
// gate: FAIL → exit 1 (บล็อก CI) · WARN/MANUAL → โชว์เฉยๆ
//
// รัน:  pnpm check:env -- --env dev        หรือ   npx tsx scripts/check-env.ts --env prod
// flags: --env dev|prod · --no-live (ข้าม probe สำหรับ CI offline) · --json · --file <path>
//
// หมายเหตุความปลอดภัย: อ่านไฟล์ .env โดยตรง (รู้ว่ามีอะไร "ในไฟล์" จริง ไม่ใช่ process.env ที่ merge default)
//   · ไม่พิมพ์ค่า secret (mask เสมอ) · ยิง probe ไปที่ provider เจ้าของ key เท่านั้น (ไม่ส่งออกที่อื่น)
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { envSchema } from "../lib/env-schema";

type Mode = "dev" | "prod";
type Status = "PASS" | "WARN" | "FAIL" | "MANUAL";
interface Check {
  group: string;
  key: string;
  status: Status;
  level: string; // presence | format | functional
  reason: string;
}
interface ProbeResult {
  result: "ok" | "bad" | "unreachable";
  detail: string;
  domains?: string[]; // เฉพาะ Resend — เก็บ verified domains ไว้เช็ค EMAIL_FROM
}

// ---------- args ----------
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const getOpt = (name: string, def?: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const noLive = has("--no-live");
const asJson = has("--json");
const filePath = getOpt("--file", ".env")!;

// ---------- อ่าน .env ไฟล์ตรงๆ (ไม่พึ่ง process.env) ----------
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const root = process.cwd();
const fileVars = parseEnvFile(resolve(root, filePath));
const exampleVars = parseEnvFile(resolve(root, ".env.example"));

if (Object.keys(fileVars).length === 0) {
  console.error(`❌ อ่าน env ไม่ได้หรือว่างเปล่า: ${resolve(root, filePath)}`);
  process.exit(2);
}

// ---------- mode ----------
const modeArg = getOpt("--env") as Mode | undefined;
const mode: Mode =
  modeArg ?? (fileVars.NODE_ENV === "production" ? "prod" : "dev");
const isProd = mode === "prod";

// ---------- ค่าคงที่จัดหมวด/เกณฑ์ ----------
const shape = envSchema.shape as Record<string, z.ZodTypeAny>;

const GROUP: Record<string, string> = {
  DATABASE_URL: "Infra",
  REDIS_URL: "Infra",
  NEXTAUTH_SECRET: "Auth",
  NEXTAUTH_URL: "Auth",
  GOOGLE_CLIENT_ID: "Auth",
  GOOGLE_CLIENT_SECRET: "Auth",
  TURNSTILE_SITE_KEY: "Anti-bot",
  TURNSTILE_SECRET_KEY: "Anti-bot",
  GEMINI_API_KEY: "Anti-bot",
  QUEUE_SCORE_SECRET: "Anti-bot",
  QUEUE_BATCH_SIZE: "Anti-bot",
  SEAT_HOLD_TTL_SECONDS: "Anti-bot",
  BOT_SCORE_THRESHOLD: "Anti-bot",
  RESEND_API_KEY: "Email",
  EMAIL_FROM: "Email",
  PROMPTPAY_ID: "Payment",
  EASYSLIP_API_KEY: "Payment",
  PAYMENTS_RECEIVER_CHECK: "Payment",
  PAYMENTS_FRESHNESS_CHECK: "Payment",
  PER_PAYER_TICKET_LIMIT: "Payment",
  NODE_ENV: "App",
  APP_NAME: "App",
  APP_CURRENCY: "App",
};

// secret keys — ห้ามพิมพ์ค่าจริง
const SECRET = new Set([
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "TURNSTILE_SECRET_KEY",
  "RESEND_API_KEY",
  "EASYSLIP_API_KEY",
  "GEMINI_API_KEY",
  "QUEUE_SCORE_SECRET",
  "POSTGRES_PASSWORD",
  "MINIO_ROOT_PASSWORD",
]);

// infra vars (จาก docker-compose ไม่อยู่ใน schema แอป)
const INFRA_KNOWN = [
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "MINIO_ENDPOINT",
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD",
  "MINIO_BUCKET",
];
// config ที่อยู่ใน .env แต่ไม่มีใครอ่าน (dead/drift)
const DEAD_KEYS = ["APP_TIMEZONE", "QUEUE_BATCH_WINDOW_MS"];

const UNFILLED = ["REPLACE_WITH"]; // template ที่ยังไม่กรอก = พังทุกโหมด
const DEV_PLACEHOLDERS = [
  "dev_only_change_me",
  "minioadmin_change_me",
  "insecure-default-change-in-production",
]; // ตั้งใจบน dev, ห้ามหลุดไป prod
const PROD_BAD_EMAIL = ["onboarding@resend.dev", "noreply@localhost"];

// ขาดบน prod = แอป fail-closed (FAIL); dev ใช้ mock/test ได้ (PASS)
const PROD_FAIL_MISSING: Record<string, string> = {
  EASYSLIP_API_KEY: "ปฏิเสธการจ่ายทั้งหมด (payment fail-closed)",
  PROMPTPAY_ID: "สร้าง QR/ตรวจบัญชีผู้รับไม่ได้",
  TURNSTILE_SITE_KEY: "CAPTCHA fail-closed → บล็อกผู้ใช้ทุกคน (H1)",
  TURNSTILE_SECRET_KEY: "CAPTCHA fail-closed → บล็อกผู้ใช้ทุกคน (H1)",
};
// ขาดบน prod = ฟีเจอร์ degrade (WARN ไม่บล็อก)
const PROD_WARN_MISSING: Record<string, string> = {
  RESEND_API_KEY: "อีเมลยืนยันจะไม่ถูกส่ง (signup degrade)",
  GOOGLE_CLIENT_ID: "ปุ่ม Google login ปิด",
  GOOGLE_CLIENT_SECRET: "ปุ่ม Google login ปิด",
  GEMINI_API_KEY: "ฟีเจอร์ AI ปิด",
};

// ---------- helpers ----------
function maskVal(v?: string): string {
  if (!v) return "(unset)";
  if (v.length <= 6) return "***";
  return v.slice(0, 2) + "…" + v.slice(-2);
}
function preview(key: string, v?: string): string {
  if (v === undefined || v === "") return "(unset)";
  return SECRET.has(key) ? maskVal(v) : v.length > 40 ? v.slice(0, 38) + "…" : v;
}
function fieldInfo(field: z.ZodTypeAny): { required: boolean; def: unknown } {
  const u = field.safeParse(undefined);
  return { required: !u.success, def: u.success ? u.data : undefined };
}

// ---------- functional probes (read-only) ----------
const TIMEOUT_MS = 8000;

async function probeDb(url: string): Promise<ProbeResult> {
  try {
    const { PrismaClient } = (await import("@prisma/client")) as {
      PrismaClient: new (o?: unknown) => {
        $queryRaw: (q: TemplateStringsArray) => Promise<unknown>;
        $disconnect: () => Promise<void>;
      };
    };
    const p = new PrismaClient({ datasources: { db: { url } } });
    try {
      await p.$queryRaw`SELECT 1`;
      return { result: "ok", detail: "connect + SELECT 1 ผ่าน" };
    } finally {
      await p.$disconnect();
    }
  } catch (e) {
    return {
      result: "unreachable",
      detail: `ต่อ DB ไม่ได้: ${(e as Error).message.split("\n")[0]}`,
    };
  }
}

async function probeRedis(url: string): Promise<ProbeResult> {
  try {
    const IORedis = ((await import("ioredis")) as { default: new (u: string, o?: unknown) => {
      connect: () => Promise<void>;
      ping: () => Promise<string>;
      disconnect: () => void;
      on: (event: string, cb: (...a: unknown[]) => void) => void;
    } }).default;
    const r = new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      retryStrategy: () => null,
    });
    r.on("error", () => {}); // กลืน error event (จัดการผ่าน try/catch ด้านล่างแล้ว) ไม่ให้พ่น noise
    try {
      await r.connect();
      const pong = await r.ping();
      return { result: pong === "PONG" ? "ok" : "bad", detail: `PING → ${pong}` };
    } finally {
      r.disconnect();
    }
  } catch (e) {
    return {
      result: "unreachable",
      detail: `ต่อ Redis ไม่ได้: ${(e as Error).message.split("\n")[0]}`,
    };
  }
}

async function probeResend(key: string): Promise<ProbeResult> {
  try {
    const r = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.status === 200) {
      const j = (await r.json().catch(() => null)) as { data?: { name: string }[] } | null;
      const domains = (j?.data ?? []).map((d) => d.name);
      return {
        result: "ok",
        detail: `key ใช้ได้ (verified domains: ${domains.join(", ") || "—"})`,
        domains,
      };
    }
    if (r.status === 401 || r.status === 403) {
      // 401 ไม่ได้แปลว่า key เสียเสมอ — key แบบ "sending-only" จะโดน 401 ตอนเรียก /domains
      //   แต่ส่งเมลได้จริง (ซึ่งคือสิ่งเดียวที่แอปนี้ต้องใช้) → ถือว่า usable
      const j = (await r.json().catch(() => null)) as
        | { name?: string; message?: string }
        | null;
      if (j?.name === "restricted_api_key")
        return {
          result: "ok",
          detail: "key ใช้ได้ (sending-only — /domains ปิด, verify โดเมนด้วยมือ)",
        };
      return {
        result: "bad",
        detail: `key ใช้ไม่ได้ (HTTP ${r.status}: ${j?.message ?? "invalid"})`,
      };
    }
    return { result: "unreachable", detail: `ตอบไม่คาดคิด HTTP ${r.status}` };
  } catch (e) {
    return { result: "unreachable", detail: `ต่อ Resend ไม่ได้: ${(e as Error).message}` };
  }
}

async function probeTurnstile(secret: string): Promise<ProbeResult> {
  try {
    const body = new URLSearchParams({ secret, response: "dummy-validation-token" });
    const r = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    const j = (await r.json().catch(() => null)) as { "error-codes"?: string[] } | null;
    const codes = j?.["error-codes"] ?? [];
    if (codes.includes("invalid-input-secret"))
      return { result: "bad", detail: "secret key ใช้ไม่ได้ (invalid-input-secret)" };
    // secret ดี — โดนปฏิเสธเพราะ token ปลอม (คาดไว้)
    return {
      result: "ok",
      detail: `secret key ใช้ได้ (ปฏิเสธ dummy token ตามคาด: ${codes.join(",") || "ok"})`,
    };
  } catch (e) {
    return { result: "unreachable", detail: `ต่อ Turnstile ไม่ได้: ${(e as Error).message}` };
  }
}

async function probeGemini(key: string): Promise<ProbeResult> {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (r.status === 200) return { result: "ok", detail: "key ใช้ได้ (list models ผ่าน)" };
    if (r.status === 400 || r.status === 403)
      return { result: "bad", detail: `key ใช้ไม่ได้ (HTTP ${r.status})` };
    return { result: "unreachable", detail: `ตอบไม่คาดคิด HTTP ${r.status}` };
  } catch (e) {
    return { result: "unreachable", detail: `ต่อ Gemini ไม่ได้: ${(e as Error).message}` };
  }
}

async function probePromptPay(id: string): Promise<ProbeResult> {
  try {
    const mod = (await import("promptpay-qr")) as unknown as {
      default?: (id: string, o?: { amount?: number }) => string;
    };
    const gen = mod.default ?? (mod as unknown as (id: string, o?: { amount?: number }) => string);
    const payload = gen(id, { amount: 1 });
    return typeof payload === "string" && payload.length > 0
      ? { result: "ok", detail: "สร้าง QR payload ได้ (id ถูกต้อง)" }
      : { result: "bad", detail: "สร้าง QR ไม่ได้" };
  } catch (e) {
    return { result: "bad", detail: `PROMPTPAY_ID สร้าง QR ไม่ได้: ${(e as Error).message}` };
  }
}

// ---------- run probes (read-only, parallel) ----------
const probes: Record<string, ProbeResult> = {};
async function runProbes() {
  if (noLive) return;
  const tasks: Promise<void>[] = [];
  const set = (k: string, p: Promise<ProbeResult>) =>
    tasks.push(p.then((r) => void (probes[k] = r)));

  if (fileVars.DATABASE_URL) set("DATABASE_URL", probeDb(fileVars.DATABASE_URL));
  set("REDIS_URL", probeRedis(fileVars.REDIS_URL || "redis://localhost:6379"));
  if (fileVars.TURNSTILE_SECRET_KEY)
    set("TURNSTILE_SECRET_KEY", probeTurnstile(fileVars.TURNSTILE_SECRET_KEY));
  if (fileVars.RESEND_API_KEY) set("RESEND_API_KEY", probeResend(fileVars.RESEND_API_KEY));
  if (fileVars.GEMINI_API_KEY) set("GEMINI_API_KEY", probeGemini(fileVars.GEMINI_API_KEY));
  if (fileVars.PROMPTPAY_ID) set("PROMPTPAY_ID", probePromptPay(fileVars.PROMPTPAY_ID));

  await Promise.all(tasks);
}

// ---------- classify (schema keys) ----------
function classifySchemaKey(key: string): Check {
  const group = GROUP[key] ?? "App";
  const field = shape[key];
  const info = fieldInfo(field);
  const present = key in fileVars && fileVars[key] !== "";
  const val = fileVars[key];
  const mk = (status: Status, level: string, reason: string): Check => ({
    group,
    key,
    status,
    level,
    reason,
  });

  // ---- ไม่มีในไฟล์ ----
  if (!present) {
    if (info.required) return mk("FAIL", "presence", "ขาด (required ไม่มี default)");
    if (key === "NODE_ENV" && isProd)
      return mk("FAIL", "presence", "ต้องตั้ง NODE_ENV=production บน prod");
    if (key === "QUEUE_SCORE_SECRET")
      return isProd
        ? mk("FAIL", "presence", "ขาด → ใช้ default ที่ไม่ปลอดภัย → anti-reroll พัง")
        : mk("WARN", "presence", "ขาด → ใช้ default insecure (ok บน dev, ตั้งก่อน prod)");
    if (PROD_FAIL_MISSING[key])
      return isProd
        ? mk("FAIL", "presence", `ขาด → ${PROD_FAIL_MISSING[key]}`)
        : mk("PASS", "presence", "ไม่ตั้ง (dev ใช้ mock/test ได้)");
    if (PROD_WARN_MISSING[key])
      return isProd
        ? mk("WARN", "presence", `ขาด → ${PROD_WARN_MISSING[key]}`)
        : mk("PASS", "presence", "ไม่ตั้ง (optional)");
    if (key === "REDIS_URL" && isProd)
      return mk("WARN", "presence", "ไม่ตั้ง → ใช้ default localhost (prod แน่ใจว่า redis อยู่ที่ localhost?)");
    return mk(
      "PASS",
      "presence",
      `ไม่ตั้ง → ใช้ default${info.def !== undefined ? ` (${String(info.def)})` : ""}`
    );
  }

  // ---- มีในไฟล์: เช็ค format ก่อน ----
  const fmt = field.safeParse(val);
  if (!fmt.success)
    return mk("FAIL", "format", `รูปแบบผิด: ${fmt.error.issues[0]?.message ?? "invalid"}`);

  if (UNFILLED.some((p) => val.includes(p)))
    return mk("FAIL", "format", "ยังเป็น template ที่ไม่ได้กรอก (REPLACE_WITH…)");

  if (DEV_PLACEHOLDERS.some((p) => val.includes(p))) {
    if (isProd) return mk("FAIL", "format", `ค่า dev/placeholder หลุดมา prod (${preview(key, val)})`);
    if (key === "QUEUE_SCORE_SECRET")
      return mk("WARN", "format", "ใช้ค่า insecure default (ตั้งจริงก่อน prod)");
    // ถ้ามี functional probe (เช่น DATABASE_URL) ปล่อยให้ส่วนล่างรายงาน connectivity แทน
    //   ค่า dev ปกติบน dev อยู่แล้ว — แต่ยังอยากเห็นว่าต่อติดไหม
    if (!probes[key]) return mk("PASS", "format", "ค่า dev (ปกติบน dev)");
  }

  // key-specific (appropriateness)
  if (key === "NODE_ENV" && isProd && val !== "production")
    return mk("FAIL", "format", `prod ต้อง NODE_ENV=production (พบ "${val}")`);
  if (
    key === "NEXTAUTH_URL" &&
    isProd &&
    (/localhost|127\.0\.0\.1/.test(val) || val.startsWith("http://"))
  )
    return mk("FAIL", "format", "prod ต้องเป็น https://<domain> ไม่ใช่ localhost/http");
  if (key === "NEXTAUTH_SECRET" && val.length < 32)
    return mk("FAIL", "format", "สั้นเกินไป (<32)");
  if (key === "APP_CURRENCY" && val !== "THB")
    return mk("WARN", "format", `ปกติ THB (พบ "${val}")`);
  if (key === "BOT_SCORE_THRESHOLD")
    return mk("WARN", "format", "dead config — engine ฮาร์ดโค้ด 40/70 ไม่อ่านค่านี้ (N8)");
  if (key === "EMAIL_FROM" && isProd) {
    if (PROD_BAD_EMAIL.includes(val))
      return mk("WARN", "format", "โดเมนทดสอบ/ภายใน — เมล prod อาจส่งไม่ออก");
    const domain = val.split("@")[1];
    const rd = probes.RESEND_API_KEY;
    if (rd?.domains && domain && !rd.domains.includes(domain))
      return mk("WARN", "format", `โดเมน "${domain}" ยังไม่ verified ใน Resend`);
  }

  // MANUAL (ตรวจ auto ไม่ได้ตามนโยบาย side-effect)
  if (key === "EASYSLIP_API_KEY")
    return mk(
      "MANUAL",
      "format",
      "format ✓ — ยืนยัน auto ไม่ได้ (กิน quota): submit สลิปจริง 1 ใบใน staging"
    );
  if (key === "GOOGLE_CLIENT_ID" || key === "GOOGLE_CLIENT_SECRET")
    return mk("MANUAL", "format", "format ✓ — ยืนยันด้วยการ login ผ่านปุ่ม Google 1 ครั้ง");

  // functional probe
  const probe = probes[key];
  if (probe) {
    if (probe.result === "ok") return mk("PASS", "functional", probe.detail);
    if (probe.result === "bad") return mk("FAIL", "functional", probe.detail);
    return isProd
      ? mk("FAIL", "functional", probe.detail)
      : mk("WARN", "functional", `${probe.detail} (dev: บริการอาจไม่ได้รัน)`);
  }

  return mk("PASS", "format", "ค่าถูกต้อง");
}

// ---------- classify (infra + drift) ----------
function classifyInfraAndDrift(): Check[] {
  const out: Check[] = [];
  const mk = (
    group: string,
    key: string,
    status: Status,
    level: string,
    reason: string
  ): Check => ({ group, key, status, level, reason });

  // infra vars (POSTGRES_* / MINIO_*)
  for (const key of INFRA_KNOWN) {
    const present = key in fileVars && fileVars[key] !== "";
    const val = fileVars[key];
    if (!present) {
      out.push(mk("Infra", key, "WARN", "presence", "ไม่ตั้ง (infra/compose ต้องใช้)"));
      continue;
    }
    if (key.startsWith("MINIO_")) {
      if (key === "MINIO_ROOT_PASSWORD" && isProd && val.includes("change_me"))
        out.push(mk("Infra", key, "WARN", "format", "default password (MinIO แอปยังไม่ใช้ — ไม่ critical)"));
      else
        out.push(mk("Infra", key, "WARN", "presence", "infra — แอปยังไม่เรียกใช้ MinIO (ไม่ critical)"));
      continue;
    }
    // POSTGRES_*
    if (key === "POSTGRES_PASSWORD" && val.includes("change_me"))
      out.push(
        isProd
          ? mk("Infra", key, "FAIL", "format", "default password บน prod")
          : mk("Infra", key, "PASS", "format", "ค่า dev (ปกติบน dev)")
      );
    else out.push(mk("Infra", key, "PASS", "presence", "ตั้งค่าแล้ว"));
  }

  // DATABASE_URL ↔ POSTGRES_* consistency
  if (fileVars.DATABASE_URL) {
    try {
      const u = new URL(fileVars.DATABASE_URL);
      const dbName = u.pathname.replace(/^\//, "").split("?")[0];
      const mismatch: string[] = [];
      if (fileVars.POSTGRES_USER && decodeURIComponent(u.username) !== fileVars.POSTGRES_USER)
        mismatch.push("user");
      if (fileVars.POSTGRES_PASSWORD && decodeURIComponent(u.password) !== fileVars.POSTGRES_PASSWORD)
        mismatch.push("password");
      if (fileVars.POSTGRES_DB && dbName !== fileVars.POSTGRES_DB) mismatch.push("dbname");
      if (mismatch.length)
        out.push(
          mk(
            "Infra",
            "DATABASE_URL↔POSTGRES_*",
            isProd ? "FAIL" : "WARN",
            "format",
            `ไม่ตรงกัน: ${mismatch.join(", ")} (connection string กับ container creds ต่างกัน)`
          )
        );
      else
        out.push(mk("Infra", "DATABASE_URL↔POSTGRES_*", "PASS", "format", "user/password/dbname ตรงกัน"));
    } catch {
      /* DATABASE_URL จะถูก flag เรื่อง format ในส่วน schema อยู่แล้ว */
    }
  }

  // dead config ที่อยู่ในไฟล์
  for (const key of DEAD_KEYS) {
    if (key in fileVars)
      out.push(mk("App", key, "WARN", "presence", "อยู่ใน .env แต่ไม่มีโค้ดไหนอ่าน (dead/drift)"));
  }

  // unknown vars (ไม่อยู่ใน schema/infra/dead)
  const known = new Set([...Object.keys(shape), ...INFRA_KNOWN, ...DEAD_KEYS]);
  for (const key of Object.keys(fileVars)) {
    if (!known.has(key))
      out.push(mk("App", key, "WARN", "presence", "ตัวแปรที่ไม่รู้จัก (ไม่อยู่ใน schema/compose)"));
  }

  // .env.example stale — schema/infra ที่ขาดจาก example
  const exampleKeys = new Set(Object.keys(exampleVars));
  const missingFromExample = [...Object.keys(shape), ...INFRA_KNOWN].filter(
    (k) => !exampleKeys.has(k)
  );
  if (missingFromExample.length)
    out.push(
      mk(
        "Drift",
        ".env.example",
        "WARN",
        "presence",
        `template ขาด: ${missingFromExample.join(", ")}`
      )
    );

  return out;
}

// ---------- main ----------
async function main() {
  await runProbes();

  const checks: Check[] = Object.keys(shape).map(classifySchemaKey);

  // half-config Google (ตั้งมาแค่ตัวเดียว)
  const gid = "GOOGLE_CLIENT_ID" in fileVars && fileVars.GOOGLE_CLIENT_ID !== "";
  const gsec = "GOOGLE_CLIENT_SECRET" in fileVars && fileVars.GOOGLE_CLIENT_SECRET !== "";
  if (gid !== gsec) {
    for (const c of checks)
      if (c.key === "GOOGLE_CLIENT_ID" || c.key === "GOOGLE_CLIENT_SECRET") {
        c.status = "FAIL";
        c.level = "presence";
        c.reason = "ตั้งมาไม่ครบคู่ (ต้องมีทั้ง CLIENT_ID และ CLIENT_SECRET)";
      }
  }

  const all = [...checks, ...classifyInfraAndDrift()];

  const counts = {
    PASS: all.filter((c) => c.status === "PASS").length,
    WARN: all.filter((c) => c.status === "WARN").length,
    FAIL: all.filter((c) => c.status === "FAIL").length,
    MANUAL: all.filter((c) => c.status === "MANUAL").length,
  };
  const exitCode = counts.FAIL > 0 ? 1 : 0;

  if (asJson) {
    console.log(JSON.stringify({ mode, counts, exitCode, checks: all }, null, 2));
    process.exit(exitCode);
  }

  // ---- pretty print ----
  const ICON: Record<Status, string> = { PASS: "✅", WARN: "⚠️ ", FAIL: "❌", MANUAL: "🔎" };
  const ORDER = ["Infra", "Auth", "Anti-bot", "Email", "Payment", "App", "Drift"];
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  .env Validator — concert-antibot   [mode: ${mode}]${noLive ? "  (--no-live)" : ""}`);
  console.log(`  ไฟล์: ${resolve(root, filePath)}`);
  console.log("═══════════════════════════════════════════════════════════");

  for (const g of ORDER) {
    const rows = all.filter((c) => c.group === g);
    if (!rows.length) continue;
    console.log(`\n▌ ${g}`);
    for (const c of rows) {
      const val = preview(c.key, fileVars[c.key]);
      console.log(
        `  ${ICON[c.status]} ${c.key.padEnd(26)} ${`[${c.level}]`.padEnd(12)} ${c.reason}`
      );
      if (c.status !== "PASS" && fileVars[c.key] !== undefined)
        console.log(`     └ ค่า: ${val}`);
    }
  }

  console.log("\n───────────────────────────────────────────────────────────");
  console.log(
    `  สรุป: ✅ ${counts.PASS} PASS · ⚠️  ${counts.WARN} WARN · ❌ ${counts.FAIL} FAIL · 🔎 ${counts.MANUAL} MANUAL`
  );

  if (counts.MANUAL > 0) {
    console.log("\n🔎 ต้องตรวจมือ (auto ตรวจไม่ได้ — นโยบาย read-only):");
    for (const c of all.filter((c) => c.status === "MANUAL"))
      console.log(`   • ${c.key}: ${c.reason}`);
  }

  if (counts.FAIL > 0) {
    console.log("\n❌ FAIL ที่ต้องแก้ก่อน deploy:");
    for (const c of all.filter((c) => c.status === "FAIL"))
      console.log(`   • ${c.key}: ${c.reason}`);
  }

  console.log(
    `\n  go-live readiness (${mode}): ${
      exitCode === 0 ? "✅ ผ่าน (ไม่มี FAIL)" : `❌ ยังไม่พร้อม — มี ${counts.FAIL} FAIL`
    }`
  );
  if (mode === "dev")
    console.log("  💡 ลองรัน `--env prod` เพื่อดูรายการที่ต้องเคลียร์ก่อน go-live");
  console.log("");

  process.exit(exitCode);
}

main().catch((e) => {
  console.error("[check-env] ล้มเหลว:", e);
  process.exit(2);
});
