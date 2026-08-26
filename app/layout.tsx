import type { Metadata, Viewport } from "next";
import { Anuphan, Chakra_Petch } from "next/font/google";
import { ChatContextProvider } from "@/components/chat-context";
import { ChatWidget } from "@/components/chat-widget";
import { env } from "@/lib/env";
import "./globals.css";

// ฟอนต์เนื้อหา — Anuphan (ไทย+ละติน อ่านง่าย, variable font)
const anuphan = Anuphan({
  subsets: ["thai", "latin"],
  variable: "--font-anuphan",
  display: "swap",
});

// ฟอนต์ display — Chakra Petch (เหลี่ยมแบบจอ LED ใช้กับหัวข้อ/ตัวเลขสำคัญ)
const chakraPetch = Chakra_Petch({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-chakra",
  display: "swap",
});

const SITE_NAME = "Concert Anti-Bot";
const SITE_TITLE = "Concert Anti-Bot — จองบัตรคอนเสิร์ตอย่างเป็นธรรม";
const SITE_DESCRIPTION =
  "ระบบจองบัตรคอนเสิร์ตที่มี anti-bot และ fairness queue เพื่อให้ผู้ใช้จริงทุกคนมีโอกาสเท่ากัน";

export const metadata: Metadata = {
  // metadataBase = โดเมนหลัก (NEXTAUTH_URL) — ให้ og:image/canonical เป็น URL เต็ม; รูป OG มาจาก app/opengraph-image.tsx อัตโนมัติ
  metadataBase: new URL(env.NEXTAUTH_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // พรีวิวตอนแชร์ลิงก์ใน LINE / Facebook / Discord (ก่อนหน้านี้ไม่มี = ลิงก์เปล่าไม่มีรูป-คำอธิบาย)
  openGraph: {
    type: "website",
    locale: "th_TH",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

// สีแถบ browser บนมือถือให้กลืนกับพื้นเวที
export const viewport: Viewport = {
  themeColor: "#171010",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={`${anuphan.variable} ${chakraPetch.variable}`}>
      <body className="min-h-screen bg-ink-950 font-sans text-fg antialiased">
        <ChatContextProvider>
          {children}
          <ChatWidget />
        </ChatContextProvider>
      </body>
    </html>
  );
}
