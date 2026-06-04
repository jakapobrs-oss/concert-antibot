// Admin — รายละเอียดคอนเสิร์ต + จัดการโซน/ที่นั่ง (เบื้องต้น)
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatTHB, formatThaiDate } from "@/lib/format";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { updateConcertStatus } from "@/app/actions/concert";

export const dynamic = "force-dynamic";

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
    },
  });

  if (!concert) notFound();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link href="/admin/concerts" className="text-sm text-neutral-500 hover:text-brand-600">
          ← กลับไปรายการ
        </Link>

        <div className="flex items-start justify-between gap-4 mt-2 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{concert.title}</h1>
            <p className="text-neutral-500">
              {concert.venue} · {formatThaiDate(concert.eventAt)}
            </p>
            <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-neutral-100">
              {concert.status}
            </span>
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

        <h2 className="text-lg font-semibold mb-3">โซนที่นั่ง</h2>
        {concert.zones.length === 0 ? (
          <Card>
            <CardContent>
              <p className="text-sm text-neutral-500">
                ยังไม่มีโซน — ระบบเพิ่มโซน/ที่นั่งผ่าน UI จะมาใน Phase 3.5
                <br />
                ตอนนี้ใช้ <code className="bg-neutral-100 px-1 rounded">pnpm db:seed</code> เพื่อใส่ข้อมูลตัวอย่าง
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {concert.zones.map((z) => (
              <Card key={z.id.toString()} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: z.color }} />
                    <span className="font-medium">{z.name}</span>
                  </div>
                  <div className="text-sm text-neutral-600">
                    {formatTHB(z.price.toString())} · {z._count.seats} ที่นั่ง
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
