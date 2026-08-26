// Edge middleware — protect /admin/* + /account/*
// ❗ ใช้ authConfig (edge-safe) เท่านั้น — ไม่ import lib/auth.ts ที่ลาก argon2 เข้า Edge runtime
//    NextAuth(authConfig).auth ตรวจ session JWT ได้โดยไม่ต้องมี Credentials provider
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { canonicalHostOf, canonicalRedirect } from "@/lib/canonical-host";

const { auth } = NextAuth(authConfig);

// โฮสต์หลักจาก NEXTAUTH_URL — คำนวณครั้งเดียวตอนโหลด (Edge runtime อ่าน process.env ได้)
const CANONICAL_HOST = canonicalHostOf(process.env.NEXTAUTH_URL);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // 0. production ที่เปิดจาก URL ของ deployment (*.vercel.app ที่ไม่ใช่โฮสต์หลัก) → ส่งไปโฮสต์หลักก่อน
  //    ไม่งั้น cookie ของ Auth.js/Turnstile อยู่คนละโฮสต์กับ callback → Google sign-in ล้มเป็น "Server error"
  //    (2026-08-27 — ดูเหตุผลเต็มใน lib/canonical-host.ts)
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

  // public paths — ไม่ต้อง check
  const publicPaths = ["/", "/login", "/register", "/verify", "/concerts"];
  const isPublic = publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return NextResponse.next();

  // admin paths — ต้อง role = ADMIN
  if (pathname.startsWith("/admin")) {
    if (!isLoggedIn) {
      const url = new URL("/login", req.url);
      url.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(url);
    }
    if (role !== "ADMIN") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  // /account/* — ต้อง login (ไม่ต้อง admin)
  if (pathname.startsWith("/account") && !isLoggedIn) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

// run middleware เฉพาะ path ที่ไม่ใช่ static/api
export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
