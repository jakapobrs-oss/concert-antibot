// หน้าสถานะสมาชิกของผู้ใช้ (Phase 2)
// สิทธิ์สมาชิกมีอย่างเดียว: "เข้ารอบกดบัตรก่อน" — ไม่ใช่ส่วนลดราคา และไม่ได้ซื้อได้เยอะกว่าคนอื่น
// (ถ้าให้ซื้อเยอะกว่าจะขัดกับระบบกันคนกวาดตั๋วที่ทำไว้แล้ว — บัตรผูกชื่อ + เพดานตั๋วต่อบัญชี)
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, CalendarClock, CircleSlash, Clock, Info, Ticket } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { describeMembership, SELF_SIGNUP_DURATION_DAYS } from "@/lib/membership";
import { formatThaiDate } from "@/lib/format";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { MembershipSignupButton } from "@/components/membership-signup-button";

export const dynamic = "force-dynamic"; // สถานะขึ้นกับเวลาปัจจุบัน ห้าม cache

// ข้อความอธิบายเหตุผลที่ยังไม่ได้สิทธิ์ — แยกตามสาเหตุ เพราะผู้ใช้ต้องทำคนละอย่าง
const INACTIVE_COPY = {
  NONE: {
    title: "ยังไม่มีสิทธิ์สมาชิก",
    detail: `รับสิทธิ์ฟรี ได้เข้ารอบกดบัตรก่อนคนทั่วไป (สิทธิ์มีอายุ ${SELF_SIGNUP_DURATION_DAYS} วัน)`,
    action: "รับสิทธิ์สมาชิก",
  },
  EXPIRED: {
    title: "สิทธิ์สมาชิกหมดอายุแล้ว",
    detail: "ต่ออายุได้ทันที ไม่มีค่าใช้จ่าย",
    action: "ต่ออายุสิทธิ์",
  },
  REVOKED: {
    title: "สิทธิ์สมาชิกถูกระงับ",
    detail: "ติดต่อผู้ดูแลระบบเพื่อสอบถามเหตุผล — สมัครใหม่เองไม่ได้จนกว่าจะได้รับการติดต่อกลับ",
    action: null,
  },
} as const;

export default async function MembershipPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login?callbackUrl=/account/membership");

  const membership = await prisma.membership.findUnique({
    where: { userId: BigInt(userId) },
  });
  const state = describeMembership(membership);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">สิทธิ์สมาชิก</h1>
        <p className="mt-1 text-sm text-fg-faint">
          สิทธิ์สมาชิกใช้สำหรับ <strong className="text-fg">เข้ารอบกดบัตรก่อน</strong> เท่านั้น
          ราคาบัตรและจำนวนที่ซื้อได้เท่ากับคนทั่วไปทุกประการ
          {/* คนละเรื่องกับปุ่ม "สมัครสมาชิก" บนหัวเว็บ ซึ่งหมายถึงการสร้างบัญชี */}
        </p>

        {/* กล่องสถานะ */}
        <div className="mt-6 rounded-2xl border border-fg/10 bg-fg/[0.02] p-6">
          {state.active ? (
            <>
              <Badge tone="success">
                <BadgeCheck className="size-3.5" />
                เป็นสมาชิกอยู่
              </Badge>
              <p className="mt-3 font-display text-lg font-semibold text-fg">
                ใช้สิทธิ์เข้ารอบสมาชิกได้แล้ว
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-faint">
                <CalendarClock className="size-4" aria-hidden />
                {state.expiresAt
                  ? `สิทธิ์ถึง ${formatThaiDate(state.expiresAt)}`
                  : "ไม่มีกำหนดหมดอายุ"}
              </p>
            </>
          ) : (
            <>
              <Badge tone={state.reason === "REVOKED" ? "danger" : "warning"}>
                {state.reason === "REVOKED" ? (
                  <CircleSlash className="size-3.5" />
                ) : (
                  <Clock className="size-3.5" />
                )}
                {state.reason === "REVOKED" ? "ถูกระงับ" : "ยังไม่มีสิทธิ์"}
              </Badge>
              <p className="mt-3 font-display text-lg font-semibold text-fg">
                {INACTIVE_COPY[state.reason].title}
              </p>
              <p className="mt-1 text-sm text-fg-faint">{INACTIVE_COPY[state.reason].detail}</p>
              {INACTIVE_COPY[state.reason].action && (
                <div className="mt-4">
                  <MembershipSignupButton label={INACTIVE_COPY[state.reason].action!} />
                </div>
              )}
            </>
          )}
        </div>

        {/* อธิบายว่าสิทธิ์นี้ทำงานยังไง — กันเข้าใจผิดว่าเป็นส่วนลดหรือแซงคิว */}
        <div className="mt-6 rounded-2xl border border-fg/10 p-5">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-fg">
            <Info className="size-4 text-brand-300" aria-hidden />
            สิทธิ์สมาชิกทำงานยังไง
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-fg-faint">
            <li>
              • คอนเสิร์ตที่ตั้งรอบไว้จะมี <strong className="text-fg">รอบสมาชิก</strong> เปิดก่อน
              แล้วค่อยเปิด <strong className="text-fg">รอบทั่วไป</strong> ให้ทุกคน
            </li>
            <li>
              • ในรอบเดียวกัน ทุกคน<strong className="text-fg">ต่อคิวเหมือนกันหมด</strong> —
              สมาชิกไม่ได้แซงคิว แต่ได้เข้าคิวตั้งแต่รอบแรก
            </li>
            <li>• ราคาบัตรและเพดานจำนวนบัตรต่อบัญชี เท่ากับคนทั่วไป</li>
          </ul>
          <Link
            href="/account/tickets"
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand-300 underline-offset-2 hover:underline"
          >
            <Ticket className="size-4" aria-hidden />
            ดูบัตรของฉัน
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
