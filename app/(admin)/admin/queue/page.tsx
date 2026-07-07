// แผงแอดมินคุมคิว (docs/19 queue-runner) — admin เท่านั้น (RBAC ผ่าน (admin)/layout + action เช็คซ้ำ)
import { SiteHeader } from "@/components/site-header";
import { prisma } from "@/lib/prisma";
import { AdminQueuePanel } from "@/components/admin-queue-panel";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage() {
  // คิวมีความหมายเฉพาะคอนเสิร์ตที่กำลังเปิดขาย (ON_SALE)
  const concerts = await prisma.concert.findMany({
    where: { status: "ON_SALE" },
    select: { id: true, title: true },
    orderBy: { saleStartAt: "desc" },
  });
  const opts = concerts.map((c) => ({ id: c.id.toString(), title: c.title }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-fg">
          คุมคิว (Virtual Waiting Room)
        </h1>
        <p className="mb-6 text-sm text-fg-faint">
          ตัวเลขสด + หยุด/ปล่อยคิว + ปรับความจุห้องเลือกที่นั่ง (capacity-aware admission)
        </p>
        <AdminQueuePanel concerts={opts} />
      </main>
    </>
  );
}
