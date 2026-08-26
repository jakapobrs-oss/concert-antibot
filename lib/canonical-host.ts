// โฮสต์หลัก (canonical host) — pure function, Edge-safe, ไม่ import อะไร (middleware.ts เรียกใช้ + unit test ได้)
//
// เหตุ (2026-08-27): Vercel มี URL หลายแบบชี้ deploy เดียวกัน
//   concert-antibot-<hash>-<team>.vercel.app · concert-antibot-<team>.vercel.app · concert-antibot.vercel.app (หลัก)
//   cookie ของ Auth.js (PKCE / CSRF / session) ผูกกับโฮสต์ที่ผู้ใช้เปิด แต่ Google เด้งกลับมาที่ NEXTAUTH_URL เสมอ
//   → เปิดจาก URL ของ deployment (เช่น ลิงก์ที่ `vercel redeploy` พิมพ์ออกมา) แล้วกด Google
//     = "InvalidCheck: pkceCodeVerifier value could not be parsed" → หน้า "Server error … server configuration"
//   Turnstile ก็ผูก hostname กับโฮสต์หลักเช่นกัน (เข้าคิวจากโฮสต์อื่นจะถูกปฏิเสธ)
// ทางแก้ที่ต้นทาง: production ที่เปิดจากโฮสต์ *.vercel.app ที่ไม่ใช่โฮสต์หลัก → 308 ไปโฮสต์หลัก path/query เดิม
//
// กติกาที่ตั้งใจ:
//   - เฉพาะ VERCEL_ENV=production — preview/dev ปล่อยตามเดิม (NEXTAUTH_URL ของ preview อาจตั้งใจไม่ตรงโฮสต์)
//   - เฉพาะโฮสต์ *.vercel.app — custom domain ในอนาคตไม่แตะ (กัน redirect วนถ้า NEXTAUTH_URL ยังชี้ vercel.app)
//   - ไม่ยุ่ง /api/* (เช็คในฟังก์ชันนี้เอง — matcher ของ middleware ตัดแค่ /api/auth ไม่ใช่ /api ทั้งหมด (rev 36 แก้จาก rev 33
//     ที่เข้าใจผิด) · cron ของ Vercel + monitor ยิง /api/* ตรง ๆ ไม่มี cookie ให้ต้องย้ายโฮสต์ และ 308 อาจทำ cron ล้ม)

export function canonicalHostOf(nextAuthUrl: string | null | undefined): string | null {
  if (!nextAuthUrl) return null;
  try {
    return new URL(nextAuthUrl).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function canonicalRedirect(input: {
  host: string | null | undefined; // Host header ของคำขอ
  canonicalHost: string | null | undefined; // จาก canonicalHostOf(NEXTAUTH_URL)
  vercelEnv: string | undefined; // process.env.VERCEL_ENV
  pathname: string;
  search: string; // รวม "?" หรือ "" (req.nextUrl.search)
}): string | null {
  const { host, canonicalHost, vercelEnv, pathname, search } = input;
  if (vercelEnv !== "production") return null;
  if (pathname.startsWith("/api/")) return null; // API/cron/health: ไม่มี cookie ให้ผูกโฮสต์ และ client อาจไม่ตาม 308
  if (!host || !canonicalHost) return null;
  const h = host.toLowerCase();
  if (h === canonicalHost) return null;
  if (!h.endsWith(".vercel.app")) return null;
  return `https://${canonicalHost}${pathname}${search}`;
}
