// Seat map page — แสดงผังที่นั่งแบบ grid ตามโซน (โทนเวทีมืด)
// 🔒 Phase 4: ต้องผ่านคิว (queue token ที่ถูก admit) ถึงเข้าได้ — กันคนข้ามคิว/บอทยิงตรง
//    ⚠️ การ "จองจริง" (seat hold + lock + payment) ยังเป็น Phase 7
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";
import { SeatMap } from "@/components/seat-map";
import { Badge } from "@/components/ui/badge";
import { isAdmitted } from "@/lib/queue";
import { getHeldSeats } from "@/lib/seat-hold";
import { auth } from "@/lib/auth";
import { resolveEntryForUser, effectiveTicketLimit } from "@/lib/sale-round";

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

  // ต้อง login — queue join บังคับ login แล้ว และ token ผูกกับ userId
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  // อนุญาตเฉพาะตอน ON_SALE
  if (concert.status !== "ON_SALE") {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h1 className="mb-2 font-display text-xl font-semibold text-fg">ยังไม่เปิดขาย</h1>
          <Link href={`/concerts/${slug}`} className="text-brand-300 underline hover:text-brand-200">
            ← กลับไปหน้ารายละเอียด
          </Link>
        </main>
      </div>
    );
  }

  // 🔒 Queue gate — ต้องมี queue token ที่ถูก admit + เป็นของ user คนนี้จริง
  // ส่ง userId กัน token sharing (คนหนึ่งผ่านคิว แล้วแชร์ token ให้คนอื่น)
  const admitted = qt ? await isAdmitted(qt, concert.id.toString(), userId) : false;
  if (!admitted) {
    redirect(`/concerts/${slug}/queue`);
  }

  // 🎟️ Phase 2.1: เพดานตั๋วของ "รอบที่ผู้ใช้อยู่ตอนนี้" — รอบพรีเซลมักตึงกว่าค่าคอนเสิร์ต
  //   ให้หน้าจอบอกเลขเดียวกับที่ server บังคับใช้จริง ไม่ใช่ปล่อยให้เลือกเกินแล้วค่อยเด้ง error
  const entry = await resolveEntryForUser(concert.id, userId);
  const activeRound = entry.ok ? entry.round : null;
  const ticketMax = effectiveTicketLimit(
    concert.maxTicketsPerUser,
    activeRound?.maxTicketsPerUser ?? null
  );
  const roundName = activeRound?.name ?? null;

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
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Link
          href={`/concerts/${slug}`}
          className="text-sm text-fg-faint transition-colors hover:text-brand-300"
        >
          ← กลับ
        </Link>

        <div className="mb-7 mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">{concert.title}</h1>
          {/* ผ่านด่านคิวแล้ว — ยืนยันให้ผู้ใช้เห็นว่า gate ทำงาน */}
          <Badge tone="success">
            <BadgeCheck className="size-3.5" />
            ผ่านคิวแล้ว
          </Badge>
        </div>
        <p className="-mt-5 mb-6 text-sm text-fg-faint">
          เลือกที่นั่ง — จำกัด {ticketMax} ใบต่อบัญชี
          {roundName && ticketMax < concert.maxTicketsPerUser ? ` (เพดานของ${roundName})` : ""}
        </p>

        <SeatMap
          zones={zonesData}
          maxSeats={ticketMax}
          concertId={concert.id.toString()}
          queueToken={qt!}
        />
      </main>
    </div>
  );
}
