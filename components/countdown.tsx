"use client";

// ตัวนับถอยหลังก่อนเปิดขาย/เปิดรอบ (Phase 2.4, docs/24)
// เมื่อถึงเวลา → เรียก onReach() ให้หน้าจอไปถามเซิร์ฟเวอร์ว่าเปิดจริงหรือยัง
//   (ไม่ปลดล็อกปุ่มเองจากนาฬิกาเครื่องผู้ใช้ — นาฬิกาเครื่องเชื่อไม่ได้ และ server เป็นคนตัดสิน)
import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { countdownParts, formatCountdown, tickIntervalMs } from "@/lib/countdown";

export function Countdown({
  targetAt,
  prefix = "เปิดอีก",
  onReach,
  className = "",
}: {
  targetAt: string; // ISO จาก server เสมอ
  prefix?: string;
  onReach?: () => void;
  className?: string;
}) {
  const target = new Date(targetAt);
  const [text, setText] = useState(() => formatCountdown(target));
  const [done, setDone] = useState(() => countdownParts(target).done);

  useEffect(() => {
    const t = new Date(targetAt);
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const parts = countdownParts(t);
      setText(formatCountdown(t));
      if (parts.done) {
        setDone(true);
        onReach?.(); // ถึงเวลาแล้ว → ให้ผู้เรียกไป refetch สถานะจริงจาก server
        return;
      }
      timer = setTimeout(tick, tickIntervalMs(t));
    };

    tick();
    return () => clearTimeout(timer);
    // onReach ถูกส่งมาจาก parent ที่ห่อ useCallback ไว้แล้ว
  }, [targetAt, onReach]);

  if (done) return null;

  return (
    <span className={`inline-flex items-center gap-1.5 tabular-nums ${className}`}>
      <Timer className="size-3.5 shrink-0" aria-hidden />
      {prefix} {text}
    </span>
  );
}
