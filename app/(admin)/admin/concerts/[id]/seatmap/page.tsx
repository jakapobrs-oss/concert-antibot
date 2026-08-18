// Admin — จัดผังที่นั่งจากรูปสถานที่จริง (Phase 2)
// อัปโหลดรูปผัง -> คลิกวาดกรอบทับโซน -> ระบบเจนที่นั่งให้เต็มกรอบตามจำนวนที่สั่ง
import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";
import { SeatmapEditor } from "@/components/seatmap-editor";

export const dynamic = "force-dynamic";

type Point = [number, number];

// polygon เก็บเป็น Json ใน DB — ตรวจรูปร่างก่อนส่งให้ฝั่ง client เพื่อไม่ให้ข้อมูลเพี้ยนทำ UI พัง
function parsePolygon(value: unknown): Point[] | null {
  if (!Array.isArray(value)) return null;
  const points: Point[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    const [x, y] = item;
    if (typeof x !== "number" || typeof y !== "number") return null;
    points.push([x, y]);
  }
  return points.length >= 3 ? points : null;
}

export default async function AdminSeatmapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(id) },
    select: {
      id: true,
      title: true,
      venue: true,
      layoutImageBase64: true,
      layoutImageWidth: true,
      layoutImageHeight: true,
      zones: {
        orderBy: { price: "desc" },
        select: {
          id: true,
          name: true,
          price: true,
          color: true,
          totalSeats: true,
          polygon: true,
          seats: {
            select: { x: true, y: true, status: true },
            orderBy: [{ rowLabel: "asc" }, { seatNumber: "asc" }],
          },
        },
      },
    },
  });

  if (!concert) notFound();

  // BigInt/Decimal ส่งข้าม server->client ตรง ๆ ไม่ได้ ต้องแปลงเป็น string ก่อน
  const zones = concert.zones.map((zone) => ({
    id: zone.id.toString(),
    name: zone.name,
    price: zone.price.toString(),
    color: zone.color,
    totalSeats: zone.totalSeats,
    polygon: parsePolygon(zone.polygon),
    seats: zone.seats.map((seat) => ({
      x: seat.x,
      y: seat.y,
      status: seat.status as string,
    })),
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
            {concert.venue} · อัปโหลดรูปผังของสถานที่นี้ แล้วคลิกวาดกรอบทับแต่ละโซน
            ระบบจะโปรยที่นั่งให้เต็มกรอบตามจำนวนที่สั่ง
          </p>
        </div>

        <SeatmapEditor
          concertId={concert.id.toString()}
          layout={{
            base64: concert.layoutImageBase64,
            width: concert.layoutImageWidth,
            height: concert.layoutImageHeight,
          }}
          zones={zones}
        />
      </main>
    </>
  );
}
