// หน้าสถานะสมาชิก + แพ็กเกจ (Phase 2.2, docs/22)
//   สถานะ "หมดอายุ" คำนวณสดตอนเปิดหน้า (ไม่มี cron) → เลขวันคงเหลือตรงกับที่ด่านตรวจใช้จริง
//   💰 ช่วงนี้ยังไม่เก็บค่าสมาชิก — ทุกแพ็กเกจราคา 0 บาท และหน้าจอเขียนกำกับไว้ชัด
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  Clock,
  ShieldOff,
  Sparkles,
  Ticket,
  CalendarDays,
  Star,
  History,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { formatThaiDate } from "@/lib/format";
import { getMembershipView, MAX_PREPAID_MONTHS } from "@/lib/membership";
import {
  buildPlanOffers,
  currentSubscription,
  subscriptionHistory,
} from "@/lib/subscription";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { SubscriptionPlans, type PlanCardView } from "@/components/subscription-plans";

export const dynamic = "force-dynamic";

const SUB_STATUS_LABEL = {
  ACTIVE: { text: "ใช้งานอยู่", tone: "success" as const },
  ENDED: { text: "จบรอบแล้ว", tone: "neutral" as const },
  CANCELLED: { text: "ยกเลิกแล้ว", tone: "warning" as const },
};

export default async function MembershipPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login?callbackUrl=/account/membership");

  const now = new Date();
  const [view, current, history] = await Promise.all([
    getMembershipView(userId, now),
    currentSubscription(userId, now),
    subscriptionHistory(userId, now),
  ]);

  const planCards: PlanCardView[] = buildPlanOffers({
    state: view.state,
    currentTier: view.tier,
    expiresAt: view.expiresAt,
    now,
  }).map((p) => ({ ...p, current: current?.planCode === p.code }));

  // หัวการ์ด: ไอคอน + ป้ายสถานะ + คำอธิบายบรรทัดเดียว
  const head = {
    ACTIVE: {
      icon: BadgeCheck,
      tone: "success" as const,
      badge: "สมาชิก",
      note: view.daysLeft === null ? "สิทธิ์นี้ไม่มีวันหมดอายุ" : `เหลืออีก ${view.daysLeft} วัน`,
    },
    EXPIRED: {
      icon: Clock,
      tone: "warning" as const,
      badge: "หมดอายุแล้ว",
      note: "เลือกแพ็กเกจด้านล่างเพื่อกลับมาเป็นสมาชิกอีกครั้ง",
    },
    REVOKED: {
      icon: ShieldOff,
      tone: "danger" as const,
      badge: "ถูกระงับ",
      note: "สิทธิ์สมาชิกถูกระงับโดยทีมงาน — ติดต่อทีมงานเพื่อขอคืนสิทธิ์",
    },
    NONE: {
      icon: Sparkles,
      tone: "neutral" as const,
      badge: "ยังไม่เป็นสมาชิก",
      note: "เลือกแพ็กเกจด้านล่างเพื่อเริ่มเป็นสมาชิก",
    },
  }[view.state];

  const Icon = head.icon;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <h1 className="mb-6 font-display text-3xl font-bold tracking-tight text-fg">สมาชิก</h1>

        {/* การ์ดสถานะปัจจุบัน */}
        <section className="animate-fade-in-up rounded-xl border border-fg/10 bg-ink-850 p-6">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-500/12">
              <Icon className="size-6 text-brand-300" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge tone={head.tone}>{head.badge}</Badge>
                {view.tier === "PREMIUM" && <Badge tone="spot">พรีเมียม</Badge>}
                {view.source === "ADMIN_GRANT" && <Badge tone="info">ทีมงานให้สิทธิ์</Badge>}
              </div>
              <p className="text-sm text-fg-dim">{head.note}</p>

              {(view.startedAt || view.expiresAt) && (
                <dl className="mt-4 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
                  {view.startedAt && (
                    <div className="flex items-center gap-1.5 text-fg-faint">
                      <CalendarDays className="size-3.5 shrink-0" />
                      <dt className="sr-only">เริ่มเป็นสมาชิก</dt>
                      <dd>เริ่ม {formatThaiDate(view.startedAt)}</dd>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-fg-faint">
                    <Clock className="size-3.5 shrink-0" />
                    <dt className="sr-only">วันหมดอายุ</dt>
                    <dd>
                      {view.expiresAt ? `หมดอายุ ${formatThaiDate(view.expiresAt)}` : "ไม่มีวันหมดอายุ"}
                    </dd>
                  </div>
                </dl>
              )}

              {current && (
                <p className="mt-3 text-sm text-fg-dim">
                  แพ็กเกจปัจจุบัน: <strong className="text-fg">{current.planName}</strong>
                  {current.status === "CANCELLED" && " (ยกเลิกการต่ออายุแล้ว)"}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* เลือกแพ็กเกจ */}
        <section className="mt-6 rounded-xl border border-fg/10 bg-ink-900/60 p-6">
          <h2 className="mb-1 font-display font-semibold text-fg">แพ็กเกจสมาชิก</h2>
          <p className="mb-4 text-xs text-fg-faint">
            ต่ออายุได้เรื่อย ๆ วันที่เหลือไม่หาย (สมัครล่วงหน้ารวมได้ไม่เกิน {MAX_PREPAID_MONTHS} เดือน)
          </p>

          {view.state === "REVOKED" ? (
            <p className="text-sm text-fg-faint">
              บัญชีนี้ถูกระงับสิทธิ์สมาชิก — สมัครแพ็กเกจใหม่เองไม่ได้ กรุณาติดต่อทีมงาน
            </p>
          ) : (
            <SubscriptionPlans
              plans={planCards}
              hasActiveSubscription={current?.status === "ACTIVE"}
            />
          )}
        </section>

        {/* ประวัติการสมัคร */}
        {history.length > 0 && (
          <section className="mt-6 rounded-xl border border-fg/10 bg-ink-900/60 p-6">
            <h2 className="mb-3 flex items-center gap-1.5 font-display font-semibold text-fg">
              <History className="size-4 text-fg-faint" />
              ประวัติการสมัคร
            </h2>
            <ul className="space-y-2 text-sm">
              {history.map((h) => {
                const label = SUB_STATUS_LABEL[h.status];
                return (
                  <li
                    key={h.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-fg/5 pb-2 last:border-0 last:pb-0"
                  >
                    <span className="text-fg-dim">
                      {h.planName} · {formatThaiDate(h.startedAt)} – {formatThaiDate(h.expiresAt)}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-fg-faint">
                        {h.priceTHB === 0 ? "ฟรี" : `฿${h.priceTHB.toLocaleString()}`}
                      </span>
                      <Badge tone={label.tone}>{label.text}</Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* สิทธิ์ที่ได้ — เขียนให้ตรงกับที่ระบบทำจริง ไม่โฆษณาเกิน */}
        <section className="mt-6 rounded-xl border border-fg/10 bg-ink-900/60 p-6">
          <h2 className="mb-3 font-display font-semibold text-fg">สมาชิกได้อะไร</h2>
          <ul className="space-y-2.5 text-sm text-fg-dim">
            <li className="flex gap-2.5">
              <Ticket className="mt-0.5 size-4 shrink-0 text-brand-300" aria-hidden />
              <span>
                เข้า <strong className="text-fg">รอบสมาชิก</strong> ของคอนเสิร์ตที่เปิดรอบไว้
                ซึ่งเริ่มก่อนรอบทั่วไป — ที่นั่งยังเหลือครบตอนรอบเปิด
              </span>
            </li>
            <li className="flex gap-2.5">
              <Star className="mt-0.5 size-4 shrink-0 text-spot-300" aria-hidden />
              <span>
                แพ็กเกจ <strong className="text-fg">พรีเมียม</strong> เพิ่มสิทธิ์เข้า
                &ldquo;รอบแฟนคลับ&rdquo; ซึ่งเป็นรอบแรกสุดของงานที่เปิดรอบไว้
              </span>
            </li>
            <li className="flex gap-2.5">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-fg-faint" aria-hidden />
              <span>
                ในทุกรอบ คิวยังเป็น <strong className="text-fg">มาก่อนได้ก่อน</strong> ตามปกติ —
                ไม่มีการแซงคิว และไม่ได้ซื้อได้มากกว่าคนทั่วไป
              </span>
            </li>
          </ul>
          <Link
            href="/concerts"
            className="mt-4 inline-block text-sm font-medium text-brand-300 hover:underline"
          >
            ดูคอนเสิร์ตที่เปิดขาย →
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
