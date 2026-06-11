// Concert card — แสดงในหน้า landing + listing (โทนเวทีมืด)
// โปสเตอร์เต็มด้านบน + ป้ายวันที่แบบบัตรคอนเสิร์ต + equalizer ตอนกำลังขาย
import Link from "next/link";
import { MapPin, Music2 } from "lucide-react";
import { formatTHB, formatThaiDateParts } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { EqBars } from "@/components/eq-bars";

interface Zone {
  price: { toString(): string };
}

interface Concert {
  id: bigint;
  title: string;
  slug: string;
  venue: string;
  eventAt: Date;
  saleStartAt: Date;
  status: string;
  coverImageUrl: string | null;
  zones: Zone[];
}

export function ConcertCard({ concert }: { concert: Concert }) {
  // หาราคาต่ำสุดจากทุก zone (ราคาเริ่มต้น)
  const minPrice = Math.min(...concert.zones.map((z) => Number(z.price.toString())));
  const isOnSale = concert.status === "ON_SALE";
  const isUpcoming = concert.status === "SCHEDULED";
  const isSoldOut = concert.status === "SOLD_OUT";
  const date = formatThaiDateParts(concert.eventAt);

  return (
    <Link
      href={`/concerts/${concert.slug}`}
      className="group block overflow-hidden rounded-xl border border-fg/10 bg-ink-850 shadow-md
        transition-all duration-200 hover:-translate-y-1 hover:border-brand-500/40 hover:shadow-lg
        hover:shadow-glow-brand focus-visible:-translate-y-1"
    >
      {/* โปสเตอร์ — ถ้าไม่มีรูปใช้พื้นเวที + โน้ตดนตรี */}
      <div className="bg-stage relative aspect-[3/2] overflow-hidden">
        {concert.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={concert.coverImageUrl}
            alt={concert.title}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center text-fg/15">
            <Music2 className="size-12" />
          </div>
        )}
        {/* ไล่เงาด้านล่างให้ป้ายอ่านชัดบนรูปทุกแบบ */}
        <div
          className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink-deep/85 to-transparent"
          aria-hidden
        />

        {/* ป้ายสถานะ มุมบนซ้าย — กำลังขายมี equalizer เด้งจริง */}
        <div className="absolute left-3 top-3">
          {isOnSale && (
            <Badge tone="brand" className="border border-brand-500/30 bg-ink-deep/80 backdrop-blur-sm">
              <EqBars className="h-2.5 text-brand-400" />
              กำลังขาย
            </Badge>
          )}
          {isUpcoming && (
            <Badge tone="info" className="border border-info/20 bg-ink-deep/80 backdrop-blur-sm">
              เร็ว ๆ นี้
            </Badge>
          )}
          {isSoldOut && (
            <Badge tone="neutral" className="border border-fg/15 bg-ink-deep/80 backdrop-blur-sm">
              เต็มแล้ว
            </Badge>
          )}
        </div>

        {/* ป้ายวันที่แบบปฏิทินบัตรคอนเสิร์ต มุมล่างซ้าย */}
        <div className="absolute bottom-3 left-3 rounded-lg border border-fg/15 bg-ink-deep/85 px-2.5 py-1.5 text-center backdrop-blur-sm">
          <p className="text-led text-lg font-bold leading-none text-fg">{date.day}</p>
          <p className="mt-0.5 text-[10px] font-medium leading-none text-fg-dim">{date.month}</p>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <h3 className="line-clamp-2 font-display font-semibold leading-snug text-fg transition-colors group-hover:text-brand-300">
          {concert.title}
        </h3>

        <p className="flex items-center gap-1.5 text-sm text-fg-faint">
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">{concert.venue}</span>
        </p>

        <div className="flex items-end justify-between border-t border-fg/10 pt-3">
          <div>
            <span className="text-xs text-fg-faint">เริ่มต้น</span>
            <p className="text-led text-lg font-bold text-spot-300">{formatTHB(minPrice)}</p>
          </div>
          <span className="font-display text-sm font-medium text-brand-300 transition-transform group-hover:translate-x-0.5">
            {isSoldOut ? "ดูรายละเอียด" : "จองตั๋ว"} →
          </span>
        </div>
      </div>
    </Link>
  );
}
