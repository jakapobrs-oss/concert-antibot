// Admin — ตั้งรอบกดบัตร "สมาชิกกดก่อน" (Phase 2)
// รอบเป็นด่านซ้อนทับ ON_SALE: คอนเสิร์ตต้องเปิดขายก่อน แล้วรอบค่อยกำหนดว่า "ใครกดได้ตอนไหน"
import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";
import { SaleRoundEditor } from "@/components/sale-round-editor";

export const dynamic = "force-dynamic";

export default async function AdminSaleRoundsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(id) },
    select: {
      id: true,
      title: true,
      venue: true,
      status: true,
      saleRounds: {
        orderBy: { startAt: "asc" },
        select: {
          id: true,
          name: true,
          audience: true,
          startAt: true,
          endAt: true,
          _count: { select: { orders: true } },
        },
      },
    },
  });

  if (!concert) notFound();

  // BigInt/Date ส่งข้าม server->client ตรง ๆ ไม่ได้ ต้องแปลงเป็น string ก่อน
  const rounds = concert.saleRounds.map((r) => ({
    id: r.id.toString(),
    name: r.name,
    audience: r.audience as "MEMBER_ONLY" | "PUBLIC",
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    orderCount: r._count.orders,
  }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link
          href={`/admin/concerts/${id}`}
          className="text-sm text-fg-faint transition-colors hover:text-brand-300"
        >
          ← กลับไปหน้าคอนเสิร์ต
        </Link>

        <h1 className="mb-1 mt-2 font-display text-2xl font-bold text-fg">รอบกดบัตร</h1>
        <p className="mb-6 text-fg-faint">
          {concert.title} · {concert.venue}
        </p>

        {/* คอนเสิร์ตยังไม่เปิดขาย = ตั้งรอบไว้ล่วงหน้าได้ แต่ยังไม่มีผล — บอกให้ชัดกันเข้าใจผิดตอนสาธิต */}
        {concert.status !== "ON_SALE" && (
          <div className="mb-4 rounded-xl border border-warning/25 bg-warning/10 p-4 text-sm leading-relaxed text-fg-dim">
            คอนเสิร์ตนี้สถานะ <span className="font-medium">{concert.status}</span> —
            ตั้งรอบไว้ล่วงหน้าได้ แต่รอบจะยังไม่มีผลจนกว่าจะกด “เปิดขาย”
          </div>
        )}

        <div className="mb-5 rounded-xl border border-fg/10 bg-ink-900/50 p-4 text-sm leading-relaxed text-fg-faint">
          <span className="font-medium text-fg-dim">รอบทำงานยังไง:</span> ระบบดูว่าตอนนี้อยู่ในรอบไหน
          ถ้าเป็นรอบสมาชิก คนที่ไม่ใช่สมาชิกจะเข้าคิวไม่ได้และถูกบอกว่ารอบทั่วไปเปิดกี่โมง
          <br />
          ภายในรอบเดียวกัน <span className="font-medium text-fg-dim">คิวยังเป็นมาก่อนได้ก่อนเหมือนเดิม</span> —
          สมาชิกได้เปรียบที่ “เข้าได้เร็วกว่า” ไม่ใช่ “แซงคิว”
        </div>

        <SaleRoundEditor concertId={id} rounds={rounds} />
      </main>
    </>
  );
}
