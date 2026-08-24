// Admin — จัดผังที่นั่งจากรูปสถานที่จริง (Phase 2)
// อัปโหลดรูปผัง -> นำเข้าข้อมูลโซนจาก Excel -> คลิกวาดกรอบทับโซนและกรอบเวที
//
// 📌 ผังนี้เป็น "ผังบอกตำแหน่ง" ระดับโซน ไม่ใช่ผังที่นั่งรายตัว
//    จำนวนที่นั่งมาจากตัวเลขที่กรอก/นำเข้า ไม่ได้คำนวณจากขนาดกรอบ
import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";
import { SeatmapEditor } from "@/components/seatmap-editor";
import { parsePolygon } from "@/lib/seatmap/polygon";

export const dynamic = "force-dynamic";

export default async function AdminSeatmapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const concertId = BigInt(id);

  const concert = await prisma.concert.findUnique({
    where: { id: concertId },
    select: {
      id: true,
      title: true,
      venue: true,
      layoutImageBase64: true,
      layoutImageWidth: true,
      layoutImageHeight: true,
      stagePolygon: true,
      zones: {
        orderBy: { price: "desc" },
        select: {
          id: true,
          name: true,
          tier: true,
          price: true,
          color: true,
          totalSeats: true,
          polygon: true,
        },
      },
    },
  });

  if (!concert) notFound();

  // นับที่นั่งที่ขายแล้ว/จองค้างแบบ aggregate — ไม่ดึงแถวที่นั่งจริงมาทั้งหมด
  // ผังจริงมีได้ถึงหลักหมื่นที่นั่ง (BABYMONSTER = 11,000) ถ้าดึงรายตัวหน้านี้จะอืดโดยไม่ได้ใช้อะไรเลย
  const seatCounts = await prisma.seat.groupBy({
    by: ["zoneId", "status"],
    where: { zone: { concertId }, status: { in: ["SOLD", "HELD"] } },
    _count: { _all: true },
  });

  const countOf = (zoneId: bigint, status: "SOLD" | "HELD") =>
    seatCounts.find((row) => row.zoneId === zoneId && row.status === status)?._count._all ?? 0;

  // BigInt/Decimal ส่งข้าม server->client ตรง ๆ ไม่ได้ ต้องแปลงเป็น string ก่อน
  const zones = concert.zones.map((zone) => ({
    id: zone.id.toString(),
    name: zone.name,
    tier: zone.tier,
    price: zone.price.toString(),
    color: zone.color,
    totalSeats: zone.totalSeats,
    polygon: parsePolygon(zone.polygon),
    soldCount: countOf(zone.id, "SOLD"),
    heldCount: countOf(zone.id, "HELD"),
  }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Link
          href={`/admin/concerts/${id}`}
          className="text-sm text-fg-faint transition-colors hover:text-brand-300"
        >
          ← กลับไปหน้าคอนเสิร์ต
        </Link>

        <div className="mb-6 mt-2">
          <h1 className="font-display text-2xl font-bold text-fg">ผังที่นั่ง — {concert.title}</h1>
          <p className="mt-1 text-sm text-fg-faint">
            {concert.venue} · นำเข้าข้อมูลโซนจากไฟล์ Excel แล้ววาดกรอบทับรูปผังให้ตรงกับแต่ละโซน
            ผังนี้บอกว่าโซนไหนอยู่ตรงไหนของเวที ไม่ได้คิดจำนวนบัตรจากขนาดกรอบ
          </p>
        </div>

        <SeatmapEditor
          concertId={concert.id.toString()}
          layout={{
            base64: concert.layoutImageBase64,
            width: concert.layoutImageWidth,
            height: concert.layoutImageHeight,
          }}
          stagePolygon={parsePolygon(concert.stagePolygon)}
          zones={zones}
        />
      </main>
    </>
  );
}
