"use client";

// Hook สร้าง browser fingerprint hash (client-side)
// ใช้ FingerprintJS OSS — ฟรี ไม่ต้อง API key
// ผูก device เพื่อกัน 1 คนถือหลาย queue slot + เป็นสัญญาณ anti-bot (ไม่มี = JS ไม่รัน)
import { useEffect, useState } from "react";
import FingerprintJS from "@fingerprintjs/fingerprintjs";

export function useFingerprint(): string | null {
  const [fp, setFp] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const agent = await FingerprintJS.load();
        const result = await agent.get();
        if (!cancelled) setFp(result.visitorId);
      } catch {
        // ถ้า fingerprint ล้มเหลว (privacy tool บล็อก) → null
        // anti-bot engine จะให้คะแนนเล็กน้อย ไม่ block (กัน false positive)
        if (!cancelled) setFp(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return fp;
}
