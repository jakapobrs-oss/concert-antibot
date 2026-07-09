// ============================================================
// Credentials authentication core (แยกจาก lib/auth.ts เพื่อ unit-test ได้)
// ============================================================
// เดิม logic นี้ inline อยู่ใน Credentials.authorize() ของ NextAuth → เทสยาก
// แยกออกมาเป็นฟังก์ชันบริสุทธิ์ (พึ่ง prisma/rate-limit/argon2 ที่ mock ได้) → พิสูจน์ได้ว่า:
//   F1: บังคับ emailVerified ก่อนให้เข้า (กัน pre-registration + dangerous-link takeover)
//   F3: reset failedLoginCount เมื่อ lock หมดอายุ (กัน perpetual re-lock DoS)
//   F5: unknown user ก็เสียเวลา argon2 เท่าคนจริง (กัน timing enumeration)
import { prisma } from "@/lib/prisma";
import { verifyPassword, hashPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  image?: string;
  role: string;
}

// dummy hash (คำนวณครั้งเดียว cache) — ให้ path "ไม่พบ user" เสียเวลา argon2.verify เท่า path จริง
//   กัน timing side-channel ที่บอกว่า email ไหนมีบัญชี (F5)
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  return (dummyHashPromise ??= hashPassword("__timing_equalizer_dummy_password__"));
}

const LOCK_THRESHOLD = 5; // ผิดรหัสครบเท่านี้ → ล็อก
const LOCK_MS = 15 * 60 * 1000; // ล็อก 15 นาที
const EMAIL_RL = { limit: 10, windowMs: 15 * 60_000 }; // 10 ครั้ง/15นาที ต่อ email (กัน brute-force per account)
const IP_RL = { limit: 30, windowMs: 15 * 60_000 }; // 30 ครั้ง/15นาที ต่อ IP (กัน spray จาก IP เดียว, F4)

export async function authenticateCredentials(input: {
  email: string;
  password: string;
  ip?: string | null;
}): Promise<AuthedUser | null> {
  const { email, password, ip } = input;

  // 1. rate limit ต่อ email — กัน brute-force รหัสของ account เดียว (email ไม่ spoofable เหมือน IP)
  const emailRl = await checkRateLimit({ key: `login:email:${email}`, ...EMAIL_RL });
  if (!emailRl.allowed) return null;

  // 2. rate limit ต่อ IP — กัน password spray (1 รหัส × หลาย email) จาก IP เดียว (F4)
  //    ข้ามถ้าไม่รู้ IP (unknown) — ไม่งั้นทุกคน share key เดียวกัน
  if (ip && ip !== "unknown") {
    const ipRl = await checkRateLimit({ key: `login:ip:${ip}`, ...IP_RL });
    if (!ipRl.allowed) return null;
  }

  // 3. หา user
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    // F5: เสียเวลา argon2 เท่า path จริง (กัน enumeration) — คำตอบเหมือนรหัสผิด
    await verifyPassword(await getDummyHash(), password);
    return null;
  }

  const now = new Date();

  // 4. F3: ถ้าเคยล็อกแต่ครบเวลาแล้ว → เริ่มนับใหม่ (กัน perpetual re-lock)
  //    เดิม: count ค้างที่ >=5 หลังปลดล็อก → ผิดรหัสครั้งเดียวก็ล็อกใหม่ทันที = ล็อกเหยื่อถาวร
  if (user.lockedUntil && user.lockedUntil <= now && user.failedLoginCount > 0) {
    user.failedLoginCount = 0;
  }

  // 5. ยังอยู่ในช่วงล็อก → ปฏิเสธ
  if (user.lockedUntil && user.lockedUntil > now) return null;

  // 6. verify password
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const newCount = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: newCount,
        lockedUntil: newCount >= LOCK_THRESHOLD ? new Date(Date.now() + LOCK_MS) : null,
      },
    });
    return null;
  }

  // 7. รหัสถูก → reset counter + last login (พิสูจน์ตัวตนแล้ว)
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });

  // 8. F1: ต้องยืนยันอีเมลก่อนถึงจะเข้าได้ (กัน pre-registration + dangerous-link takeover)
  //    วางไว้ "หลัง" verify+reset → คนที่รู้รหัสถูก (เจ้าของจริง) เท่านั้นที่จะเจอด่านนี้ = ไม่ leak ว่า email มีบัญชี
  if (!user.emailVerified) return null;

  return {
    id: user.id.toString(),
    email: user.email,
    name: user.name ?? user.email,
    image: user.image ?? undefined,
    role: user.role,
  };
}
