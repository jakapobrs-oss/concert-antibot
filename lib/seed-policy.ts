// นโยบายบัญชีตอน seed — pure function ไม่ import env/prisma เพื่อให้ unit test ได้โดยไม่ต้องตั้ง env ครบ
//
// เหตุ (gap map 2026-08-27, Critical): prisma/seed.ts เคยสร้าง admin@local / user@local ด้วยรหัสที่อยู่ในโค้ด
//   และ vercel.json รัน seed "ทุก deploy" (ทั้ง production และ preview ซึ่งใช้ Neon ตัวเดียวกัน)
//   + repo เป็น PUBLIC → ใครอ่านโค้ดก็ล็อกอินเป็นแอดมิน prod ได้
// กติกา:
//   - เครื่อง dev (ไม่มี VERCEL, NODE_ENV ≠ production) → สร้างบัญชีเดโมรหัสสาธารณะได้ตามเดิม (เทส/สคริปต์ใช้ user@local)
//   - deploy ที่โฮสต์ (Vercel ทุก environment หรือ NODE_ENV=production) →
//       (1) ไม่สร้างบัญชีเดโม
//       (2) ล็อกบัญชีเดโมที่เคย seed ไว้ใน DB นี้: passwordHash = null (ล็อกอินด้วยรหัสไม่ได้) + role USER
//           — ไม่ลบแถว เพราะอาจมี order/ticket อ้างถึง (FK) และ lib/admin-guard.ts เช็ค role จาก DB ทุกคำขอ
//           การถอด ADMIN จึงมีผลทันทีแม้ JWT เก่ายังไม่หมดอายุ
//       (3) แอดมินจริงมาจาก env SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD เท่านั้น (ตั้งบน Vercel ไม่ commit)
//           ไม่ตั้ง = ไม่มีแอดมินจาก seed (เตือน) — ไม่ทำให้ build ล้ม เพราะ build ล้มไม่ได้ปิดช่องบน deploy เดิม

export const DEMO_ACCOUNT_EMAILS = ["admin@local", "user@local"] as const;

// ความยาวขั้นต่ำของรหัสแอดมินจาก env — สูงกว่าผู้ใช้ทั่วไป (8) เพราะเป็นบัญชีที่แตะเงิน/ข้อมูลลูกค้า
export const SEED_ADMIN_MIN_PASSWORD_LENGTH = 12;

export type SeedAccountPolicy = {
  // สร้าง admin@local / user@local ด้วยรหัสในโค้ด (เฉพาะเครื่อง dev)
  createDemoAccounts: boolean;
  // อีเมลบัญชีเดโมที่ต้องล็อกถ้ามีอยู่ใน DB (ว่าง = ไม่ล็อก)
  lockEmails: string[];
  // แอดมินจริงจาก env (null = ไม่สร้าง/ไม่อัปเดตแอดมิน)
  adminFromEnv: { email: string; password: string } | null;
  // ข้อความเตือนให้ seed พิมพ์ — ห้ามมีรหัสผ่านปนอยู่
  warnings: string[];
};

// "โฮสต์" = deploy ที่ DB ไม่ใช่ของเล่นในเครื่อง — Vercel ตั้ง VERCEL=1 ทุก environment (production/preview)
// และ preview ใช้ Neon ตัวเดียวกับ production จึงต้องเข้มเท่ากัน · self-host ดูจาก NODE_ENV
export function isHostedDeploy(envLike: {
  VERCEL?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
}): boolean {
  return Boolean(envLike.VERCEL) || Boolean(envLike.VERCEL_ENV) || envLike.NODE_ENV === "production";
}

export function resolveSeedAccountPolicy(input: {
  isHosted: boolean;
  seedAdminEmail?: string;
  seedAdminPassword?: string;
}): SeedAccountPolicy {
  const warnings: string[] = [];
  const email = input.seedAdminEmail?.trim() ?? "";
  const password = input.seedAdminPassword ?? "";

  // แอดมินจาก env — ตรวจให้ครบก่อนใช้ (ตั้งครึ่งเดียว/รหัสสั้น = ไม่สร้าง + บอกเหตุ)
  let adminFromEnv: SeedAccountPolicy["adminFromEnv"] = null;
  if (email || password) {
    if (!email || !email.includes("@")) {
      warnings.push("SEED_ADMIN_EMAIL ว่างหรือไม่ใช่อีเมล → ไม่สร้างแอดมินจาก env");
    } else if (password.length < SEED_ADMIN_MIN_PASSWORD_LENGTH) {
      warnings.push(
        `SEED_ADMIN_PASSWORD สั้นกว่า ${SEED_ADMIN_MIN_PASSWORD_LENGTH} ตัว → ไม่สร้างแอดมินจาก env`,
      );
    } else {
      adminFromEnv = { email, password };
    }
  }

  if (!input.isHosted) {
    // เครื่อง dev: เหมือนเดิมทุกอย่าง (เทสเบราว์เซอร์/สคริปต์พึ่ง user@local) — แอดมินจาก env ใช้ได้ถ้าอยากลอง
    return { createDemoAccounts: true, lockEmails: [], adminFromEnv, warnings };
  }

  // โฮสต์: ห้ามมีบัญชีรหัสสาธารณะ — ล็อกทุกบัญชีเดโม ยกเว้นอีเมลที่ถูกเลือกเป็นแอดมินจริง (รหัสใหม่จาก env)
  const lockEmails = DEMO_ACCOUNT_EMAILS.filter((demo) => demo !== adminFromEnv?.email);
  if (!adminFromEnv) {
    warnings.push(
      "deploy ที่โฮสต์ไม่มี SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD → ไม่มีแอดมินจาก seed " +
        "(บัญชีเดโม admin@local ถูกล็อกแล้ว) — ตั้ง env 2 ตัวนี้บน Vercel แล้ว redeploy",
    );
  }
  return { createDemoAccounts: false, lockEmails, adminFromEnv, warnings };
}
