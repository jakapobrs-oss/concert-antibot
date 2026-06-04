// Prisma client singleton — กัน connection ระเบิดตอน Next dev HMR
// pattern อ้างอิงจาก https://www.prisma.io/docs/orm/more/help-and-troubleshooting/help-articles/nextjs-prisma-client-dev-practices
import { PrismaClient } from "@prisma/client";

// ----------------------------------------------------------------
// BigInt JSON polyfill (root-cause fix)
// ----------------------------------------------------------------
// ทุก PK เป็น BigInt (ตามที่ user ขอ id เป็นตัวเลข) แต่ JSON.stringify ไม่รู้จัก BigInt
// → Next serialize props ข้าม server→client boundary ไม่ได้
// แก้ที่ต้นเหตุ: สอน BigInt ให้ serialize เป็น string (วิธีที่ Prisma docs แนะนำ)
// ไฟล์นี้ถูก import โดยทุก server component ที่ query DB → polyfill รันก่อน render เสมอ
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
