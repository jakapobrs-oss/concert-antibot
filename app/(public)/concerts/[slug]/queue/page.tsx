// หน้าห้องรอ (Virtual Waiting Room) — Phase 4
// user เข้าหน้านี้ก่อนถึงจะไปเลือกที่นั่งได้ (กันคนแห่กดพร้อมกัน + fairness)
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";
import { WaitingRoom } from "@/components/waiting-room";
import { getTurnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

export default async function QueuePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const concert = await prisma.concert.findUnique({
    where: { slug },
    select: { id: true, title: true, status: true },
  });

  if (!concert) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="relative mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12">
        {/* แสงสาดจากบนจางๆ ให้ความรู้สึกหน้าเวที */}
        <div className="bg-spotlight pointer-events-none absolute inset-x-0 top-0 h-72" aria-hidden />

        <p className="relative mb-5 text-center font-display text-sm font-medium text-fg-faint">
          {concert.title}
        </p>

        <div className="animate-fade-in-up relative overflow-hidden rounded-2xl border border-fg/10 bg-ink-850 px-6 py-10 shadow-lg sm:px-10">
          {concert.status === "ON_SALE" ? (
            <WaitingRoom
              concertId={concert.id.toString()}
              slug={slug}
              turnstileSiteKey={getTurnstileSiteKey()}
            />
          ) : (
            <p className="text-center text-fg-faint">คอนเสิร์ตนี้ยังไม่เปิดขาย</p>
          )}
        </div>
      </main>
    </div>
  );
}
