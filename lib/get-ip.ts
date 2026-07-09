import { type NextRequest } from "next/server";

// Extract the real client IP as securely as possible.
//
// XFF (x-forwarded-for) is client-controlled unless a trusted proxy strips/overwrites it.
// Strategy: take the RIGHTMOST hop (added by the nearest infrastructure),
// then subtract TRUSTED_PROXY_HOPS to skip hops added by trusted proxies you control.
//
// Local/no-proxy (default TRUSTED_PROXY_HOPS=0): uses rightmost XFF value — still
// potentially attacker-controlled, but harder to spoof than the leftmost (original vuln).
//
// For endpoints that require auth, KEY RATE LIMITS ON userId, not IP.
// IP-based limits are only meaningful for unauthenticated endpoints.
const TRUSTED_HOPS = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);

// core: เลือก IP จากค่า x-forwarded-for (string) — ใช้ hop ขวาสุด ลบ TRUSTED_PROXY_HOPS
//   แยกออกมาเพื่อให้ server action (ที่มีแต่ headers() ไม่มี NextRequest) เรียกใช้ตรรกะเดียวกันได้
//   เดิม register/behavior ใช้ split[0] (ซ้ายสุด = ปลอมได้) → ย้ายมาใช้ตัวนี้ให้ทั่ว (Codex §3/§4)
export function clientIpFromXff(xff: string | null | undefined): string {
  if (xff) {
    const hops = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const idx = Math.max(0, hops.length - 1 - TRUSTED_HOPS);
    if (hops[idx]) return hops[idx];
  }
  return "unknown";
}

export function getClientIp(req: NextRequest): string {
  return clientIpFromXff(req.headers.get("x-forwarded-for"));
}
