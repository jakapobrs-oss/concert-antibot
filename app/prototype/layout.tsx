// app/prototype/* = ของจำลองสำหรับออกแบบ (client-only simulation ไม่ต่อ Redis/คิวจริง — ดู CLAUDE.md)
//   เดิมเปิดสาธารณะบน production (concert-antibot.vercel.app/prototype/queue-runner) ทั้งที่ไม่ใช่ฟีเจอร์จริง
//   → production ตอบ 404 (notFound ใช้หน้า app/not-found.tsx เดียวกับ route อื่น) · dev/preview ยังเปิดดูได้
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export default function PrototypeLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
