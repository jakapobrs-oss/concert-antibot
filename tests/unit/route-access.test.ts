// Unit tests — กติกาการเข้าถึงเส้นทางของ middleware (rev 42: เพิ่ม role STAFF + /staff/*)
// พิสูจน์: STAFF เข้า /staff ได้แต่ /admin ไม่ได้ · USER เข้าทั้งสองไม่ได้ · ยังไม่ล็อกอิน → login · สาธารณะผ่านหมด
import { describe, it, expect } from "vitest";
import { decideRouteAccess, isPublicPath } from "@/lib/route-access";

const anon = { isLoggedIn: false, role: undefined };
const user = { isLoggedIn: true, role: "USER" };
const staff = { isLoggedIn: true, role: "STAFF" };
const admin = { isLoggedIn: true, role: "ADMIN" };

describe("isPublicPath", () => {
  it("หน้าแรก/รายการคอน/หน้าคอน/login/register/verify เป็นสาธารณะ", () => {
    for (const p of ["/", "/concerts", "/concerts/bts-2026", "/login", "/register", "/verify", "/verify/resend"]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it("path ที่แค่ขึ้นต้นคล้ายกันไม่นับเป็นสาธารณะ (/concertsX, /loginx)", () => {
    expect(isPublicPath("/concertsX")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
  });
});

describe("/admin/*", () => {
  it("ยังไม่ล็อกอิน → login", () => {
    expect(decideRouteAccess({ pathname: "/admin", ...anon })).toEqual({ kind: "login" });
    expect(decideRouteAccess({ pathname: "/admin/sales", ...anon })).toEqual({ kind: "login" });
  });

  it("USER และ STAFF → เด้งหน้าแรก (เจ้าหน้าที่ต้องไม่เห็นรายได้/คิว/บอทล็อก)", () => {
    expect(decideRouteAccess({ pathname: "/admin", ...user })).toEqual({ kind: "home" });
    expect(decideRouteAccess({ pathname: "/admin/checkin", ...staff })).toEqual({ kind: "home" });
    expect(decideRouteAccess({ pathname: "/admin/staff", ...staff })).toEqual({ kind: "home" });
  });

  it("ADMIN → ผ่าน", () => {
    expect(decideRouteAccess({ pathname: "/admin/staff", ...admin })).toEqual({ kind: "next" });
  });

  it("/administrator (ไม่ใช่ใต้ /admin/) ไม่ถูกนับเป็นหน้าแอดมิน", () => {
    expect(decideRouteAccess({ pathname: "/administrator", ...user })).toEqual({ kind: "next" });
  });
});

describe("/staff/*", () => {
  it("ยังไม่ล็อกอิน → login", () => {
    expect(decideRouteAccess({ pathname: "/staff/checkin", ...anon })).toEqual({ kind: "login" });
  });

  it("ล็อกอินแล้วผ่านทุก role — role ตัดสินที่ (staff)/layout กับ DB (JWT ค้าง: คนเพิ่งถูกแต่งตั้งต้องเข้าได้เลย)", () => {
    expect(decideRouteAccess({ pathname: "/staff/checkin", ...user })).toEqual({ kind: "next" });
    expect(decideRouteAccess({ pathname: "/staff/checkin", ...staff })).toEqual({ kind: "next" });
    expect(decideRouteAccess({ pathname: "/staff", ...admin })).toEqual({ kind: "next" });
  });
});

describe("/account/*", () => {
  it("ต้องล็อกอิน ไม่สน role", () => {
    expect(decideRouteAccess({ pathname: "/account/tickets", ...anon })).toEqual({ kind: "login" });
    expect(decideRouteAccess({ pathname: "/account/tickets", ...user })).toEqual({ kind: "next" });
    expect(decideRouteAccess({ pathname: "/account/orders", ...staff })).toEqual({ kind: "next" });
  });
});

describe("path อื่น", () => {
  it("เช่น /checkout/12 หรือ /privacy — middleware ปล่อยผ่าน (หน้าเช็ค session เอง)", () => {
    expect(decideRouteAccess({ pathname: "/checkout/12", ...anon })).toEqual({ kind: "next" });
    expect(decideRouteAccess({ pathname: "/privacy", ...anon })).toEqual({ kind: "next" });
  });
});
