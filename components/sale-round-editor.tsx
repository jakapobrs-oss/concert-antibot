"use client";

// ============================================================
// แอดมิน — ตั้งรอบกดบัตรของคอนเสิร์ต (Phase 2)
// ============================================================
// ตารางรอบ + ฟอร์มเพิ่ม/แก้ไข/ลบ ในหน้าเดียว
//
// ⚠️ เรื่องโซนเวลา (timezone) ที่พลาดง่าย:
//    <input type="datetime-local"> คืนค่าเป็นสตริงลอย ๆ เช่น "2026-08-25T19:00" ที่ไม่มีโซนเวลาติดมา
//    ถ้าส่งสตริงนี้ให้เซิร์ฟเวอร์ new Date() ตรง ๆ เซิร์ฟเวอร์จะตีความเป็นเวลาท้องถิ่น "ของเซิร์ฟเวอร์"
//    ซึ่งบน Vercel คือ UTC -> รอบเลื่อนไป 7 ชั่วโมงจากที่แอดมินตั้งใจ (รอบสมาชิกไปเปิดตอนตี 12)
//    จึงแปลงเป็น ISO (มีโซนเวลาชัดเจน) ตั้งแต่ฝั่งเบราว์เซอร์ที่รู้โซนเวลาจริงของแอดมิน
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Clock, Pencil, Plus, Trash2, Wand2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createSaleRound, deleteSaleRound, updateSaleRound } from "@/app/actions/sale-round";

export interface RoundRow {
  id: string;
  name: string;
  audience: "MEMBER_ONLY" | "PUBLIC";
  /** ISO string — แปลงมาจาก Date ฝั่งเซิร์ฟเวอร์แล้ว */
  startAt: string;
  endAt: string;
  orderCount: number;
}

const DEMO_ROUND_MINUTES = 30; // ความยาวรอบสาธิตที่ปุ่ม "เติมเวลาสาธิต" ใส่ให้

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO -> ค่าที่ <input type="datetime-local"> ต้องการ (เวลาท้องถิ่นของเบราว์เซอร์) */
function isoToLocalInput(iso: string): string {
  return toLocalInput(new Date(iso));
}

/** ค่าจาก input (เวลาท้องถิ่น ไม่มีโซน) -> ISO ที่ระบุโซนเวลาชัดเจน */
function localInputToIso(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function localInputAfter(minutesFromNow: number): string {
  return toLocalInput(new Date(Date.now() + minutesFromNow * 60_000));
}

function formatWindow(startIso: string, endIso: string): string {
  const fmt = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
  return `${fmt.format(new Date(startIso))} — ${fmt.format(new Date(endIso))}`;
}

type Draft = {
  roundId: string | null; // null = กำลังเพิ่มรอบใหม่
  name: string;
  audience: "MEMBER_ONLY" | "PUBLIC";
  startAt: string;
  endAt: string;
};

const EMPTY_DRAFT: Draft = {
  roundId: null,
  name: "",
  audience: "MEMBER_ONLY",
  startAt: "",
  endAt: "",
};

export function SaleRoundEditor({ concertId, rounds }: { concertId: string; rounds: RoundRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // นาฬิกาไว้บอกสถานะ "กำลังเปิดอยู่" — ตั้งค่าหลัง mount เท่านั้น
  // (ถ้าคำนวณตอน render จะได้เวลาเซิร์ฟเวอร์ ≠ เวลาเบราว์เซอร์ -> hydration ไม่ตรงกัน)
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  function statusOf(round: RoundRow): { label: string; tone: "success" | "info" | "neutral" } {
    if (now === null) return { label: "—", tone: "neutral" };
    const start = new Date(round.startAt).getTime();
    const end = new Date(round.endAt).getTime();
    if (now < start) return { label: "ยังไม่เริ่ม", tone: "info" };
    if (now >= end) return { label: "จบแล้ว", tone: "neutral" };
    return { label: "กำลังเปิด", tone: "success" };
  }

  async function submit() {
    if (!draft) return;
    setBusy(true);
    setError(null);

    const startAt = localInputToIso(draft.startAt);
    const endAt = localInputToIso(draft.endAt);
    if (!startAt || !endAt) {
      setError("กรุณากรอกเวลาเปิดและปิดรอบให้ครบ");
      setBusy(false);
      return;
    }

    const payload = { concertId, name: draft.name, audience: draft.audience, startAt, endAt };
    const result = draft.roundId
      ? await updateSaleRound({ ...payload, roundId: draft.roundId })
      : await createSaleRound(payload);

    if (result.ok) {
      setDraft(null);
      router.refresh();
    } else {
      setError(result.error);
    }
    setBusy(false);
  }

  async function remove(round: RoundRow) {
    setBusy(true);
    setError(null);
    const result = await deleteSaleRound({ concertId, roundId: round.id });
    if (result.ok) router.refresh();
    else setError(result.error);
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      {/* ---------- ตารางรอบที่มีอยู่ ---------- */}
      {rounds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 p-6">
          <p className="text-sm leading-relaxed text-fg-faint">
            ยังไม่ได้ตั้งรอบ — คอนเสิร์ตนี้{" "}
            <span className="font-medium text-fg-dim">ใครก็กดได้ทันทีที่เปิดขาย</span> (พฤติกรรมเดิม)
            <br />
            ถ้าอยากให้สมาชิกกดก่อน ให้เพิ่ม 2 รอบต่อกัน: รอบสมาชิก แล้วรอบทั่วไป
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rounds.map((round) => {
            const status = statusOf(round);
            return (
              <div
                key={round.id}
                data-round-id={round.id}
                className="rounded-xl border border-fg/10 bg-ink-850 p-4 transition-colors hover:border-fg/20"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-fg">{round.name}</span>
                      <Badge tone={round.audience === "MEMBER_ONLY" ? "info" : "neutral"}>
                        {round.audience === "MEMBER_ONLY" ? "สมาชิกเท่านั้น" : "ทั่วไป"}
                      </Badge>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-faint">
                      <Clock className="size-3.5 shrink-0" aria-hidden />
                      {formatWindow(round.startAt, round.endAt)}
                    </p>
                    {round.orderCount > 0 && (
                      <p className="mt-0.5 text-xs text-fg-faint">
                        มีคำสั่งซื้อเกิดในรอบนี้ {round.orderCount} รายการ
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      leftIcon={<Pencil className="size-3.5" />}
                      onClick={() => {
                        setError(null); // กัน error จากการลบรอบก่อนหน้าค้างมาโผล่ในฟอร์มแก้ไข
                        setDraft({
                          roundId: round.id,
                          name: round.name,
                          audience: round.audience,
                          startAt: isoToLocalInput(round.startAt),
                          endAt: isoToLocalInput(round.endAt),
                        });
                      }}
                    >
                      แก้ไข
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      leftIcon={<Trash2 className="size-3.5" />}
                      onClick={() => remove(round)}
                    >
                      ลบ
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ข้อผิดพลาดที่เกิดตอนไม่ได้เปิดฟอร์ม (เช่นกดลบรอบที่มีคำสั่งซื้อ)
          ต้องมีที่แสดงของตัวเอง ไม่งั้นกดลบแล้วหน้าจอเงียบ แอดมินจะนึกว่าปุ่มเสีย */}
      {error && draft === null && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-danger">
          <AlertCircle className="size-4 shrink-0" /> {error}
        </p>
      )}

      {/* ---------- ฟอร์มเพิ่ม/แก้ไข ---------- */}
      {draft === null ? (
        <Button
          variant="subtle"
          leftIcon={<Plus className="size-4" />}
          onClick={() => {
            setDraft(EMPTY_DRAFT);
            setError(null);
          }}
        >
          เพิ่มรอบ
        </Button>
      ) : (
        <div className="rounded-xl border border-fg/15 bg-ink-900/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-fg">
              {draft.roundId ? "แก้ไขรอบ" : "เพิ่มรอบใหม่"}
            </h3>
            <button
              type="button"
              aria-label="ยกเลิก"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              className="text-fg-faint transition-colors hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-fg-dim">ชื่อรอบ</span>
              <input
                type="text"
                value={draft.name}
                placeholder="เช่น รอบสมาชิก"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full rounded-md border border-fg/15 bg-transparent px-3 py-2 text-fg placeholder:text-fg-faint/60"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-fg-dim">ใครเข้าได้</span>
              <select
                value={draft.audience}
                onChange={(e) => setDraft({ ...draft, audience: e.target.value as Draft["audience"] })}
                className="w-full rounded-md border border-fg/15 bg-transparent px-3 py-2 text-fg"
              >
                <option value="MEMBER_ONLY" className="bg-ink-900">
                  สมาชิกเท่านั้น
                </option>
                <option value="PUBLIC" className="bg-ink-900">
                  ทั่วไป (ทุกคน รวมสมาชิก)
                </option>
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-fg-dim">เปิดรอบ</span>
              <input
                type="datetime-local"
                value={draft.startAt}
                onChange={(e) => setDraft({ ...draft, startAt: e.target.value })}
                className="w-full rounded-md border border-fg/15 bg-transparent px-3 py-2 text-fg [color-scheme:dark]"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-fg-dim">ปิดรอบ</span>
              <input
                type="datetime-local"
                value={draft.endAt}
                onChange={(e) => setDraft({ ...draft, endAt: e.target.value })}
                className="w-full rounded-md border border-fg/15 bg-transparent px-3 py-2 text-fg [color-scheme:dark]"
              />
            </label>
          </div>

          {error && (
            <p role="alert" className="mt-3 flex items-center gap-1.5 text-sm text-danger">
              <AlertCircle className="size-4 shrink-0" /> {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={submit}>
              {draft.roundId ? "บันทึกการแก้ไข" : "เพิ่มรอบ"}
            </Button>
            {/* ปุ่มช่วยตอนสาธิต — ตั้งรอบที่เปิด "เดี๋ยวนี้" ได้ในคลิกเดียว ไม่ต้องนั่งกดปฏิทิน */}
            <Button
              variant="ghost"
              disabled={busy}
              leftIcon={<Wand2 className="size-3.5" />}
              onClick={() =>
                setDraft({
                  ...draft,
                  startAt: localInputAfter(0),
                  endAt: localInputAfter(DEMO_ROUND_MINUTES),
                })
              }
            >
              เติมเวลาสาธิต (เริ่มเดี๋ยวนี้ {DEMO_ROUND_MINUTES} นาที)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
