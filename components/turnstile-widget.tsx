"use client";

// Cloudflare Turnstile widget (client) — โหลด script + render checkbox
// callback ส่ง token กลับให้ parent ผ่าน onVerify
import { useEffect, useRef } from "react";

// ขยาย window type สำหรับ turnstile global
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: TurnstileOptions) => string;
      reset: (widgetId?: string) => void;
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
}

const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";

export function TurnstileWidget({
  siteKey,
  onVerify,
}: {
  siteKey: string;
  onVerify: (token: string) => void;
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
          // ธีมมืดให้กลืนกับพื้นเวทีของเว็บ
          theme: "dark",
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
  }, [siteKey, onVerify]);

  return <div ref={ref} className="flex justify-center" />;
}
