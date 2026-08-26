"use client";

// ค้นหา/กรองรายการงาน (Phase 2.4, docs/24)
// กรองในเครื่องผู้ใช้ล้วน — หน้ารายการเป็นหน้าแคช (revalidate 60) และงานที่เปิดขายมีหลักสิบ
//   → พิมพ์แล้วผลขึ้นทันที ไม่ยิงเซิร์ฟเวอร์เพิ่มแม้แต่ครั้งเดียวในวันที่คนแห่เข้าเว็บ
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ConcertCard } from "@/components/concert-card";
import {
  filterConcerts,
  countByStatus,
  type ConcertFilterStatus,
} from "@/lib/concert-filter";

export type BrowseConcert = {
  id: string;
  title: string;
  slug: string;
  venue: string;
  eventAt: string;
  saleStartAt: string;
  saleEndAt: string;
  status: string;
  coverImageUrl: string | null;
  zones: { price: string }[];
};

const TABS: { value: ConcertFilterStatus; label: string }[] = [
  { value: "ALL", label: "ทั้งหมด" },
  { value: "ON_SALE", label: "กำลังขาย" },
  { value: "SCHEDULED", label: "เร็ว ๆ นี้" },
  { value: "SOLD_OUT", label: "บัตรหมด" },
];

export function ConcertBrowser({ concerts }: { concerts: BrowseConcert[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ConcertFilterStatus>("ALL");

  const counts = useMemo(() => countByStatus(concerts), [concerts]);
  const shown = useMemo(
    () => filterConcerts(concerts, { query, status }),
    [concerts, query, status]
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่องาน หรือสถานที่"
            aria-label="ค้นหางาน"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setStatus(t.value)}
              aria-pressed={status === t.value}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                status === t.value
                  ? "border-brand-500/40 bg-brand-500/15 text-brand-300"
                  : "border-fg/15 text-fg-dim hover:border-fg/30 hover:text-fg"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-fg-faint">{counts[t.value]}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 py-16 text-center text-fg-faint">
          ไม่พบงานที่ตรงกับที่ค้นหา
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <ConcertCard
              key={c.id}
              concert={{
                title: c.title,
                slug: c.slug,
                venue: c.venue,
                eventAt: new Date(c.eventAt),
                saleStartAt: new Date(c.saleStartAt),
                saleEndAt: new Date(c.saleEndAt),
                status: c.status,
                coverImageUrl: c.coverImageUrl,
                zones: c.zones,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
