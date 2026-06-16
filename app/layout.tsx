import type { Metadata, Viewport } from "next";
import { Anuphan, Chakra_Petch } from "next/font/google";
import { ChatContextProvider } from "@/components/chat-context";
import { ChatWidget } from "@/components/chat-widget";
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

export const metadata: Metadata = {
  title: {
    default: "Concert Anti-Bot — จองบัตรคอนเสิร์ตอย่างเป็นธรรม",
    template: "%s | Concert Anti-Bot",
  },
  description:
    "ระบบจองบัตรคอนเสิร์ตที่มี anti-bot และ fairness queue เพื่อให้ผู้ใช้จริงทุกคนมีโอกาสเท่ากัน",
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
