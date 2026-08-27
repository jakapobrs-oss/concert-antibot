// ============================================================
// กติกาการเข้าถึงเส้นทาง (pure) — ใช้โดย middleware.ts (Edge) และ unit test
// ============================================================
// แยกออกมาเป็น pure function เพราะ middleware ทดสอบตรง ๆ ยาก (ต้อง mock NextAuth/NextRequest)
// และกติกา role ตอนนี้มี 3 ระดับ (USER / STAFF / ADMIN) — ผิดพลาดแล้วเท่ากับเปิดหน้าแอดมินให้คนนอก
//
// ⚠️ นี่คือชั้นแรกเท่านั้น (อ่าน role จาก JWT ซึ่งค้างได้ถึง 30 วัน) — ชั้นที่ตัดสินจริงคือ
//   layout ของ (admin)/(staff) + server action ที่ re-check role กับ DB ผ่าน lib/admin-guard.ts
//   ห้ามเอากฎที่นี่ไปแทนการเช็ค DB
// ⚠️ ห้าม import อะไรที่ไม่ใช่ Edge-safe (prisma/argon2/node:*) — ไฟล์นี้ถูก bundle เข้า middleware

export type RouteDecision =
  | { kind: "next" } // ปล่อยผ่าน
  | { kind: "login" } // ยังไม่ล็อกอิน → ไป /login?callbackUrl=<pathname>
  | { kind: "home" }; // ล็อกอินแล้วแต่ role ไม่ถึง → เด้งหน้าแรก

// path สาธารณะ — ไม่ต้องเช็คอะไร (ตรงตัว หรือขึ้นต้นด้วย path นั้น + "/")
const PUBLIC_PATHS = ["/", "/login", "/register", "/verify", "/concerts"] as const;

const ADMIN_ROLES: readonly string[] = ["ADMIN"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function decideRouteAccess(input: {
  pathname: string;
  isLoggedIn: boolean;
  role: string | undefined;
}): RouteDecision {
  const { pathname, isLoggedIn, role } = input;

  if (isPublicPath(pathname)) return { kind: "next" };

  // /admin/* — ADMIN เท่านั้น (STAFF ก็ไม่ได้ — เจ้าหน้าที่ต้องไม่เห็นรายได้/คิว/บอทล็อก)
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!isLoggedIn) return { kind: "login" };
    return ADMIN_ROLES.includes(role ?? "") ? { kind: "next" } : { kind: "home" };
  }

  // /staff/* — จุดสแกนเช็คอิน: ชั้นนี้ขอแค่ "ล็อกอิน" แล้วให้ (staff)/layout.tsx ตัดสิน role กับ DB
  //   ทำไมไม่เช็ค role ที่นี่: role ใน JWT ค้างตั้งแต่ตอนล็อกอิน — เจ้าหน้าที่ที่เพิ่งถูกแต่งตั้งจะโดนเด้ง
  //   ทั้งที่ DB เป็น STAFF แล้ว ต้องออกจากระบบแล้วเข้าใหม่ถึงจะใช้ได้ (งานหน้างานรีบ ไม่ควรต้องทำแบบนั้น)
  //   ความปลอดภัยไม่ลด: layout เช็ค DB ทุกครั้ง USER เข้าไปก็ถูกเด้งก่อน render อยู่ดี
  if (pathname === "/staff" || pathname.startsWith("/staff/")) {
    return isLoggedIn ? { kind: "next" } : { kind: "login" };
  }

  // /account/* — แค่ล็อกอิน (ไม่ต้องมี role)
  if (pathname === "/account" || pathname.startsWith("/account/")) {
    return isLoggedIn ? { kind: "next" } : { kind: "login" };
  }

  return { kind: "next" };
}
