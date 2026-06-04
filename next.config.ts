import type { NextConfig } from "next";

// Next.js config — local-only, ไม่มี image domain ภายนอก (ใช้ MinIO localhost)
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // หมายเหตุ: ไม่เปิด typedRoutes เพราะใช้ template-literal href (`/concerts/${slug}`)
  // ซึ่งจะ type error กับ typedRoutes — ปิดไว้เพื่อความเสถียรของ build
  experimental: {
    // สลิปถ่ายจากมือถือจริงมักใหญ่กว่า 1MB (default ของ Server Action)
    // ถ้าไม่ขยาย Next จะปฏิเสธ "Body exceeded 1MB" ก่อนถึง validation F7 ด้วยซ้ำ
    // → ตั้ง 3MB ให้สอดคล้องกับ MAX_SLIP_BASE64_LEN (ควรบีบรูปฝั่ง client ร่วมด้วย)
    serverActions: { bodySizeLimit: "3mb" },
  },
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "9000" }, // MinIO
    ],
  },
  // Security headers — หน้า checkout จัดการเงินจริง ต้องกัน clickjacking + MIME-sniff
  // (CSP เต็มรูปแบบยังไม่ใส่เพราะต้อง allowlist Turnstile/Next inline — ทำเป็น follow-up)
  async headers() {
    const headers = [
      { key: "X-Frame-Options", value: "DENY" }, // กัน clickjacking หน้าจ่ายเงิน
      { key: "X-Content-Type-Options", value: "nosniff" }, // กัน MIME-sniffing
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    // HSTS — เฉพาะ production (dev ใช้ http://localhost จะใช้ไม่ได้)
    if (process.env.NODE_ENV === "production") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    }
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
