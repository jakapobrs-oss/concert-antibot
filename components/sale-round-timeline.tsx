"use client";

// ============================================================
// ฝั่งคนซื้อ — ตารางรอบกดบัตรของคอนเสิร์ต (Phase 2)
// ============================================================
// แสดง "ตารางรอบสาธารณะ" เท่านั้น (ใครกดได้ตอนไหน) — ไม่บอกว่า "คุณ" เข้าได้ไหม
//
// ทำไมไม่เอาสิทธิ์ของผู้ใช้มาแสดงตรงนี้:
//   หน้ารายละเอียดคอนเสิร์ตตั้ง revalidate = 60 (แคชไว้ทั้งหน้า) เพราะเป็นหน้าที่โดนถล่มหนักสุดตอนเปิดขาย
//   ถ้าดึง session มาแสดงในหน้านี้ Next จะเปลี่ยนหน้าเป็น dynamic ทันที = แคชหายทั้งหน้า
//   คำตัดสินรายคน ("คุณยังเข้าไม่ได้ รอบทั่วไปเปิด 19:30") ไปอยู่ที่ด่านจริงคือหน้าเข้าคิว/เลือกที่นั่งแทน
//
// สถานะ "กำลังเปิด" คำนวณหลัง mount เท่านั้น — ถ้าคำนวณตอน render จะถูกแคชไปด้วย
// แล้วคนที่เปิดหน้าทีหลังจะเห็นป้ายเก่าค้างได้ถึง 60 วินาที
import { useEffect, useState } from "react";
import { CalendarClock, Sparkles } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";

export interface TimelineRound {
  id: string;
  name: string;
  audience: "MEMBER_ONLY" | "PUBLIC";
  /** ISO string */
  startAt: string;
  endAt: string;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(iso));
}

export function SaleRoundTimeline({ rounds }: { rounds: TimelineRound[] }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  if (rounds.length === 0) return null;

  const hasMemberRound = rounds.some((r) => r.audience === "MEMBER_ONLY");

  return (
    <div className="mt-5 border-t border-fg/10 pt-4">
      <p className="flex items-center gap-1.5 text-sm font-medium text-fg-dim">
        <CalendarClock className="size-4 text-brand-400" aria-hidden />
        รอบกดบัตร
      </p>

      <ol className="mt-2.5 space-y-2">
        {rounds.map((round) => {
          const start = new Date(round.startAt).getTime();
          const end = new Date(round.endAt).getTime();
          const isOpen = now !== null && now >= start && now < end;
          const isPast = now !== null && now >= end;

          return (
            <li
              key={round.id}
              className={`rounded-lg border px-3 py-2 transition-colors ${
                isOpen ? "border-success/30 bg-success/10" : "border-fg/10 bg-ink-900/40"
              } ${isPast ? "opacity-55" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium text-fg">{round.name}</span>
                {round.audience === "MEMBER_ONLY" ? (
                  <Badge tone="info">สมาชิกเท่านั้น</Badge>
                ) : (
                  <Badge tone="neutral">ทุกคน</Badge>
                )}
                {isOpen && (
                  <Badge tone="success" dot>
                    กำลังเปิด
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-fg-faint">
                {formatTime(round.startAt)} — {formatTime(round.endAt)}
              </p>
            </li>
          );
        })}
      </ol>

      {hasMemberRound && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-fg-faint">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-spot-400" aria-hidden />
          <span>
            สมาชิกกดได้ก่อนในรอบแรก —{" "}
            <Link href="/account/membership" className="text-brand-300 underline hover:text-brand-200">
              ดูสิทธิ์สมาชิกของคุณ
            </Link>
          </span>
        </p>
      )}
    </div>
  );
}
