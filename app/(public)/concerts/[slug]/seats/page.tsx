// Seat map page — แสดงผังที่นั่งแบบ grid ตามโซน (โทนเวทีมืด)
// 🔒 Phase 4: ต้องผ่านคิว (queue token ที่ถูก admit) ถึงเข้าได้ — กันคนข้ามคิว/บอทยิงตรง
//    ⚠️ การ "จองจริง" (seat hold + lock + payment) ยังเป็น Phase 7
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";
import { SeatMap } from "@/components/seat-map";
import { SeatMapSvg } from "@/components/seat-map-svg";
import { parsePolygon, parseStageSide } from "@/lib/seatmap/polygon";
import { Badge } from "@/components/ui/badge";
import { isAdmitted } from "@/lib/queue";
import { checkSaleAccess } from "@/lib/sale-round-guard";
import { getHeldSeats } from "@/lib/seat-hold";
import { auth } from "@/lib/auth";
import { getTurnstileSiteKey } from "@/lib/turnstile";

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
        select: {
          id: true,
          name: true,
          tier: true,
          price: true,
          color: true,
          polygon: true,
          stageSide: true,
          isStanding: true,
          seats: {
            select: {
              id: true,
              rowLabel: true,
              seatNumber: true,
              status: true,
            },
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
          <h1 className="mb-2 font-display text-xl font-semibold text-fg">
            ยังไม่เปิดขาย
          </h1>
          <Link
            href={`/concerts/${slug}`}
            className="text-brand-300 underline hover:text-brand-200"
          >
            ← กลับไปหน้ารายละเอียด
          </Link>
        </main>
      </div>
    );
  }

  // 🔒 ด่านรอบกดบัตร (Phase 2) — ซ้อนทับ ON_SALE
  // ต้องเช็คซ้ำที่นี่แม้ด่านตอนเข้าคิวจะเช็คไปแล้ว เพราะรอบอาจ "ปิดระหว่างที่ยังถือ token อยู่"
  // (เช่นรอบสมาชิกจบตอนคนยังค้างอยู่หน้านี้) — ถ้าเช็คแค่ตอนเข้าคิวจะซื้อข้ามรอบได้
  const roundAccess = await checkSaleAccess(concert.id, BigInt(userId));
  if (!roundAccess.allowed) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h1 className="mb-2 font-display text-xl font-semibold text-fg">
            ยังไม่ถึงรอบของคุณ
          </h1>
          <p className="mb-4 text-sm text-fg-faint">{roundAccess.message}</p>
          <Link
            href={`/concerts/${slug}`}
            className="text-brand-300 underline hover:text-brand-200"
          >
            ← กลับไปหน้ารายละเอียด
          </Link>
        </main>
      </div>
    );
  }

  // 🔒 Queue gate — ต้องมี queue token ที่ถูก admit + เป็นของ user คนนี้จริง
  // ส่ง userId กัน token sharing (คนหนึ่งผ่านคิว แล้วแชร์ token ให้คนอื่น)
  const admitted = qt
    ? await isAdmitted(qt, concert.id.toString(), userId)
    : false;
  if (!admitted) {
    redirect(`/concerts/${slug}/queue`);
  }

  // ดึงที่นั่งที่ถูก hold อยู่ใน Redis (real-time — คนอื่นกำลังจอง) เพื่อแสดงเป็น HELD
  const allSeatIds = concert.zones.flatMap((z) =>
    z.seats.map((s) => s.id.toString()),
  );
  const heldSet = await getHeldSeats(allSeatIds);

  // 🔒 ผัง SVG ส่งลง client แค่ยอดว่างของทุกโซน ไม่ส่ง id/แถว/เลข/สถานะรายที่นั่ง
  // ถ้าส่งทั้งงาน บอทที่ผ่านคิวครั้งเดียวจะ scrape ภาพรวมสต็อกและรีเฟรชติดตาม Redis hold ได้ทันที
  const zonesData = concert.zones.map((z) => {
    const available = z.seats.filter(
      (seat) => seat.status === "AVAILABLE" && !heldSet.has(seat.id.toString()),
    ).length;
    const base = {
      id: z.id.toString(),
      name: z.name,
      tier: z.tier,
      price: Number(z.price.toString()),
      color: z.color,
      stageSide: parseStageSide(z.stageSide),
    };

    return {
      ...base,
      isStanding: z.isStanding,
      availability: { available, total: z.seats.length },
    };
  });
  const hasStandingZones = zonesData.some((zone) => zone.isStanding);

  // ⚠️ fallback เก่ายังต้องรับที่นั่งครบเหมือนเดิม และถูก render เฉพาะคอนเสิร์ตที่ไม่มีผัง SVG
  // ช่องรั่วของ fallback รับรู้แล้วแต่อยู่นอกขอบเขตงานนี้ จึงห้ามเปลี่ยนพฤติกรรมเส้นทางเดิม
  const legacyZonesData = concert.zones
    .filter((zone) => !zone.isStanding)
    .map((zone) => ({
      id: zone.id.toString(),
      name: zone.name,
      price: Number(zone.price.toString()),
      color: zone.color,
      seats: zone.seats.map((seat) => {
        const idStr = seat.id.toString();
        const status =
          heldSet.has(idStr) && seat.status === "AVAILABLE"
            ? "HELD"
            : seat.status;
        return {
          id: idStr,
          rowLabel: seat.rowLabel,
          seatNumber: seat.seatNumber,
          status,
        };
      }),
    }));

  // ---------- เลือกว่าจะแสดงผังแบบไหน ----------
  // ผังบนรูปจริง (SVG) ใช้ได้ต่อเมื่อ "ครบทุกชิ้น" เท่านั้น: มีรูปสถานที่ + ทุกโซนมีกรอบ + ทุกโซนมีที่นั่ง
  // ขาดชิ้นใดชิ้นหนึ่ง (เช่นแอดมินวาดกรอบไปแค่ 2 จาก 3 โซน) ให้ถอยไปใช้ผังตารางแบบเดิมทั้งหน้า
  // -> คอนเสิร์ตเก่าที่ยังไม่ได้ทำผัง ทำงานเหมือนเดิมเป๊ะ ไม่มีทางพังจากฟีเจอร์นี้
  //
  // 📌 ไม่เช็ค "ที่นั่งมีพิกัด x/y" อีกแล้ว — ผังรุ่นนี้วาดแค่ระดับโซน ที่นั่งไม่มีตำแหน่งบนรูป
  //    (กรอบเวทีไม่อยู่ในเงื่อนไข เพราะผังยังอ่านออกแม้ยังไม่ได้ระบุเวที แค่ไม่มีป้ายเวที)
  const polygons = new Map(
    concert.zones.map((z) => [z.id.toString(), parsePolygon(z.polygon)]),
  );
  const stagePolygon = parsePolygon(concert.stagePolygon);
  const canUseSvgMap =
    !!concert.layoutImageBase64 &&
    !!concert.layoutImageWidth &&
    !!concert.layoutImageHeight &&
    zonesData.length > 0 &&
    zonesData.every(
      (z) => polygons.get(z.id) !== null && z.availability.total > 0,
    );

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
          <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">
            {concert.title}
          </h1>
          {/* ผ่านด่านคิวแล้ว — ยืนยันให้ผู้ใช้เห็นว่า gate ทำงาน */}
          <Badge tone="success">
            <BadgeCheck className="size-3.5" />
            ผ่านคิวแล้ว
          </Badge>
        </div>
        <p className="-mt-5 mb-6 text-sm text-fg-faint">
          เลือกที่นั่ง — จำกัด {concert.maxTicketsPerUser} ใบต่อบัญชี
        </p>

        {canUseSvgMap ? (
          <SeatMapSvg
            zones={zonesData.map((z) => ({
              ...z,
              polygon: polygons.get(z.id)!,
            }))}
            layout={{
              base64: concert.layoutImageBase64!,
              width: concert.layoutImageWidth!,
              height: concert.layoutImageHeight!,
            }}
            stagePolygon={stagePolygon}
            maxSeats={concert.maxTicketsPerUser}
            concertId={concert.id.toString()}
            queueToken={qt!}
            turnstileSiteKey={getTurnstileSiteKey()}
          />
        ) : hasStandingZones ? (
          <div className="rounded-xl border border-warning/25 bg-warning/10 p-5 text-sm text-warning">
            ผังที่มีโซนยืนยังตั้งค่าไม่ครบ กรุณาติดต่อผู้จัดงาน
          </div>
        ) : (
          <SeatMap
            zones={legacyZonesData}
            maxSeats={concert.maxTicketsPerUser}
            concertId={concert.id.toString()}
            queueToken={qt!}
            turnstileSiteKey={getTurnstileSiteKey()}
          />
        )}
      </main>
    </div>
  );
}
