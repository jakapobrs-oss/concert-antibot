// หน้าห้องรอ (Virtual Waiting Room) — Phase 4
// user เข้าหน้านี้ก่อนถึงจะไปเลือกที่นั่งได้ (กันคนแห่กดพร้อมกัน + fairness)
import { notFound } from "next/navigation";
import Link from "next/link";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { WaitingRoom } from "@/components/waiting-room";
import { getTurnstileSiteKey } from "@/lib/turnstile";
import { deriveDisplayStatus } from "@/lib/concert-display";
import { SetChatContext } from "@/components/chat-context";

export const dynamic = "force-dynamic";

export default async function QueuePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const concert = await prisma.concert.findUnique({
    where: { slug },
    select: {
      id: true,
      title: true,
      status: true,
      saleStartAt: true,
      saleEndAt: true,
      eventAt: true,
      _count: { select: { zones: true } },
    },
  });

  if (!concert) notFound();

  // เปิดห้องรอเฉพาะที่ขายอยู่จริง (มีโซน + ในช่วงขาย) — status ON_SALE ที่ไม่มีโซนเคยพาเข้าคิวแล้วเจอ "บัตรหมด" (user-test #40)
  const display = deriveDisplayStatus({
    status: concert.status,
    saleStartAt: concert.saleStartAt,
    saleEndAt: concert.saleEndAt,
    eventAt: concert.eventAt,
    zoneCount: concert._count.zones,
  });
  const closedMessage: Record<Exclude<typeof display, "ON_SALE">, string> = {
    SOLD_OUT: "บัตรหมดแล้ว",
    SCHEDULED: "คอนเสิร์ตนี้ยังไม่เปิดขาย",
    ENDED: "ปิดการขายแล้ว",
    NOT_READY: "คอนเสิร์ตนี้ยังไม่พร้อมขาย — รอประกาศโซนและราคา",
  };

  // 💳 ถ้า user มี order ค้างชำระอยู่ ไม่ต้องต่อคิวใหม่ — ชี้ทางกลับไปจ่ายให้จบ
  // เคสจริง: กด back จากหน้าชำระเงิน สิทธิ์ผ่านคิว (5 นาที) หมดพอดี โดนเด้งมาหน้านี้
  // ทั้งที่ order เดิมยังล็อกที่นั่งอยู่ — ถ้าไม่บอก ผู้ใช้จะคิดว่าที่นั่งหลุดแล้ว
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const pendingOrder = userId
    ? await prisma.order.findFirst({
        where: {
          userId: BigInt(userId),
          concertId: concert.id,
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    : null;

  return (
    <div className="flex min-h-screen flex-col">
      <SetChatContext
        context={`ผู้ใช้กำลังรออยู่ในคิวของคอนเสิร์ต: ${concert.title}\nระบบจะปล่อยผู้ใช้เป็น batch สุ่ม (~100 คน/รอบ) เพื่อความเป็นธรรม`}
      />
      <SiteHeader />
      <main className="relative mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12">
        {/* แสงสาดจากบนจางๆ ให้ความรู้สึกหน้าเวที */}
        <div className="bg-spotlight pointer-events-none absolute inset-x-0 top-0 h-72" aria-hidden />

        <p className="relative mb-5 text-center font-display text-sm font-medium text-fg-faint">
          {concert.title}
        </p>

        {pendingOrder && (
          <div className="relative mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3">
            <p className="text-sm text-warning">
              คำสั่งซื้อเดิมของคุณยังไม่หมดอายุ — ไม่ต้องเข้าคิวใหม่
            </p>
            <Link
              href={`/checkout/${pendingOrder.id.toString()}`}
              className="text-sm font-semibold text-warning underline underline-offset-4 hover:opacity-80"
            >
              ไปชำระเงินต่อ →
            </Link>
          </div>
        )}

        <div className="animate-fade-in-up relative overflow-hidden rounded-2xl border border-fg/10 bg-ink-850 px-6 py-10 shadow-lg sm:px-10">
          {display !== "ON_SALE" ? (
            <p className="text-center text-fg-faint">
              {/* บัตรหมด ≠ ยังไม่เปิดขาย — สถานะ SOLD_OUT ถูกติดอัตโนมัติหลังออกตั๋ว (docs/23 §3) */}
              {closedMessage[display as Exclude<typeof display, "ON_SALE">]}
            </p>
          ) : !userId ? (
            /* ยังไม่ล็อกอิน: บอกทางไปต่อตรงนี้ — เดิมปล่อย WaitingRoom ยิง join แล้วได้ 401 "กรุณาเข้าสู่ระบบ"
               แต่มีแค่ปุ่ม "เข้าคิวใหม่" ที่วนกลับมา 401 เดิม = ทางตัน (user-test 2026-08-28 OBS-2)
               คิวผูกกับบัญชี → ล็อกอินแล้วเด้งกลับมาหน้านี้ผ่าน callbackUrl · ไม่เริ่มเก็บ fingerprint/พฤติกรรมของคนที่ยังไม่ล็อกอิน */
            <div className="space-y-4 text-center">
              <div className="mx-auto grid size-16 place-items-center rounded-full border border-fg/15 bg-fg/5 text-fg-dim">
                <LogIn className="size-8" />
              </div>
              <h2 className="font-display text-xl font-semibold text-fg">เข้าสู่ระบบก่อนเข้าคิว</h2>
              <p className="text-sm leading-relaxed text-fg-dim">
                คิวผูกกับบัญชีของคุณ — เข้าสู่ระบบแล้วระบบจะพากลับมาหน้านี้ให้
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Link href={`/login?callbackUrl=${encodeURIComponent(`/concerts/${slug}/queue`)}`}>
                  <Button>เข้าสู่ระบบเพื่อเข้าคิว</Button>
                </Link>
                <Link href="/register">
                  <Button variant="outline">สมัครบัญชีใหม่</Button>
                </Link>
              </div>
            </div>
          ) : (
            <WaitingRoom
              concertId={concert.id.toString()}
              slug={slug}
              turnstileSiteKey={getTurnstileSiteKey()}
            />
          )}
        </div>

        {/* แจ้งการเก็บข้อมูลกันบอท ณ จุดที่เริ่มเก็บจริง (fingerprint + พฤติกรรมเมาส์/คีย์เริ่มใน WaitingRoom) — PDPA */}
        {display === "ON_SALE" && userId && (
          <p className="relative mt-4 text-center text-xs leading-relaxed text-fg-faint">
            ระหว่างอยู่ในห้องรอ ระบบเก็บลายนิ้วมือเบราว์เซอร์และรูปแบบการขยับเมาส์/กดคีย์ (เป็นตัวเลขสรุป ไม่เก็บสิ่งที่พิมพ์)
            เพื่อคัดกรองบอท —{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-fg">
              นโยบายความเป็นส่วนตัว
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}
