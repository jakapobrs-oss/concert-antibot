"use client";

// Waiting Room — client component
// flow: fingerprint → join (anti-bot assess) → ถ้า CHALLENGE แสดง Turnstile → retry
//       → WAITING (poll position) → ADMITTED → redirect ไปเลือกที่นั่ง
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { useFingerprint } from "@/lib/use-fingerprint";
import { useBehaviorTracker } from "@/lib/use-behavior-tracker";

interface QueueStatus {
  token: string;
  status: "WAITING" | "ADMITTED" | "EXPIRED" | "NOT_FOUND";
  position: number;
  ahead: number;
  total: number;
  admitExpiresAt?: number;
}

// peak-load: poll แบบ backoff ตามตำแหน่งคิว — คนอยู่ท้ายคิวไม่ต้อง poll ถี่
//   (ยังไงก็อีกนานกว่าจะถึง) ลดภาระ /api/queue/status ตอน flash-crowd ได้หลายเท่า
//   + jitter กัน client poll พร้อมกันเป๊ะ (thundering herd)
function computePollDelay(position: number): number {
  let base: number;
  if (position <= 50) base = 2500; // ใกล้ถึงคิว — poll ถี่
  else if (position <= 500) base = 5000;
  else if (position <= 2000) base = 10000;
  else base = 20000; // ท้ายคิวมาก — poll ห่าง
  const jitter = base * 0.25 * (Math.random() * 2 - 1); // ±25%
  return Math.round(base + jitter);
}

export function WaitingRoom({
  concertId,
  slug,
  turnstileSiteKey,
}: {
  concertId: string;
  slug: string;
  turnstileSiteKey: string;
}) {
  const router = useRouter();
  const fingerprint = useFingerprint();
  // เก็บพฤติกรรม (mouse/key) ระหว่างอยู่ในห้องรอ — ใช้ fingerprint เป็น sessionKey
  const { flush: flushBehavior } = useBehaviorTracker(fingerprint);
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [needChallenge, setNeedChallenge] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false); // หยุด poll เมื่อ admitted/expired/unmount
  const lastPositionRef = useRef<number>(99999); // ตำแหน่งล่าสุด ใช้คำนวณ backoff
  const joinedRef = useRef(false);

  // poll สถานะคิว
  const poll = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || stoppedRef.current) return;
    try {
      const res = await fetch(`/api/queue/status?token=${token}`);
      const data: QueueStatus = await res.json();
      setStatus(data);
      lastPositionRef.current = data.position ?? lastPositionRef.current;

      if (data.status === "ADMITTED") {
        stoppedRef.current = true;
        if (pollRef.current) clearTimeout(pollRef.current);
        // ส่ง behavior features ก่อนออกจากห้องรอ (เก็บ dataset + วิเคราะห์)
        await flushBehavior();
        sessionStorage.setItem(`queue-token:${concertId}`, token);
        router.push(`/concerts/${slug}/seats?qt=${token}`);
        return;
      }
      if (data.status === "EXPIRED" || data.status === "NOT_FOUND") {
        stoppedRef.current = true;
        if (pollRef.current) clearTimeout(pollRef.current);
        setError("คิวหมดอายุแล้ว กรุณาเข้าคิวใหม่");
        return;
      }
    } catch {
      setError("เชื่อมต่อไม่ได้ — กำลังลองใหม่");
      // ไม่หยุด — ปล่อยให้ schedule รอบถัดไป retry เอง
    }
    // schedule รอบถัดไปแบบ backoff ตามตำแหน่งล่าสุด (แทน setInterval คงที่)
    if (!stoppedRef.current) {
      pollRef.current = setTimeout(poll, computePollDelay(lastPositionRef.current));
    }
  }, [concertId, slug, router, flushBehavior]);

  // ฟังก์ชันเข้าคิว — เรียกตอน mount และตอน retry หลังทำ Turnstile
  const attemptJoin = useCallback(
    async (turnstileToken?: string) => {
      try {
        const res = await fetch("/api/queue/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            concertId,
            fingerprintHash: fingerprint ?? undefined,
            turnstileToken,
          }),
        });

        // BLOCK — ปฏิเสธ
        if (res.status === 403) {
          setBlocked(true);
          return;
        }
        // CHALLENGE — ต้องทำ Turnstile ก่อน
        if (res.status === 428) {
          setNeedChallenge(true);
          return;
        }
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          setError(e.error ?? "เข้าคิวไม่สำเร็จ");
          return;
        }

        // ALLOW — ได้ token เริ่ม poll
        const { token } = await res.json();
        tokenRef.current = token;
        setNeedChallenge(false);
        stoppedRef.current = false;
        await poll(); // poll() จะ schedule รอบถัดไปเอง (backoff ตามตำแหน่ง)
      } catch {
        setError("เข้าคิวไม่สำเร็จ");
      }
    },
    [concertId, fingerprint, poll]
  );

  // เข้าคิวครั้งแรก — รอ fingerprint โหลดเสร็จก่อน (หรือ timeout)
  useEffect(() => {
    // join ครั้งเดียว
    if (joinedRef.current) return;
    // รอ fingerprint สูงสุด ~1.5s ถ้ายังไม่มาก็ join แบบไม่มี fp (กันค้าง)
    const t = setTimeout(() => {
      if (!joinedRef.current) {
        joinedRef.current = true;
        attemptJoin();
      }
    }, 1500);
    if (fingerprint && !joinedRef.current) {
      joinedRef.current = true;
      clearTimeout(t);
      attemptJoin();
    }
    return () => clearTimeout(t);
  }, [fingerprint, attemptJoin]);

  // cleanup poll
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  async function handleLeave() {
    if (tokenRef.current) {
      await fetch("/api/queue/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current }),
      });
    }
    router.push(`/concerts/${slug}`);
  }

  // --- UI states ---

  if (blocked) {
    return (
      <div className="text-center space-y-4">
        <div className="text-4xl">🚫</div>
        <h2 className="text-xl font-semibold">ตรวจพบกิจกรรมผิดปกติ</h2>
        <p className="text-neutral-600 text-sm">
          ระบบปฏิเสธคำขอนี้ หากคุณเป็นผู้ใช้จริง กรุณาลองใหม่จากเบราว์เซอร์ปกติ
        </p>
      </div>
    );
  }

  if (needChallenge) {
    return (
      <div className="text-center space-y-4">
        <div className="text-4xl">🤖</div>
        <h2 className="text-xl font-semibold">ยืนยันว่าคุณไม่ใช่บอท</h2>
        <p className="text-neutral-600 text-sm">กรุณาทำเครื่องหมายด้านล่างเพื่อเข้าคิว</p>
        <TurnstileWidget
          siteKey={turnstileSiteKey}
          onVerify={(token) => attemptJoin(token)}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center space-y-4">
        <div className="text-4xl">⏰</div>
        <p className="text-red-600">{error}</p>
        <Button onClick={() => window.location.reload()}>เข้าคิวใหม่</Button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="space-y-3 text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-brand-500" />
        <p className="text-neutral-500">กำลังเข้าคิว…</p>
      </div>
    );
  }

  const progress =
    status.total > 0 ? Math.round(((status.total - status.ahead) / status.total) * 100) : 0;

  return (
    <div className="text-center space-y-6">
      <div className="text-5xl">🎟️</div>
      <div>
        <h2 className="text-2xl font-bold mb-1">คุณอยู่ในห้องรอ</h2>
        <p className="text-neutral-500 text-sm">
          ระบบจัดคิวอย่างเป็นธรรม — ทุกคนที่เข้าพร้อมกันมีโอกาสเท่ากัน
        </p>
      </div>

      <div className="bg-brand-50 rounded-xl p-6">
        <p className="text-sm text-neutral-600 mb-1">ตำแหน่งของคุณ</p>
        <p className="text-5xl font-bold text-brand-600">{status.position.toLocaleString()}</p>
        <p className="text-sm text-neutral-500 mt-1">
          จากทั้งหมด {status.total.toLocaleString()} คน
        </p>
      </div>

      <div>
        <div className="h-2 bg-neutral-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-neutral-400 mt-2">
          กรุณาอย่าปิดหน้านี้ — ระบบจะพาคุณเข้าสู่หน้าเลือกที่นั่งอัตโนมัติเมื่อถึงคิว
        </p>
      </div>

      {/* กล่องกติกาความเป็นธรรม — perceived fairness: ทำให้ผู้ใช้เข้าใจว่าระบบยุติธรรมยังไง */}
      <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-4 text-left text-sm space-y-2">
        <p className="font-medium text-neutral-700">🛡️ ระบบนี้ยุติธรรมอย่างไร</p>
        <ul className="space-y-1.5 text-neutral-600 text-xs">
          <li>⚖️ <strong>ไม่เอื้อคนเน็ตเร็ว</strong> — ทุกคนที่เข้าช่วงเวลาเดียวกันมีโอกาสเท่ากัน ระบบสุ่มลำดับ ไม่ตัดสินที่ความเร็วระดับเสี้ยววินาที</li>
          <li>👤 <strong>1 บัญชี = 1 คิว</strong> — เปิดหลายหน้าจอหรือหลายแท็บไม่ช่วยให้ได้เปรียบ ทุกแท็บใช้คิวเดียวกัน</li>
          <li>🚫 <strong>ไม่มีทางลัด</strong> — ไม่มีการจ่ายเงินแซงคิว ทุกคนผ่านขั้นตอนเดียวกัน</li>
        </ul>
      </div>

      <Button variant="outline" onClick={handleLeave}>
        ออกจากคิว
      </Button>
    </div>
  );
}
