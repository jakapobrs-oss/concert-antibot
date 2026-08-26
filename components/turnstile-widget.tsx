"use client";

// Cloudflare Turnstile widget (client) — โหลด script + render checkbox
// callback ส่ง token กลับให้ parent ผ่าน onVerify
import { useEffect, useRef } from "react";
import type { TurnstileAction } from "@/lib/turnstile-actions";

// ขยาย window type สำหรับ turnstile global
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: TurnstileOptions) => string;
      reset: (widgetId?: string) => void;
      remove?: (widgetId?: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

interface TurnstileOptions {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact";
  // ชื่อจุดที่ขอ — ฝังใน token ให้ server เทียบตอน verify (SECURITY_TODO #2)
  action?: string;
}

const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";

export function TurnstileWidget({
  siteKey,
  onVerify,
  // บังคับระบุทุกจุด — server (lib/turnstile.ts) ปฏิเสธ token ที่ action ไม่ตรงด่าน
  // จึงห้ามมี widget ที่ "ไม่มี action" หลุดไป ไม่งั้นคนจริงแก้ challenge แล้วยังไม่ผ่าน
  action,
  // "compact" (150px) สำหรับกล่องแคบ เช่น แถบสรุปที่นั่งข้างผัง — ขนาด normal กว้าง 300px จะล้นกล่อง
  size = "normal",
}: {
  siteKey: string;
  onVerify: (token: string) => void;
  action: TurnstileAction;
  size?: "normal" | "compact";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    // render widget เมื่อ script พร้อม
    function render() {
      if (ref.current && window.turnstile && !widgetIdRef.current) {
        widgetIdRef.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: onVerify,
          action,
          // ธีมมืดให้กลืนกับพื้นเวทีของเว็บ
          theme: "dark",
          size,
        });
      }
    }

    // ถ้า script โหลดแล้ว render เลย, ไม่งั้นรอ onload
    if (window.turnstile) {
      render();
    } else {
      window.onTurnstileLoad = render;
      // โหลด script ถ้ายังไม่มี
      if (!document.querySelector(`script[src^="https://challenges.cloudflare.com"]`)) {
        const s = document.createElement("script");
        s.src = SCRIPT_URL;
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
      }
    }
  }, [siteKey, onVerify, action, size]);

  // ถอด widget ออกจาก Turnstile ตอน unmount (เช่น parent เปลี่ยน key เพื่อขอ token ใหม่หลังยืนยันไม่ผ่าน)
  //   แยกจาก effect บนโดยตั้งใจ — ถ้าผูก deps เดียวกัน onVerify เปลี่ยน identity (fingerprint โหลดเสร็จ)
  //   จะถอด/สร้าง widget ใหม่กลางคันตอนผู้ใช้กำลังติ๊ก
  useEffect(() => {
    return () => {
      if (widgetIdRef.current) {
        window.turnstile?.remove?.(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  return <div ref={ref} className="flex justify-center" />;
}
