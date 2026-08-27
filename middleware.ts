// Edge middleware — protect /admin/* + /staff/* + /account/*
// ❗ ใช้ authConfig (edge-safe) เท่านั้น — ไม่ import lib/auth.ts ที่ลาก argon2 เข้า Edge runtime
//    NextAuth(authConfig).auth ตรวจ session JWT ได้โดยไม่ต้องมี Credentials provider
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { canonicalHostOf, canonicalRedirect } from "@/lib/canonical-host";
import { decideRouteAccess } from "@/lib/route-access";

const { auth } = NextAuth(authConfig);

// โฮสต์หลักจาก NEXTAUTH_URL — คำนวณครั้งเดียวตอนโหลด (Edge runtime อ่าน process.env ได้)
const CANONICAL_HOST = canonicalHostOf(process.env.NEXTAUTH_URL);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // 0. production ที่เปิดจาก URL ของ deployment (*.vercel.app ที่ไม่ใช่โฮสต์หลัก) → ส่งไปโฮสต์หลักก่อน
  //    ไม่งั้น cookie ของ Auth.js/Turnstile อยู่คนละโฮสต์กับ callback → Google sign-in ล้มเป็น "Server error"
  //    (2026-08-27 — ดูเหตุผลเต็มใน lib/canonical-host.ts · /api/* ถูกยกเว้นข้างในฟังก์ชัน เพราะ matcher ด้านล่าง
  //     ตัดแค่ /api/auth — cron /api/cron/sweep และ /api/health ยังผ่าน middleware นี้)
  const canonical = canonicalRedirect({
    host: req.headers.get("host"),
    canonicalHost: CANONICAL_HOST,
    vercelEnv: process.env.VERCEL_ENV,
    pathname,
    search: req.nextUrl.search,
  });
  if (canonical) return NextResponse.redirect(canonical, 308);
  const isLoggedIn = !!req.auth;
  const role = (req.auth?.user as { role?: string } | undefined)?.role;

  // กติกา role ต่อเส้นทางอยู่ใน lib/route-access.ts (pure — มี unit test):
  //   /admin/* = ADMIN · /staff/* = ล็อกอิน (role ตัดสินที่ layout กับ DB) · /account/* = ล็อกอิน · ที่เหลือสาธารณะ (rev 42)
  //   ชั้นนี้อ่าน role จาก JWT (ค้างได้ถึง 30 วัน) — layout + server action เช็ค DB จริงซ้ำอีกชั้น
  const decision = decideRouteAccess({ pathname, isLoggedIn, role });
  if (decision.kind === "login") {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  if (decision.kind === "home") return NextResponse.redirect(new URL("/", req.url));

  return NextResponse.next();
});

// run middleware เฉพาะ path ที่ไม่ใช่ static/api
export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
