"use client";

// Error boundary ชั้นนอกสุด — ทำงานเมื่อ root layout เองพัง (error.tsx ธรรมดาช่วยไม่ได้แล้ว)
// ต้องวาด <html><body> เองทั้งหมด และไม่พึ่งฟอนต์/คอมโพเนนต์จาก layout (อาจเป็นตัวที่พัง) → ใช้สไตล์ inline ล้วน
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#171010",
          color: "#f3ecea",
          fontFamily: "Anuphan, 'Noto Sans Thai', system-ui, sans-serif",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <p style={{ fontSize: "4.5rem", fontWeight: 700, lineHeight: 1, color: "#ff5c70", margin: 0 }}>500</p>
          <h1 style={{ fontSize: "1.5rem", margin: "1rem 0 0.5rem" }}>ระบบขัดข้องชั่วคราว</h1>
          <p style={{ color: "#a89a9a", lineHeight: 1.6, margin: 0 }}>
            เกิดข้อผิดพลาดที่ชั้นแสดงผลหลัก ลองโหลดหน้าใหม่ ถ้ายังเกิดซ้ำ แจ้งทีมงานพร้อมรหัสอ้างอิง
          </p>
          {error.digest && (
            <p style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#a89a9a", marginTop: "0.75rem" }}>
              รหัสอ้างอิง: {error.digest}
            </p>
          )}
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", marginTop: "1.5rem" }}>
            <button
              onClick={reset}
              style={{
                background: "#c8102e",
                color: "#fff",
                border: 0,
                borderRadius: 10,
                padding: "0.7rem 1.2rem",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ลองใหม่
            </button>
            {/* ตั้งใจใช้ <a> ไม่ใช่ <Link>: ถึงจุดนี้ต้นไม้ React ชั้นบนพังแล้ว ต้องการโหลดหน้าใหม่ทั้งหน้า ไม่ใช่ client navigation */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                color: "#f3ecea",
                border: "1px solid rgba(243,236,234,0.25)",
                borderRadius: 10,
                padding: "0.7rem 1.2rem",
                fontSize: "1rem",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              กลับหน้าแรก
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
