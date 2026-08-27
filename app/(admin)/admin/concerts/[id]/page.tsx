// Admin — รายละเอียดคอนเสิร์ต + จัดการโซน/ที่นั่ง (เบื้องต้น, โทนเวทีมืด)
import Link from "next/link";
import { notFound } from "next/navigation";
import { Map } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatTHB, formatThaiDate } from "@/lib/format";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateConcertStatus } from "@/app/actions/concert";
import { publicStatusHint } from "@/lib/concert-display";
import { AdminSaleRounds, type AdminRoundView } from "@/components/admin-sale-rounds";

export const dynamic = "force-dynamic";

// ป้ายสถานะภาษาไทย (ชุดเดียวกับหน้า list) — หน้านี้เคยโชว์ค่าดิบ ON_SALE ให้แอดมินอ่านเอง
const statusLabel: Record<string, string> = {
  DRAFT: "ฉบับร่าง",
  SCHEDULED: "ตั้งเวลา",
  ON_SALE: "กำลังขาย",
  SOLD_OUT: "เต็มแล้ว",
  ENDED: "จบงาน",
};

// tone ของ Badge ตามสถานะ (ชุดเดียวกับหน้า list)
const statusTone = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  ON_SALE: "success",
  SOLD_OUT: "danger",
  ENDED: "neutral",
} as const;

export default async function AdminConcertDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(id) },
    include: {
      zones: {
        include: { _count: { select: { seats: true } } },
        orderBy: { price: "desc" },
      },
      // Phase 2.1 — รอบกดบัตร + โค้ดสิทธิ์ของรอบพาร์ทเนอร์
      saleRounds: {
        include: {
          accessCodes: { orderBy: { createdAt: "asc" } },
          _count: { select: { preRegistrations: true, orders: true } },
        },
        orderBy: { startAt: "asc" },
      },
    },
  });

  if (!concert) notFound();

  // ป้ายที่ตั้ง vs สิ่งที่ผู้ชมเห็นจริง (lib/concert-display) — null = ตรงกัน
  //   เหตุ 2026-08-27: แอดมินเห็น "กำลังขาย" แต่หน้าเว็บกดเข้าไม่ได้ แล้วเดาว่า "คงยังไม่ถึงเวลา"
  const publicHint = publicStatusHint({
    status: concert.status,
    saleStartAt: concert.saleStartAt,
    saleEndAt: concert.saleEndAt,
    eventAt: concert.eventAt,
    zoneCount: concert.zones.length,
  });

  const rounds: AdminRoundView[] = concert.saleRounds.map((r) => ({
    id: r.id.toString(),
    name: r.name,
    audience: r.audience,
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    requiresPreRegistration: r.requiresPreRegistration,
    preRegisterStartAt: r.preRegisterStartAt?.toISOString() ?? null,
    preRegisterEndAt: r.preRegisterEndAt?.toISOString() ?? null,
    maxTicketsPerUser: r.maxTicketsPerUser,
    seatQuota: r.seatQuota,
    preRegistrationCount: r._count.preRegistrations,
    orderCount: r._count.orders,
    codes: r.accessCodes.map((c) => ({
      id: c.id.toString(),
      code: c.code,
      label: c.label,
      maxUses: c.maxUses,
      usedCount: c.usedCount,
    })),
  }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link
          href="/admin/concerts"
          className="text-sm text-fg-faint transition-colors hover:text-brand-300"
        >
          ← กลับไปรายการ
        </Link>

        <div className="mb-6 mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-2xl font-bold text-fg">{concert.title}</h1>
              <Badge tone={statusTone[concert.status as keyof typeof statusTone] ?? "neutral"}>
                {statusLabel[concert.status] ?? concert.status}
              </Badge>
            </div>
            <p className="mt-1 text-fg-faint">
              {concert.venue} · {formatThaiDate(concert.eventAt)}
            </p>
            {publicHint && <p className="mt-1 text-sm text-warning">⚠ {publicHint}</p>}
          </div>
          {concert.status !== "ON_SALE" ? (
            <form
              action={async () => {
                "use server";
                await updateConcertStatus(concert.id.toString(), "ON_SALE");
              }}
            >
              <Button type="submit">เปิดขาย</Button>
            </form>
          ) : (
            <form
              action={async () => {
                "use server";
                await updateConcertStatus(concert.id.toString(), "DRAFT");
              }}
            >
              <Button type="submit" variant="outline">ปิดขาย</Button>
            </form>
          )}
        </div>

        {/* ทางลัดไปงานตั้งค่าของคอนเสิร์ตนี้ — ผังที่นั่ง + รอบกดบัตร (Phase 2) */}
        <div className="mb-6 flex flex-wrap gap-2">
          <Link href={`/admin/concerts/${id}/seatmap`}>
            <Button variant="outline" size="sm" leftIcon={<Map className="size-4" />}>
              จัดผังที่นั่งจากรูป
            </Button>
          </Link>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-fg">โซนที่นั่ง</h2>
        </div>
        {concert.zones.length === 0 ? (
          <div className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 p-6">
            <p className="text-sm leading-relaxed text-fg-faint">
              ยังไม่มีโซน — กด{" "}
              <span className="font-medium text-fg-dim">“จัดผังที่นั่งจากรูป”</span>{" "}
              เพื่ออัปโหลดผังสถานที่แล้ววาดกรอบโซน ระบบจะเจนที่นั่งให้เอง
              <br />
              หรือใช้{" "}
              <code className="rounded bg-fg/10 px-1.5 py-0.5 font-mono text-xs text-fg-dim">
                pnpm db:seed
              </code>{" "}
              เพื่อใส่ข้อมูลตัวอย่าง
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {concert.zones.map((z) => (
              <div
                key={z.id.toString()}
                className="rounded-xl border border-fg/10 bg-ink-850 p-4 transition-colors hover:border-fg/20"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="size-3 rounded-full"
                      style={{ backgroundColor: z.color, boxShadow: `0 0 10px ${z.color}90` }}
                      aria-hidden
                    />
                    <span className="font-display font-medium text-fg">{z.name}</span>
                  </div>
                  <div className="text-sm text-fg-dim">
                    <span className="text-led font-semibold text-spot-400">
                      {formatTHB(z.price.toString())}
                    </span>{" "}
                    · {z._count.seats} ที่นั่ง
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <AdminSaleRounds concertId={concert.id.toString()} rounds={rounds} />
      </main>
    </>
  );
}
