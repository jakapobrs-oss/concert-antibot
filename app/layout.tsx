import type { Metadata } from "next";
import { Inter, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

// font ภาษาอังกฤษ + ภาษาไทย (preload เพื่อให้ FCP เร็ว)
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoThai = Noto_Sans_Thai({
  subsets: ["thai"],
  variable: "--font-noto-thai",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Concert Anti-Bot — จองบัตรคอนเสิร์ตอย่างเป็นธรรม",
    template: "%s | Concert Anti-Bot",
  },
  description:
    "ระบบจองบัตรคอนเสิร์ตที่มี anti-bot 8 ชั้น + fairness queue เพื่อให้ผู้ใช้จริงทุกคนมีโอกาสเท่ากัน",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={`${inter.variable} ${notoThai.variable}`}>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
