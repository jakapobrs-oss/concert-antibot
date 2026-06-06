// Seat map page — แสดงผังที่นั่งแบบ grid ตามโซน
// 🔒 Phase 4: ต้องผ่านคิว (queue token ที่ถูก admit) ถึงเข้าได้ — กันคนข้ามคิว/บอทยิงตรง
//    ⚠️ การ "จองจริง" (seat hold + lock + payment) ยังเป็น Phase 7
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";
import { SeatMap } from "@/components/seat-map";
import { isAdmitted } from "@/lib/queue";
import { getHeldSeats } from "@/lib/seat-hold";

export const dynamic = "force-dynamic"; // ที่นั่งเปลี่ยนตลอด ต้อง fresh

export default async function SeatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ qt?: string }>;
}) {
  const { slug } = await params;
  const { qt } = await searchParams;

  const concert = await prisma.concert.findUnique({
    where: { slug },
    include: {
      zones: {
        include: {
          seats: {
            orderBy: [{ rowLabel: "asc" }, { seatNumber: "asc" }],
          },
        },
        orderBy: { price: "desc" },
      },
    },
  });

  if (!concert) notFound();

  // อนุญาตเฉพาะตอน ON_SALE
  if (concert.status !== "ON_SALE") {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-12 text-center">
          <h1 className="text-xl font-semibold mb-2">ยังไม่เปิดขาย</h1>
          <Link href={`/concerts/${slug}`} className="text-brand-600 underline">
            ← กลับไปหน้ารายละเอียด
          </Link>
        </main>
      </>
    );
  }

  // 🔒 Queue gate — ต้องมี queue token ที่ถูก admit ถึงเข้าได้
  // ไม่มี token หรือ token ยังไม่ถูกปล่อย → เด้งไปห้องรอ
  const admitted = qt ? await isAdmitted(qt, concert.id.toString()) : false;
  if (!admitted) {
    redirect(`/concerts/${slug}/queue`);
  }

  // ดึงที่นั่งที่ถูก hold อยู่ใน Redis (real-time — คนอื่นกำลังจอง) เพื่อแสดงเป็น HELD
  const allSeatIds = concert.zones.flatMap((z) => z.seats.map((s) => s.id.toString()));
  const heldSet = await getHeldSeats(allSeatIds);

  // serialize ข้อมูลส่งให้ client component (BigInt → string)
  const zonesData = concert.zones.map((z) => ({
    id: z.id.toString(),
    name: z.name,
    price: Number(z.price.toString()),
    color: z.color,
    seats: z.seats.map((s) => {
      const idStr = s.id.toString();
      // ถ้าถูก hold ใน Redis แต่ DB ยังไม่ update → แสดงเป็น HELD
      const status = heldSet.has(idStr) && s.status === "AVAILABLE" ? "HELD" : s.status;
      return {
        id: idStr,
        rowLabel: s.rowLabel,
        seatNumber: s.seatNumber,
        status,
      };
    }),
  }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link href={`/concerts/${slug}`} className="text-sm text-neutral-500 hover:text-brand-600">
          ← กลับ
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">{concert.title}</h1>
        <p className="text-sm text-neutral-500 mb-6">
          เลือกที่นั่ง — จำกัด {concert.maxTicketsPerUser} ใบต่อบัญชี
        </p>

        <SeatMap
          zones={zonesData}
          maxSeats={concert.maxTicketsPerUser}
          concertId={concert.id.toString()}
          queueToken={qt!}
        />
      </main>
    </>
  );
}
