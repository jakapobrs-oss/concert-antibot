// โลโก้สำหรับวาดเป็นรูป (favicon / apple-icon / OG image) ด้วย next/og (Satori)
// Satori รองรับ flex + inline SVG แต่ไม่รองรับ Tailwind/oklch → ใช้ค่าสี hex ที่ใกล้ token ของ globals.css
//   ink-950 ≈ #171010 (themeColor ใน layout) · brand-600 ≈ #c8102e · ขาว
// ไอคอนตั๋ว = path เดียวกับ lucide "Ticket" ที่ใช้ในหัวเว็บ/ฟุตเตอร์ ให้แบรนด์ตรงกันทุกที่

export const BRAND_INK = "#171010";
export const BRAND_RED = "#c8102e";

// path ของ lucide Ticket (stroke-based) — ใช้ใน SVG inline ของ Satori ได้
const TICKET_PATH =
  "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z";

export function TicketGlyph({ size, color = "#fff" }: { size: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={TICKET_PATH} />
      <path d="M13 5v2" />
      <path d="M13 17v2" />
      <path d="M13 11v2" />
    </svg>
  );
}

// ป้ายแบรนด์: พื้นเวทีมืด + สี่เหลี่ยมแดงมุมมน + ตั๋วขาว (สัดส่วนเดียวกับโลโก้ในหัวเว็บ)
export function BrandMark({ size, radius }: { size: number; radius: number }) {
  const badge = Math.round(size * 0.72);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND_INK,
        borderRadius: radius,
      }}
    >
      <div
        style={{
          width: badge,
          height: badge,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_RED,
          borderRadius: Math.round(badge * 0.26),
        }}
      >
        <TicketGlyph size={Math.round(badge * 0.6)} />
      </div>
    </div>
  );
}
