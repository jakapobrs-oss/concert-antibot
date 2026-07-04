"use client";

// ============================================================
// PROTOTYPE — "นักวิ่งสู่เวที" + แผงคุมการปล่อยคิวแบบรู้ความจุ (capacity-aware)
// ------------------------------------------------------------
// หน้านี้เป็น "ของจำลอง (simulation)" ฝั่ง client ล้วน — ไม่ต่อ Redis/คิวจริง
// จุดประสงค์: ให้เห็นภาพ 2 ฝั่งพร้อมกันก่อนตัดสินใจลงของจริง
//   1) ฝั่งผู้ใช้  = ตัวการ์ตูนวิ่งไปตามแถบ ตำแหน่งวิ่ง = ความคืบหน้าในคิว
//   2) ฝั่งแอดมิน = แผงคุม cap/batch/รอบ + ปุ่มหยุด-ปล่อยเอง + ตัวเลขสด
//
// "สมองการปล่อยคิว" ที่จำลอง (ตรงกับที่จะทำจริงใน lib/queue.ts → admitNext):
//   ปล่อยต่อรอบ = min( batch, cap − คนที่ยังเลือกอยู่ข้างใน, ที่นั่งที่เหลือ )
//   พอคนข้างในจ่ายเสร็จ/ออก → คืนความจุ → รอบถัดไปเติมเข้าไปใหม่ (self-refill)
//
// ⚠️ ตัวการ์ตูนตอนนี้ใช้ emoji เป็นตัวแทน — ของจริงสลับเป็น SVG/Lottie มาสคอตได้
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { EqBars } from "@/components/eq-bars";

// ---- ค่าเริ่มต้นของการจำลอง ----
const QUEUE_START = 200; // คนในคิวตอนเริ่ม (รวม "คุณ")
const YOUR_START_POS = 60; // ตำแหน่งเริ่มต้นของคุณ (ยาวหน่อย จะได้เห็นหลอดไหลต่อเนื่องชัด)
const SEATS_START = 150; // ที่นั่งทั้งหมดของคอนเสิร์ตจำลอง

type Phase = "waiting" | "admitted" | "soldout" | "done";

interface SimState {
  queue: number; // คนยังรออยู่
  inside: number; // คนที่อยู่ในโซนเลือกที่นั่งตอนนี้ (active)
  seatsLeft: number; // ที่นั่งที่เหลือ
  yourPos: number; // ตำแหน่งของคุณ (1-based, 0 = ถึงคิวแล้ว)
  admittedTotal: number; // ปล่อยเข้าไปแล้วสะสม
  soldTotal: number; // ขายที่นั่งไปแล้วสะสม
  lastRelease: number; // ปล่อยกี่คนในรอบล่าสุด
  phase: Phase;
}

const INITIAL: SimState = {
  queue: QUEUE_START,
  inside: 0,
  seatsLeft: SEATS_START,
  yourPos: YOUR_START_POS,
  admittedTotal: 0,
  soldTotal: 0,
  lastRelease: 0,
  phase: "waiting",
};

// คำนวณสถานะรอบถัดไป — หัวใจของ capacity-aware admission
function nextRound(s: SimState, cap: number, batch: number): SimState {
  if (s.phase === "done") return s;

  let { queue, inside, seatsLeft, yourPos, admittedTotal, soldTotal } = s;
  // annotate กว้างเป็น Phase — บรรทัดบน narrow s.phase จน "done" assign กลับไม่ได้
  let phase: Phase = s.phase;

  // 1) คนข้างในบางส่วนทำธุระเสร็จ (จ่ายเงิน/ยกเลิก/หมดเวลา) → คืนความจุ
  //    ~35% ของคนข้างในเสร็จต่อรอบ, ในกลุ่มที่เสร็จ ~80% ซื้อจริง (กินที่นั่ง)
  const finishers = Math.min(inside, Math.round(inside * 0.35) + (inside > 0 ? 1 : 0));
  const buyers = Math.min(seatsLeft, Math.round(finishers * 0.8));
  inside -= finishers;
  seatsLeft -= buyers;
  soldTotal += buyers;

  // 2) ปล่อย batch ใหม่ตามความจุที่เหลือจริง
  const release = Math.max(0, Math.min(batch, cap - inside, seatsLeft, queue));

  // ขยับ "คุณ" ในคิว
  if (phase === "waiting") {
    if (release > 0 && yourPos <= release) {
      phase = "admitted"; // ถึงคิวคุณแล้ว 🎉
      yourPos = 0;
    } else {
      yourPos = Math.max(1, yourPos - release);
      // ที่นั่งหมดก่อนถึงคิวคุณ = อด (ใช้สาธิตเคส sold out)
      if (seatsLeft <= 0 && release === 0) phase = "soldout";
    }
  }

  queue -= release;
  inside += release;
  admittedTotal += release;

  // 3) จบรอบ — ถ้าไม่มีคนรอ + ไม่มีคนข้างในแล้ว
  if (queue <= 0 && inside <= 0 && phase !== "admitted" && phase !== "soldout") {
    phase = "done";
  }

  return { queue, inside, seatsLeft, yourPos, admittedTotal, soldTotal, lastRelease: release, phase };
}

export default function QueueRunnerPrototype() {
  // ---- พารามิเตอร์ (แผงคุมแอดมิน) ----
  const [cap, setCap] = useState(10); // เพดานคนข้างในพร้อมกัน (≈10 เพื่อความลื่นไหล)
  const [batch, setBatch] = useState(10); // เติมต่อรอบสูงสุด (ปกติ = เติมให้ครบ cap)
  const [intervalMs, setIntervalMs] = useState(1500); // เช็ค/เติมคิวทุกกี่ ms
  const [running, setRunning] = useState(true); // เปิด/หยุดการปล่อยอัตโนมัติ

  // ---- สถานะการจำลอง ----
  const [sim, setSim] = useState<SimState>(INITIAL);
  const [showConfetti, setShowConfetti] = useState(false);
  const [display, setDisplay] = useState(0); // ค่าหลอดที่แสดง — ไหลลื่นด้วย rAF (ไม่ผูกกับ tick 1.5 วิ)

  // mirror param ลง ref เพื่อให้ interval อ่านค่าล่าสุดได้โดยไม่ต้องสร้าง interval ใหม่
  const capRef = useRef(cap);
  const batchRef = useRef(batch);
  useEffect(() => void (capRef.current = cap), [cap]);
  useEffect(() => void (batchRef.current = batch), [batch]);

  // หลอดไหลลื่น: rAF ค่อย ๆ ดึงค่า display เข้าหา "เป้าหมาย" (progress จริง) ทุกเฟรม ~60fps
  //   → ขยับต่อเนื่องเหมือน loading bar ไม่กระโดดเป็นก้อนตามจังหวะปล่อยคิว
  const targetRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setDisplay((d) => {
        const diff = targetRef.current - d;
        if (Math.abs(diff) < 0.05) return targetRef.current;
        return d + diff * 0.02; // ease เบา ๆ ทุกเฟรม → ไหลตามตลอด ไม่ทันจังหวะ tick = ต่อเนื่อง ไม่กระโดด
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const tick = useCallback(() => {
    setSim((s) => nextRound(s, capRef.current, batchRef.current));
  }, []);

  // ลูปปล่อยคิวอัตโนมัติ — สร้าง interval ใหม่เมื่อ interval/running เปลี่ยน
  useEffect(() => {
    if (!running) return;
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [running, intervalMs, tick]);

  // คอนเฟตติตอนถึงคิว
  useEffect(() => {
    if (sim.phase === "admitted") {
      setShowConfetti(true);
      const t = setTimeout(() => setShowConfetti(false), 3500);
      return () => clearTimeout(t);
    }
  }, [sim.phase]);

  function reset() {
    setSim(INITIAL);
    setShowConfetti(false);
  }

  // ---- ค่าที่ใช้วาดผล ----
  const progress =
    sim.phase === "admitted"
      ? 100
      : Math.min(100, Math.max(0, Math.round((1 - sim.yourPos / YOUR_START_POS) * 100)));
  targetRef.current = progress; // อัปเดตเป้าหมายให้ rAF (set ref ใน render ได้)
  const runnerLeft = 4 + (display / 100) * 88; // ใช้ค่า display (ลื่น) ไม่ใช่ progress (กระโดด)
  const isNear = sim.phase === "waiting" && sim.yourPos <= batch; // ใกล้ถูกปล่อยรอบหน้า
  const ratePerMin = Math.round(sim.lastRelease * (60000 / intervalMs));
  const insidePct = Math.min(100, Math.round((sim.inside / Math.max(cap, 1)) * 100));
  // ประเมินเวลารอ ~ ใช้ทรูพุตสเตดี้สเตต (คนเสร็จ/รอบ) — สื่อ trade-off ของ cap เล็ก
  const perRound = Math.max(1, Math.round(cap * 0.35));
  const estRounds = sim.phase === "waiting" ? Math.ceil(sim.yourPos / perRound) : 0;
  const estWaitSec = Math.round((estRounds * intervalMs) / 1000);
  const runnerMode: "jog" | "fast" | "cheer" =
    sim.phase === "admitted" ? "cheer" : isNear ? "fast" : "jog";

  return (
    <div className="min-h-screen bg-ink-900 px-4 py-8 text-fg">
      {/* คีย์เฟรมเฉพาะของ prototype — prefix qr- กันชนกับที่อื่น */}
      <style>{styles}</style>

      <div className="mx-auto w-full max-w-3xl space-y-5">
        <header className="space-y-1">
          <p className="font-display text-xs uppercase tracking-widest text-spot-400">Prototype · จำลอง</p>
          <h1 className="font-display text-2xl font-bold">ห้องรอ + ตัวการ์ตูนวิ่งสู่เวที</h1>
          <p className="text-sm text-fg-faint">
            จำลอง client-side ล้วน (ไม่ต่อ Redis จริง) — เลื่อนแผงคุมด้านล่างแล้วดูตัวการ์ตูนขยับตาม
          </p>
        </header>

        {/* ============ ฝั่งผู้ใช้ ============ */}
        <section className="relative overflow-hidden rounded-2xl border border-fg/10 bg-ink-850 p-6 shadow-lg sm:p-8">
          <div className="bg-spotlight pointer-events-none absolute inset-x-0 top-0 h-40" aria-hidden />

          <div className="relative flex items-center justify-between">
            <span className="flex items-center gap-2 font-display text-sm text-fg-faint">
              <EqBars className="h-4 text-brand-400" /> คุณอยู่ในห้องรอ
            </span>
            <span className="rounded-full border border-fg/10 bg-ink-900/60 px-3 py-1 text-xs text-fg-faint">
              BTS World Tour Bangkok 2026
            </span>
          </div>

          {/* ป้าย LED ตำแหน่งคิว */}
          <div className="relative mt-5 text-center">
            <p className="font-display text-xs text-fg-faint">
              {sim.phase === "admitted" ? "สถานะ" : "ตำแหน่งของคุณ"}
            </p>
            <p
              className="text-led mt-1 text-6xl font-bold text-spot-300"
              style={{ textShadow: "0 0 28px oklch(0.8 0.15 78 / 0.45)" }}
            >
              {sim.phase === "admitted" ? "ถึงคิว!" : sim.phase === "soldout" ? "เต็ม" : sim.yourPos.toLocaleString()}
            </p>
            <p className="mt-1 text-sm text-fg-faint">
              {sim.phase === "waiting" && `อีก ${sim.yourPos.toLocaleString()} คนถึงคิวคุณ`}
              {sim.phase === "admitted" && "🎉 พาเข้าหน้าเลือกที่นั่งอัตโนมัติ…"}
              {sim.phase === "soldout" && "ที่นั่งถูกจองหมดก่อนถึงคิวคุณ"}
              {sim.phase === "done" && "คิวหมดแล้ว"}
            </p>
            {sim.phase === "waiting" && (
              <p className="mt-0.5 text-xs text-spot-300">
                คาดว่าอีก ~{estWaitSec >= 60 ? `${Math.ceil(estWaitSec / 60)} นาที` : `${estWaitSec} วิ`} · ปล่อยเข้าครั้งละ {cap} คนเพื่อความลื่น
              </p>
            )}
          </div>

          {/* ===== แทร็กวิ่ง: ประตู → นักวิ่ง → เวที ===== */}
          <div className="relative mt-6 h-24">
            {/* คอนเฟตติ */}
            {showConfetti && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
                {Array.from({ length: 18 }).map((_, i) => (
                  <span
                    key={i}
                    className="qr-confetti"
                    style={{
                      left: `${50 + (Math.random() * 46 - 8)}%`,
                      background: ["#e5484d", "#f5a524", "#ffd166", "#fff"][i % 4],
                      animationDelay: `${Math.random() * 0.6}s`,
                      animationDuration: `${1.4 + Math.random()}s`,
                    }}
                  />
                ))}
              </div>
            )}

            {/* ประตูเข้า (ซ้าย) */}
            <div className="absolute bottom-7 left-0 text-center">
              <div className="text-2xl">🚪</div>
              <div className="mt-0.5 font-display text-[10px] text-fg-faint">เข้าคิว</div>
            </div>

            {/* เวที (ขวา) — เรืองแสงตอนถึงคิว */}
            <div
              className={`absolute bottom-6 right-0 text-center transition-all duration-500 ${
                sim.phase === "admitted" ? "scale-110" : "opacity-80"
              }`}
            >
              <div className="flex items-end justify-center gap-1">
                <EqBars className="h-5 text-brand-400" />
                <span className="text-3xl" style={{ filter: "drop-shadow(0 0 10px oklch(0.7 0.2 25 / .6))" }}>
                  🎤
                </span>
              </div>
              <div className="mt-0.5 font-display text-[10px] text-spot-300">เวที · เลือกที่นั่ง</div>
            </div>

            {/* เส้นทาง (จุดไข่ปลา) */}
            <div className="absolute bottom-9 left-10 right-12 border-t-2 border-dashed border-fg/15" aria-hidden />

            {/* นักวิ่ง (SVG ขยับลื่น — glide ต่อเนื่องตาม interval ไม่กระโดดเป็นสเต็ป) */}
            <div
              className="absolute bottom-7"
              style={{
                left: `${runnerLeft}%`,
                transform: "translateX(-50%)",
              }}
            >
              {/* ฝุ่นวิ่งต่อเนื่อง */}
              {sim.phase === "waiting" && (
                <>
                  <span className="qr-dust" style={{ left: "-1px", bottom: "1px" }} />
                  <span className="qr-dust" style={{ left: "-7px", bottom: "6px", animationDelay: ".2s" }} />
                  <span className="qr-dust" style={{ left: "-13px", bottom: "3px", animationDelay: ".4s" }} />
                </>
              )}
              {/* เงาใต้เท้า */}
              <span className="qr-shadow" aria-hidden />
              {/* ตัวละคร (emoji อ่านออกทันที + เด้ง/เอียง ลื่นต่อเนื่องตาม glide) */}
              <span
                className={`block leading-none qr-emoji-${runnerMode}`}
                style={{ fontSize: "40px", filter: "drop-shadow(0 4px 6px oklch(0.55 0.18 25 / .55))" }}
              >
                {runnerMode === "cheer" ? "🙌" : "🏃"}
              </span>
            </div>
          </div>

          {/* แถบความคืบหน้า */}
          <div className="mt-2">
            <div className="relative h-2.5 overflow-hidden rounded-full bg-ink-700">
              <div
                className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-brand-700 to-brand-500"
                style={{ width: `${display}%` }}
              >
                <span className="animate-shimmer absolute inset-y-0 w-1/3 bg-white/25" aria-hidden />
              </div>
            </div>
            <p className="mt-2 text-center text-xs text-fg-faint">
              {isNear && sim.phase === "waiting"
                ? "ใกล้แล้ว! เตรียมเลือกที่นั่ง — อย่าปิดหน้านี้"
                : "ระบบจะพาเข้าหน้าเลือกที่นั่งอัตโนมัติเมื่อถึงคิว"}
            </p>
          </div>
        </section>

        {/* ============ ฝั่งแอดมิน ============ */}
        <section className="rounded-2xl border border-fg/10 bg-ink-850 p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">แผงคุมการปล่อยคิว (แอดมิน)</h2>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                running ? "bg-brand-500/15 text-brand-400" : "bg-fg/10 text-fg-faint"
              }`}
            >
              {running ? "● กำลังปล่อยคิว" : "❚❚ หยุดชั่วคราว"}
            </span>
          </div>

          {/* ตัวเลขสด */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="รออยู่ในคิว" value={sim.queue.toLocaleString()} tone="fg" />
            <Stat label={`อยู่ข้างใน / cap`} value={`${sim.inside} / ${cap}`} tone="brand" sub={`${insidePct}%`} />
            <Stat label="ที่นั่งเหลือ" value={sim.seatsLeft.toLocaleString()} tone="spot" />
            <Stat label="ปล่อยล่าสุด" value={`${sim.lastRelease}`} tone="fg" sub={`~${ratePerMin.toLocaleString()}/นาที`} />
          </div>

          {/* แถบความจุข้างใน */}
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[11px] text-fg-faint">
              <span>ความจุข้างใน (concurrency)</span>
              <span>
                {sim.inside}/{cap}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink-700">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  insidePct >= 100 ? "bg-warning" : "bg-brand-500"
                }`}
                style={{ width: `${insidePct}%` }}
              />
            </div>
          </div>

          {/* สไลเดอร์ปรับค่า */}
          <div className="mt-5 space-y-4">
            <Slider
              label="เพดานคนข้างในพร้อมกัน (cap)"
              value={cap}
              min={5}
              max={60}
              step={1}
              onChange={setCap}
            />
            <Slider
              label="เติมต่อรอบสูงสุด (batch)"
              value={batch}
              min={1}
              max={50}
              step={1}
              onChange={setBatch}
            />
            <Slider
              label="ปล่อยทุกกี่วินาที (interval)"
              value={intervalMs}
              min={500}
              max={4000}
              step={250}
              onChange={setIntervalMs}
              format={(v) => `${(v / 1000).toFixed(2)} วิ`}
            />
          </div>

          {/* สูตรที่ใช้ */}
          <p className="mt-4 rounded-lg border border-fg/10 bg-ink-900/60 px-3 py-2 text-center font-display text-xs text-fg-dim">
            กติกา: มีคนกดเสร็จ → เติมคิวถัดไปให้ครบ cap {cap} · min( เติมสูงสุด {batch}, ช่องว่างใน cap,
            ที่นั่งเหลือ {sim.seatsLeft} ) → รอบล่าสุดปล่อย{" "}
            <span className="text-brand-400">{sim.lastRelease}</span> คน
          </p>

          {/* ปุ่มสั่งงาน */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => setRunning((r) => !r)}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-400"
            >
              {running ? "หยุดปล่อยคิว" : "เริ่มปล่อยคิว"}
            </button>
            <button
              onClick={tick}
              className="rounded-lg border border-fg/15 bg-ink-900 px-4 py-2 text-sm font-medium text-fg transition hover:border-fg/30"
            >
              ปล่อยรอบถัดไป (เอง)
            </button>
            <button
              onClick={reset}
              className="rounded-lg border border-fg/15 bg-ink-900 px-4 py-2 text-sm font-medium text-fg-faint transition hover:border-fg/30"
            >
              รีเซ็ต
            </button>
          </div>
        </section>

        <p className="text-center text-xs text-fg-faint">
          🔗 แมปกับของจริง: <code className="text-fg-dim">lib/queue.ts → admitNext()</code> +{" "}
          <code className="text-fg-dim">api/queue/status</code> · cap/refill = ส่วนที่จะเพิ่มเข้าไป
        </p>
      </div>
    </div>
  );
}

// ---- ตัวละครนักวิ่ง (SVG + CSS animation — แขน/ขามีมือ-เท้าเป็นจุดกลม อ่านเป็นคนวิ่งชัด) ----
function Runner({ mode }: { mode: "jog" | "fast" | "cheer" }) {
  return (
    <svg className={`qr-svg qr-${mode}`} viewBox="0 0 52 60" width="48" height="56" aria-hidden>
      {/* ขาหลัง + แขนหลัง (จางลงให้รู้สึกมีมิติ) */}
      <g className="qr-leg-b">
        <rect x="21.75" y="34" width="5" height="18" rx="2.5" />
        <circle cx="24.25" cy="52" r="3.2" />
      </g>
      <g className="qr-arm-b">
        <rect x="24.4" y="18" width="4" height="13" rx="2" />
        <circle cx="26.4" cy="31.5" r="2.6" />
      </g>
      {/* ลำตัว + หัว (เอียงไปข้างหน้า = ท่าวิ่ง) */}
      <line className="qr-torso" x1="27" y1="16" x2="23" y2="35" />
      <circle className="qr-head" cx="30" cy="9" r="7" />
      {/* แขนหน้า + ขาหน้า */}
      <g className="qr-arm-a">
        <rect x="24.4" y="18" width="4" height="13" rx="2" />
        <circle cx="26.4" cy="31.5" r="2.6" />
      </g>
      <g className="qr-leg-a">
        <rect x="21.75" y="34" width="5" height="18" rx="2.5" />
        <circle cx="24.25" cy="52" r="3.2" />
      </g>
    </svg>
  );
}

// ---- การ์ดตัวเลขสถิติ ----
function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: "fg" | "brand" | "spot";
  sub?: string;
}) {
  const color = tone === "brand" ? "text-brand-400" : tone === "spot" ? "text-spot-300" : "text-fg";
  return (
    <div className="rounded-xl border border-fg/10 bg-ink-900/60 p-3 text-center">
      <p className="text-[11px] text-fg-faint">{label}</p>
      <p className={`mt-0.5 font-display text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-fg-faint">{sub}</p>}
    </div>
  );
}

// ---- สไลเดอร์ ----
function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-fg-dim">{label}</span>
        <span className="font-display font-semibold text-fg">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: "#e5484d" }}
      />
    </div>
  );
}

// ---- CSS keyframes (inject ครั้งเดียว) ----
const styles = `
.qr-svg { overflow: visible; }
.qr-svg .qr-head { fill: currentColor; }
.qr-svg .qr-torso { stroke: currentColor; stroke-width: 6.5; stroke-linecap: round; }
.qr-svg .qr-arm-a *, .qr-svg .qr-leg-a * { fill: currentColor; }
.qr-svg .qr-arm-b, .qr-svg .qr-leg-b { opacity: .45; }
.qr-svg .qr-arm-b *, .qr-svg .qr-leg-b * { fill: currentColor; }
.qr-leg-a, .qr-leg-b { transform-box: view-box; transform-origin: 24px 34px; }
.qr-arm-a, .qr-arm-b { transform-box: view-box; transform-origin: 26px 18px; }

/* วิ่ง — ขาแยก "หน้า/หลัง" ตลอด (ไม่ทับแนวตั้ง) → อ่านเป็นวิ่งทุกเฟรม */
.qr-jog .qr-leg-a { animation: qr-legA .6s ease-in-out infinite; }
.qr-jog .qr-leg-b { animation: qr-legB .6s ease-in-out infinite; }
.qr-jog .qr-arm-a { animation: qr-armA .6s ease-in-out infinite; }
.qr-jog .qr-arm-b { animation: qr-armB .6s ease-in-out infinite; }
.qr-jog { animation: qr-bob .3s ease-in-out infinite; }

/* วิ่งเร็ว (ใกล้ถึงคิว) */
.qr-fast .qr-leg-a { animation: qr-legA .3s linear infinite; }
.qr-fast .qr-leg-b { animation: qr-legB .3s linear infinite; }
.qr-fast .qr-arm-a { animation: qr-armA .3s linear infinite; }
.qr-fast .qr-arm-b { animation: qr-armB .3s linear infinite; }
.qr-fast { animation: qr-bob .15s linear infinite; }

/* ฉลอง (ถึงคิว) — ชูแขนเป็นรูป V + เด้ง */
.qr-cheer { animation: qr-jump .6s ease-in-out infinite; }
.qr-cheer .qr-arm-a { transform: rotate(150deg); }
.qr-cheer .qr-arm-b { transform: rotate(-150deg); }
.qr-cheer .qr-leg-a { transform: rotate(-12deg); }
.qr-cheer .qr-leg-b { transform: rotate(12deg); }

/* forward = ลบ (ไปทางเวที), back = บวก → ขาหน้า(A)ลบ ขาหลัง(B)บวก แยกตลอด */
@keyframes qr-legA { 0%{transform:rotate(-42deg)} 50%{transform:rotate(-16deg)} 100%{transform:rotate(-42deg)} }
@keyframes qr-legB { 0%{transform:rotate(42deg)} 50%{transform:rotate(16deg)} 100%{transform:rotate(42deg)} }
@keyframes qr-armA { 0%{transform:rotate(38deg)} 50%{transform:rotate(14deg)} 100%{transform:rotate(38deg)} }
@keyframes qr-armB { 0%{transform:rotate(-38deg)} 50%{transform:rotate(-14deg)} 100%{transform:rotate(-38deg)} }
@keyframes qr-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2.5px)} }
@keyframes qr-jump { 0%,100%{transform:translateY(0)} 35%{transform:translateY(-10px)} 65%{transform:translateY(0)} }

.qr-shadow { position:absolute; left:50%; bottom:-3px; width:30px; height:6px; margin-left:-15px; border-radius:9999px; background: radial-gradient(closest-side, oklch(0 0 0 / .45), transparent); animation: qr-shadowp .31s ease-in-out infinite; }
@keyframes qr-shadowp { 0%,100%{transform:scaleX(1);opacity:.5} 50%{transform:scaleX(.72);opacity:.32} }

.qr-dust { position:absolute; width:7px; height:7px; border-radius:9999px; background:oklch(0.72 0.03 70 / .5); animation: qr-dustfade .55s linear infinite; }
@keyframes qr-dustfade { 0%{opacity:.5;transform:translateX(0) scale(1)} 100%{opacity:0;transform:translateX(-18px) scale(.25)} }

.qr-confetti { position:absolute; top:-12px; width:7px; height:10px; border-radius:2px; animation: qr-fall 1.6s ease-in forwards; }
@keyframes qr-fall { 0%{opacity:1;transform:translateY(-10px) rotate(0)} 100%{opacity:0;transform:translateY(150px) rotate(340deg)} }

/* นักวิ่ง emoji — เด้ง+เอียง (flip ให้หันขวาเข้าหาเวที) */
.qr-emoji-jog { display:inline-block; animation: qr-ejog .5s ease-in-out infinite; }
.qr-emoji-fast { display:inline-block; animation: qr-efast .26s ease-in-out infinite; }
.qr-emoji-cheer { display:inline-block; animation: qr-ejump .55s ease-in-out infinite; }
@keyframes qr-ejog { 0%,100%{transform:scaleX(-1) translateY(0) rotate(-5deg)} 50%{transform:scaleX(-1) translateY(-4px) rotate(3deg)} }
@keyframes qr-efast { 0%,100%{transform:scaleX(-1) translateY(0) rotate(-9deg)} 50%{transform:scaleX(-1) translateY(-7px) rotate(5deg)} }
@keyframes qr-ejump { 0%,100%{transform:translateY(0) scale(1)} 40%{transform:translateY(-11px) scale(1.09)} }

@media (prefers-reduced-motion: reduce) {
  .qr-jog, .qr-fast, .qr-cheer, .qr-svg *, .qr-emoji-jog, .qr-emoji-fast, .qr-emoji-cheer, .qr-dust, .qr-confetti, .qr-shadow { animation: none !important; }
}
`;
