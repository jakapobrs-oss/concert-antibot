// Edge middleware — protect /admin/* + /account/*
// ❗ ใช้ authConfig (edge-safe) เท่านั้น — ไม่ import lib/auth.ts ที่ลาก argon2 เข้า Edge runtime
//    NextAuth(authConfig).auth ตรวจ session JWT ได้โดยไม่ต้องมี Credentials provider
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
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
