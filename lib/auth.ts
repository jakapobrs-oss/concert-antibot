// NextAuth v5 (Auth.js) config — Credentials + Google OAuth
// ใช้ JWT strategy เพราะง่ายและไม่ต้อง query DB ทุก request
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";
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
    async authorize(credentials) {
      // 1. validate input shape
      const parsed = loginSchema.safeParse(credentials);
      if (!parsed.success) return null;

      // 2. rate limit ต่อ email — กัน password spray (หลาย account ใช้ <= 5 ครั้ง/account เลี่ยง lockout)
      //    ใช้ key ตาม email ไม่ใช่ IP (IP spoofable, email ไม่) — silent fail = response เหมือนผิดรหัส
      const emailRl = await checkRateLimit({
        key: `login:email:${parsed.data.email}`,
        limit: 10,
        windowMs: 15 * 60_000, // 10 ครั้ง/15 นาที ต่อ email
      });
      if (!emailRl.allowed) return null;

      // 3. หา user
      const user = await prisma.user.findUnique({
        where: { email: parsed.data.email },
      });
      if (!user || !user.passwordHash) return null;

      // 4. เช็ค lock — ถ้า locked อยู่ ห้าม login
      if (user.lockedUntil && user.lockedUntil > new Date()) return null;

      // 5. verify password
      const ok = await verifyPassword(user.passwordHash, parsed.data.password);
      if (!ok) {
        // เพิ่ม failed count — ถ้าผิดเกิน 5 ครั้ง lock 15 นาที
        const newCount = user.failedLoginCount + 1;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: newCount,
            lockedUntil: newCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
          },
        });
        return null;
      }

      // 5. reset failed count + update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      });

      // ส่ง shape ที่ NextAuth ต้องการ — id เป็น string (BigInt → string)
      return {
        id: user.id.toString(),
        email: user.email,
        name: user.name ?? user.email,
        image: user.image ?? undefined,
        role: user.role,
      };
    },
  }),
];

// เพิ่ม Google เฉพาะถ้ามี env
if (isGoogleEnabled) {
  providers.push(
    Google({
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true, // ผูก Google กับ user เดิมที่ email เดียวกัน
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
