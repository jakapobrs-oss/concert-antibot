"use client";

// Hook เก็บพฤติกรรมผู้ใช้ฝั่ง client → คำนวณ features → ส่งไป server
// เก็บ: mouse move, key press, timing, ทิศทางการเคลื่อน (สำหรับ entropy)
// ไม่เก็บ raw ทุก pixel — สรุปเป็น feature เพื่อ privacy + ประหยัด
import { useEffect, useRef } from "react";

interface TrackerState {
  mouseMoveCount: number;
  keyPressCount: number;
  mouseTimestamps: number[]; // เวลาแต่ละ mouse move (สำหรับ variance)
  directions: number[]; // มุมการเคลื่อน (สำหรับ entropy)
  lastX: number | null;
  lastY: number | null;
  startTime: number;
}

// คำนวณ variance ของ inter-event timing
function timingVariance(timestamps: number[]): number {
  if (timestamps.length < 3) return 0;
  const deltas: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    deltas.push(timestamps[i] - timestamps[i - 1]);
  }
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const variance = deltas.reduce((a, d) => a + (d - mean) ** 2, 0) / deltas.length;
  return variance;
}

// คำนวณ entropy ของทิศทาง (แบ่งเป็น 8 ทิศ → Shannon entropy normalize 0-1)
function directionEntropy(directions: number[]): number {
  if (directions.length < 3) return 0;
  const bins = new Array(8).fill(0);
  for (const angle of directions) {
    // normalize angle (rad) → bin 0-7
    const bin = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 8) % 8;
    bins[bin]++;
  }
  const total = directions.length;
  let entropy = 0;
  for (const c of bins) {
    if (c > 0) {
      const p = c / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy / 3; // max entropy = log2(8)=3 → normalize 0-1
}

export function useBehaviorTracker(sessionKey: string | null) {
  const stateRef = useRef<TrackerState>({
    mouseMoveCount: 0,
    keyPressCount: 0,
    mouseTimestamps: [],
    directions: [],
    lastX: null,
    lastY: null,
    startTime: Date.now(),
  });

  useEffect(() => {
    const s = stateRef.current;
    s.startTime = Date.now();

    function onMouseMove(e: MouseEvent) {
      s.mouseMoveCount++;
      const now = Date.now();
      // เก็บ timestamp (จำกัด 200 ตัวล่าสุดกัน memory)
      s.mouseTimestamps.push(now);
      if (s.mouseTimestamps.length > 200) s.mouseTimestamps.shift();
      // คำนวณทิศทางจากจุดก่อนหน้า
      if (s.lastX !== null && s.lastY !== null) {
        const dx = e.clientX - s.lastX;
        const dy = e.clientY - s.lastY;
        if (dx !== 0 || dy !== 0) {
          s.directions.push(Math.atan2(dy, dx));
          if (s.directions.length > 200) s.directions.shift();
        }
      }
      s.lastX = e.clientX;
      s.lastY = e.clientY;
    }

    function onKeyDown() {
      s.keyPressCount++;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // ส่ง features ไป server (เรียกตอนก่อน submit/ออกจากหน้า)
  async function flush() {
    if (!sessionKey) return;
    const s = stateRef.current;
    const features = {
      sessionKey,
      mouseMoveCount: s.mouseMoveCount,
      keyPressCount: s.keyPressCount,
      mouseTimingVariance: timingVariance(s.mouseTimestamps),
      mousePathEntropy: directionEntropy(s.directions),
      dwellTimeMs: Date.now() - s.startTime,
    };
    try {
      await fetch("/api/behavior", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(features),
        keepalive: true, // ส่งได้แม้หน้ากำลังปิด
      });
    } catch {
      // best-effort — ไม่ critical
    }
  }

  return { flush };
}
