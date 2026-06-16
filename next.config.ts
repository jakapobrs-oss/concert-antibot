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
  // Security headers — หน้า checkout จัดการเงินจริง ต้องกัน clickjacking + MIME-sniff + XSS
  async headers() {
    const isProd = process.env.NODE_ENV === "production";

    // CSP: 'unsafe-inline' สำหรับ script/style เพราะ Next.js 15 inject inline scripts ตอน hydration
    // ได้ประโยชน์หลักจาก: object-src 'none', base-uri 'self', frame-src Turnstile เท่านั้น
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: http://localhost:9000",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src https://challenges.cloudflare.com",
      "object-src 'none'",    // กัน Flash/plugin
      "base-uri 'self'",      // กัน base-tag injection
      "form-action 'self'",   // กัน cross-origin form submit
    ].join("; ");

    const headers = [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];

    if (isProd) {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    }

    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
