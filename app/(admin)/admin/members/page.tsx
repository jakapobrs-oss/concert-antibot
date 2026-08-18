// หน้า admin: จัดการสิทธิ์สมาชิก (Phase 2)
// แสดง 2 กลุ่ม: คนที่มีสิทธิ์อยู่ (รวมที่หมดอายุ/ถูกเพิกถอนแล้ว) กับผู้ใช้ทั่วไปที่ยังไม่เคยมีสิทธิ์
// 🔑 สถานะ "ใช้ได้อยู่ไหม" ตัดสินสดด้วย describeMembership ไม่ได้อ่านจาก field ตรง ๆ
//    เพราะแถวที่ status=ACTIVE อาจหมดอายุไปแล้ว (ระบบไม่มี cron มาพลิกสถานะ — ตั้งใจ)
import Link from "next/link";
import { ArrowLeft, CircleSlash, Clock, Users } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { describeMembership } from "@/lib/membership";
import { formatThaiDate } from "@/lib/format";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { MembershipAdminActions } from "@/components/membership-admin-actions";

export const dynamic = "force-dynamic";

// จำกัดจำนวนผู้ใช้ที่ยังไม่มีสิทธิ์ที่แสดง — ระบบสาธิตมีผู้ใช้ไม่มาก แต่กันหน้าบวมถ้าข้อมูลโต
const MAX_NON_MEMBERS_SHOWN = 50;

export default async function MembersPage() {
  const [memberships, nonMembers, nonMemberTotal] = await Promise.all([
    prisma.membership.findMany({
      include: {
        user: { select: { id: true, email: true, name: true } },
        grantedBy: { select: { email: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.user.findMany({
      where: { membership: null, role: "USER" },
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: MAX_NON_MEMBERS_SHOWN,
    }),
    prisma.user.count({ where: { membership: null, role: "USER" } }),
  ]);

  const rows = memberships.map((m) => ({
    userId: m.user.id.toString(),
    email: m.user.email,
    name: m.user.name,
    source: m.source,
    expiresAt: m.expiresAt,
    grantedByEmail: m.grantedBy?.email ?? null,
    state: describeMembership(m),
  }));
  const activeCount = rows.filter((r) => r.state.active).length;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-fg-faint transition-colors hover:text-brand-300"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          กลับหน้าแอดมิน
        </Link>

        <h1 className="mb-1 mt-2 font-display text-2xl font-bold tracking-tight text-fg">
          จัดการสมาชิก
        </h1>
        <p className="mb-6 text-sm text-fg-faint">
          สิทธิ์สมาชิกให้ผลอย่างเดียวคือ <strong className="text-fg">เข้ารอบกดบัตรก่อน</strong> —
          ไม่ได้ลดราคาและไม่ได้ซื้อได้เยอะกว่าคนทั่วไป
        </p>

        {/* 1) คนที่เคย/กำลังมีสิทธิ์ */}
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 font-display font-semibold text-fg">
            <Users className="size-4 text-brand-300" aria-hidden />
            สมาชิก ({activeCount} คนที่ใช้สิทธิ์ได้อยู่ จากทั้งหมด {rows.length})
          </h2>

          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 p-5 text-center text-sm text-fg-faint">
              ยังไม่มีใครเป็นสมาชิก
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.userId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-fg/10 bg-ink-900/60 p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{r.name ?? r.email}</p>
                    {r.name && <p className="truncate text-xs text-fg-faint">{r.email}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {r.state.active ? (
                        <Badge tone="success">ใช้สิทธิ์ได้</Badge>
                      ) : r.state.reason === "REVOKED" ? (
                        <Badge tone="danger">
                          <CircleSlash className="size-3" aria-hidden />
                          ถูกเพิกถอน
                        </Badge>
                      ) : (
                        <Badge tone="warning">
                          <Clock className="size-3" aria-hidden />
                          หมดอายุ
                        </Badge>
                      )}
                      <Badge tone="neutral">
                        {r.source === "ADMIN_GRANT" ? "แอดมินให้สิทธิ์" : "สมัครเอง"}
                      </Badge>
                      <span className="text-xs text-fg-faint">
                        {r.expiresAt ? `ถึง ${formatThaiDate(r.expiresAt)}` : "ไม่มีกำหนด"}
                      </span>
                      {r.grantedByEmail && (
                        <span className="text-xs text-fg-faint">โดย {r.grantedByEmail}</span>
                      )}
                    </div>
                  </div>
                  <MembershipAdminActions userId={r.userId} isActive={r.state.active} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 2) ผู้ใช้ที่ยังไม่เคยมีสิทธิ์ — ให้แอดมินกดให้สิทธิ์ได้จากที่นี่เลย */}
        <section>
          <h2 className="mb-3 font-display font-semibold text-fg">
            ผู้ใช้ที่ยังไม่เป็นสมาชิก ({nonMemberTotal})
          </h2>
          {nonMembers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 p-5 text-center text-sm text-fg-faint">
              ผู้ใช้ทุกคนเป็นสมาชิกแล้ว
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {nonMembers.map((u) => (
                  <li
                    key={u.id.toString()}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-fg/10 p-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{u.name ?? u.email}</p>
                      {u.name && <p className="truncate text-xs text-fg-faint">{u.email}</p>}
                      <p className="mt-1 text-xs text-fg-faint">
                        สมัครบัญชี {formatThaiDate(u.createdAt)}
                      </p>
                    </div>
                    <MembershipAdminActions userId={u.id.toString()} isActive={false} />
                  </li>
                ))}
              </ul>
              {nonMemberTotal > nonMembers.length && (
                <p className="mt-3 text-center text-xs text-fg-faint">
                  แสดง {nonMembers.length} คนล่าสุด จากทั้งหมด {nonMemberTotal} คน
                </p>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}
