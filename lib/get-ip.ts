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

export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
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
