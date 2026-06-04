// Edge-safe auth config — ใช้ใน middleware (Edge runtime)
// ❗ ห้าม import argon2 / prisma / node:crypto ที่นี่ — middleware รันบน Edge ไม่รองรับ
// providers ที่ใช้ argon2 (Credentials) + PrismaAdapter จะถูกเพิ่มใน lib/auth.ts (Node runtime)
import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  // secret ต้องอ่านตรงจาก process.env (Edge runtime — ห้าม import lib/env ที่ใช้ zod/node)
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [], // เติมใน lib/auth.ts — ที่นี่ว่างไว้เพื่อให้ middleware import ได้โดยไม่ลาก argon2
  callbacks: {
    // ใส่ id + role ลง token
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role?: string }).role ?? "USER";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
};
