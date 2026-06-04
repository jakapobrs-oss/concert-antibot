// หน้าห้องรอ (Virtual Waiting Room) — Phase 4
// user เข้าหน้านี้ก่อนถึงจะไปเลือกที่นั่งได้ (กันคนแห่กดพร้อมกัน + fairness)
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";
import { WaitingRoom } from "@/components/waiting-room";
import { Card, CardContent } from "@/components/ui/card";
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
    <>
      <SiteHeader />
      <main className="mx-auto max-w-lg px-4 py-12">
        <h1 className="text-center text-lg font-medium text-neutral-600 mb-6">
          {concert.title}
        </h1>
        <Card>
          <CardContent className="py-10">
            {concert.status === "ON_SALE" ? (
              <WaitingRoom
                concertId={concert.id.toString()}
                slug={slug}
                turnstileSiteKey={getTurnstileSiteKey()}
              />
            ) : (
              <p className="text-center text-neutral-500">คอนเสิร์ตนี้ยังไม่เปิดขาย</p>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
