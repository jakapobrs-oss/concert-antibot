// Concert card — แสดงในหน้า landing + listing
import Link from "next/link";
import { MapPin, CalendarDays, Music2 } from "lucide-react";
import { formatTHB, formatThaiDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

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

  return (
    <Link
      href={`/concerts/${concert.slug}`}
      className="group block overflow-hidden rounded-xl border border-neutral-200/80 bg-white shadow-sm
        transition-all duration-200 hover:-translate-y-1 hover:border-neutral-300 hover:shadow-lg
        focus-visible:-translate-y-1 focus-visible:shadow-lg"
    >
      {/* โปสเตอร์ — ถ้าไม่มีรูปใช้พื้นไล่เฉดแบรนด์ */}
      <div className="relative aspect-[3/2] overflow-hidden bg-stage">
        {concert.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={concert.coverImageUrl}
            alt={concert.title}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center text-white/25">
            <Music2 className="size-12" />
          </div>
        )}

        {/* ป้ายสถานะ มุมบนซ้าย */}
        <div className="absolute left-3 top-3">
          {isOnSale && <Badge tone="danger" dot>กำลังขาย</Badge>}
          {isUpcoming && <Badge tone="info">เร็ว ๆ นี้</Badge>}
          {isSoldOut && <Badge tone="neutral">เต็มแล้ว</Badge>}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <h3 className="line-clamp-2 font-semibold leading-snug text-neutral-900 group-hover:text-brand-700">
          {concert.title}
        </h3>

        <div className="space-y-1.5 text-sm text-neutral-500">
          <p className="flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">{concert.venue}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5 shrink-0" />
            {formatThaiDate(concert.eventAt)}
          </p>
        </div>

        <div className="flex items-end justify-between border-t border-neutral-100 pt-3">
          <div>
            <span className="text-xs text-neutral-400">เริ่มต้น</span>
            <p className="font-semibold text-neutral-900">{formatTHB(minPrice)}</p>
          </div>
          <span className="text-sm font-medium text-brand-600 transition-transform group-hover:translate-x-0.5">
            {isSoldOut ? "ดูรายละเอียด" : "จองตั๋ว"} →
          </span>
        </div>
      </div>
    </Link>
  );
}
