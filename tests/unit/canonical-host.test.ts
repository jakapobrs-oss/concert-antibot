// Unit tests — lib/canonical-host.ts: production ที่เปิดจาก URL ของ deployment ต้องถูกส่งไปโฮสต์หลัก
// บั๊กที่จับ (2026-08-27): เปิดลิงก์ที่ `vercel redeploy` พิมพ์ → กด Google → cookie PKCE อยู่คนละโฮสต์กับ callback
//   → "pkceCodeVerifier value could not be parsed" → หน้า Server error
import { describe, it, expect } from "vitest";
import { canonicalHostOf, canonicalRedirect } from "@/lib/canonical-host";

const CANON = "concert-antibot.vercel.app";
const base = { canonicalHost: CANON, vercelEnv: "production", pathname: "/login", search: "" };

describe("canonicalHostOf", () => {
  it("ดึง host จาก NEXTAUTH_URL (lowercase)", () => {
    expect(canonicalHostOf("https://Concert-Antibot.vercel.app")).toBe(CANON);
  });
  it("ว่าง / พัง → null (middleware จะไม่ redirect อะไรเลย)", () => {
    expect(canonicalHostOf("")).toBeNull();
    expect(canonicalHostOf(undefined)).toBeNull();
    expect(canonicalHostOf("not a url")).toBeNull();
  });
});

describe("canonicalRedirect", () => {
  it("โฮสต์ของ deployment บน production → 308 ไปโฮสต์หลัก path+query เดิม", () => {
    expect(
      canonicalRedirect({
        ...base,
        host: "concert-antibot-q4esh8ksk-jakapobrs-oss-projects.vercel.app",
        pathname: "/concerts/x",
        search: "?tab=1",
      })
    ).toBe(`https://${CANON}/concerts/x?tab=1`);
  });

  it("โฮสต์หลักเอง → null (ไม่วน)", () => {
    expect(canonicalRedirect({ ...base, host: CANON })).toBeNull();
    expect(canonicalRedirect({ ...base, host: "Concert-Antibot.vercel.app" })).toBeNull();
  });

  it("preview / dev → null (ปล่อยตามเดิม)", () => {
    expect(canonicalRedirect({ ...base, host: "concert-antibot-git-x.vercel.app", vercelEnv: "preview" })).toBeNull();
    expect(canonicalRedirect({ ...base, host: "localhost:3000", vercelEnv: undefined })).toBeNull();
  });

  it("โดเมนอื่นที่ไม่ใช่ *.vercel.app → null (custom domain ในอนาคตไม่แตะ)", () => {
    expect(canonicalRedirect({ ...base, host: "tickets.example.com" })).toBeNull();
  });

  it("ไม่มี NEXTAUTH_URL / ไม่มี Host → null", () => {
    expect(canonicalRedirect({ ...base, host: "x-abc.vercel.app", canonicalHost: null })).toBeNull();
    expect(canonicalRedirect({ ...base, host: null })).toBeNull();
  });
});
