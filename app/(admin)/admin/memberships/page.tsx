// หน้า admin: จัดการสิทธิ์สมาชิก (Phase 2, docs/20)
//   สิทธิ์เดียวของสมาชิก = เข้ารอบขายก่อน (SaleRound.audience = MEMBER_ONLY)
//   ไม่มีส่วนลด ไม่เพิ่มเพดานตั๋ว → หน้านี้ไม่แตะเงิน/ตั๋วเลย
// สถานะ "หมดอายุ" คำนวณสดจาก expiresAt ทุกครั้งที่เปิดหน้า (ไม่มี cron มาพลิก status)
import { BadgeCheck, ShieldOff, Clock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatThaiDate } from "@/lib/format";
import { membershipState, type MembershipState } from "@/lib/membership";
import { planByCode } from "@/lib/subscription";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import {
  GrantMembershipForm,
  MembershipRowActions,
} from "@/components/admin-membership-actions";

export const dynamic = "force-dynamic"; // แอดมินต้องเห็นสถานะล่าสุดเสมอ

const stateLabel: Record<MembershipState, { text: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ACTIVE: { text: "ใช้งานได้", tone: "success" },
  EXPIRED: { text: "หมดอายุ", tone: "warning" },
  REVOKED: { text: "ถูกเพิกถอน", tone: "danger" },
  NONE: { text: "ไม่มีสิทธิ์", tone: "neutral" },
};

export default async function AdminMembershipsPage() {
  const now = new Date();

  const [rows, activeCount, expiredCount, revokedCount] = await Promise.all([
    prisma.membership.findMany({
      include: {
        user: { select: { email: true, name: true } },
        grantedBy: { select: { email: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    // นับแยกใน DB (ไม่นับจากแถวที่ take มา) — เลขบนหัวจึงถูกแม้สมาชิกเกิน 200 คน
    prisma.membership.count({
      where: { status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    }),
    prisma.membership.count({ where: { status: "ACTIVE", expiresAt: { lte: now } } }),
    prisma.membership.count({ where: { status: "REVOKED" } }),
  ]);

  // แพ็กเกจที่ยังไม่หมดอายุของแต่ละคน (Phase 2.2) — ดึงทีเดียวแล้ว map เข้าแถว ไม่ query ในลูป
  const subs = await prisma.subscription.findMany({
    where: { userId: { in: rows.map((r) => r.userId) }, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
    select: { userId: true, planCode: true, status: true, expiresAt: true },
  });
  const subByUser = new Map<string, (typeof subs)[number]>();
  for (const sub of subs) {
    const key = sub.userId.toString();
    if (!subByUser.has(key)) subByUser.set(key, sub); // ใบแรก = หมดอายุช้าที่สุด
  }

  const summary = [
    { label: "สมาชิกที่ใช้งานได้", value: activeCount, icon: BadgeCheck },
    { label: "หมดอายุ", value: expiredCount, icon: Clock },
    { label: "ถูกเพิกถอน", value: revokedCount, icon: ShieldOff },
  ];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-fg">สิทธิ์สมาชิก</h1>
        <p className="mb-6 text-sm text-fg-faint">
          สมาชิกได้สิทธิ์เดียว: เข้ารอบขายก่อนรอบทั่วไป — ไม่มีส่วนลด และไม่ได้ซื้อได้มากกว่าคนทั่วไป ·
          ระดับ <strong className="text-spot-300">พรีเมียม</strong> เพิ่มสิทธิ์เข้า
          &ldquo;รอบแฟนคลับ&rdquo; ซึ่งเป็นรอบแรกสุด (ดู docs/21)
        </p>

        {/* สรุปตัวเลข */}
        <div className="mb-6 grid grid-cols-3 overflow-hidden rounded-xl border border-fg/10 bg-ink-850">
          {summary.map((s, i) => (
            <div key={s.label} className={`relative p-5 ${i > 0 ? "border-l border-fg/10" : ""}`}>
              <s.icon className="absolute right-4 top-4 size-4 text-fg-faint" aria-hidden />
              <p className="text-xs text-fg-faint">{s.label}</p>
              <p className="text-led mt-1 text-3xl font-bold text-fg">{s.value.toLocaleString()}</p>
            </div>
          ))}
        </div>

        {/* ให้สิทธิ์ด้วยอีเมล */}
        <section className="mb-8 rounded-xl border border-fg/10 bg-ink-850 p-5">
          <h2 className="mb-3 font-display font-semibold text-fg">ให้สิทธิ์ / ต่ออายุ</h2>
          <GrantMembershipForm />
        </section>

        {/* รายชื่อ */}
        <section>
          <h2 className="mb-3 font-display font-semibold text-fg">
            รายชื่อล่าสุด ({rows.length}
            {rows.length === 200 ? "+" : ""})
          </h2>

          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 p-5 text-center text-sm text-fg-faint">
              ยังไม่มีสมาชิกในระบบ
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((m) => {
                const state = membershipState(m, now);
                const label = stateLabel[state];
                const sub = subByUser.get(m.userId.toString());
                return (
                  <div
                    key={m.id.toString()}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-fg/10 bg-ink-850 p-4 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                        <span className="truncate">{m.user.name || m.user.email}</span>
                        <Badge tone={label.tone}>{label.text}</Badge>
                        {m.tier === "PREMIUM" && <Badge tone="spot">พรีเมียม</Badge>}
                      </p>
                      <p className="truncate text-xs text-fg-faint">
                        {m.user.email} · {m.source === "ADMIN_GRANT" ? "แอดมินให้สิทธิ์" : "สมัครเอง"}
                        {m.grantedBy ? ` โดย ${m.grantedBy.name || m.grantedBy.email}` : ""}
                      </p>
                      {sub && (
                        <p className="text-xs text-fg-faint">
                          แพ็กเกจ: {planByCode(sub.planCode)?.name ?? sub.planCode}
                          {sub.status === "CANCELLED" ? " (ยกเลิกการต่ออายุแล้ว)" : ""}
                        </p>
                      )}
                      <p className="text-xs text-fg-faint">
                        เริ่ม {formatThaiDate(m.startedAt)} ·{" "}
                        {m.expiresAt ? `หมดอายุ ${formatThaiDate(m.expiresAt)}` : "ไม่มีวันหมดอายุ"}
                        {m.revokedAt ? ` · เพิกถอน ${formatThaiDate(m.revokedAt)}` : ""}
                      </p>
                    </div>
                    <MembershipRowActions
                      userId={m.userId.toString()}
                      revoked={state === "REVOKED"}
                      tier={m.tier}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
