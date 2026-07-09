// NextAuth v5 (Auth.js) config — Credentials + Google OAuth
// ใช้ JWT strategy เพราะง่ายและไม่ต้อง query DB ทุก request
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { authenticateCredentials } from "@/lib/credentials-auth";
import { clientIpFromXff } from "@/lib/get-ip";
import { env, isGoogleEnabled } from "@/lib/env";

// schema validate login input
// หมายเหตุ: ไม่ใช้ .email() เพราะ dev accounts ใช้ "admin@local"/"user@local" (ไม่มี TLD)
// zod .email() จะปฏิเสธ → แค่เช็คว่ามี "@" และความยาวพอ
const loginSchema = z.object({
  email: z.string().min(3).includes("@"),
  password: z.string().min(8),
});

// ประกอบ providers แบบ conditional — ถ้าไม่ตั้ง Google env จะไม่เปิด
const providers: Provider[] = [
  Credentials({
    name: "Email & Password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials, request) {
      // validate input shape แล้วส่งต่อให้ core (แยกไป lib/credentials-auth.ts เพื่อ unit-test)
      const parsed = loginSchema.safeParse(credentials);
      if (!parsed.success) return null;

      // ดึง IP แบบ trusted (hop ขวาสุด) จาก request เพื่อ rate-limit ต่อ IP กัน password spray (F4)
      const ip = clientIpFromXff(request?.headers?.get("x-forwarded-for"));

      return authenticateCredentials({
        email: parsed.data.email,
        password: parsed.data.password,
        ip,
      });
    },
  }),
];

// เพิ่ม Google เฉพาะถ้ามี env
if (isGoogleEnabled) {
  providers.push(
    Google({
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
      // F1 (Codex §4 #1): ปิด auto-link — เดิม true ทำให้ pre-registration takeover ได้
      //   (แอตแทกเกอร์สมัคร email เหยื่อไว้ก่อน → เหยื่อ login Google → auto-link เข้าบัญชีแอตแทกเกอร์ +
      //    การ link ตั้ง emailVerified ให้ → รหัสแอตแทกเกอร์ใช้ได้ทันที = เข้าบัญชีเหยื่อ)
      //   false → Google sign-in ที่ email ชนกับบัญชีเดิมจะ error (OAuthAccountNotLinked) แทน auto-link
      allowDangerousEmailAccountLinking: false,
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // เอา role + id ใส่ JWT เพื่อใช้ใน middleware
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
  secret: env.NEXTAUTH_SECRET,
});
