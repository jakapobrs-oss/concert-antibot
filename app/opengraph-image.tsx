// รูปตอนแชร์ลิงก์ (Open Graph 1200×630) — วาดตอน build ด้วย next/og, ใช้เป็นค่าตั้งต้นทุกหน้า
//   หน้าคอนเสิร์ตแต่ละงาน override เป็นโปสเตอร์ของงานผ่าน generateMetadata (ดู concerts/[slug]/page.tsx)
// ข้อความในรูปเป็นอังกฤษโดยตั้งใจ: ฟอนต์ตั้งต้นของ Satori ไม่มีอักษรไทย (โหลดฟอนต์ไทยตอน build = พึ่งเน็ตภายนอก เสี่ยง build ล้ม)
//   ส่วนชื่อ/คำอธิบายภาษาไทยไปอยู่ใน og:title / og:description ซึ่ง LINE/Facebook แสดงเป็นข้อความอยู่แล้ว
import { ImageResponse } from "next/og";
import { BRAND_INK, BRAND_RED, TicketGlyph } from "./brand-mark";

export const alt = "Concert Anti-Bot — จองบัตรคอนเสิร์ตอย่างเป็นธรรม";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          // Satori ไม่รับสีทึบปนใน background shorthand ("Invalid background image") → แยก backgroundColor / backgroundImage
          backgroundColor: BRAND_INK,
          backgroundImage:
            "radial-gradient(circle at 15% 20%, rgba(200,16,46,0.45) 0%, rgba(200,16,46,0) 45%), radial-gradient(circle at 85% 90%, rgba(230,160,60,0.25) 0%, rgba(230,160,60,0) 40%)",
          color: "#f3ecea",
          fontFamily: "sans-serif",
        }}
      >
        {/* โลโก้ + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 76,
              height: 76,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: BRAND_RED,
              borderRadius: 20,
            }}
          >
            <TicketGlyph size={44} />
          </div>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>
            Concert<span style={{ color: "#ff4d63" }}>.</span>
          </div>
        </div>

        {/* พาดหัว */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 88, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>
            Fair concert ticketing.
          </div>
          <div style={{ display: "flex", fontSize: 34, color: "#d9cfcc" }}>
            Randomized queue · Two-layer anti-bot · Verified PromptPay
          </div>
        </div>

        {/* แถบล่าง: จุด live + คำอธิบายสั้น */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, color: "#a89a9a" }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: "#ff4d63" }} />
          Every real fan gets the same chance — no bots, no fastest-finger.
        </div>
      </div>
    ),
    size,
  );
}
