// หน้าแอดมิน: เจ้าหน้าที่หน้างาน (role STAFF) — แต่งตั้ง/ถอนสิทธิ์สแกนเช็คอิน (rev 42)
//   STAFF ทำได้อย่างเดียวคือเปิด /staff/checkin — ไม่เห็นรายได้/คิว/บอทล็อก/คอนเสิร์ต
//   บัญชี ADMIN ไม่โผล่ในตารางนี้และเปลี่ยนจากหน้านี้ไม่ได้ (ดู lib/staff-role.ts)
import { ScanLine, Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatThaiDate } from "@/lib/format";
import { SiteHeader } from "@/components/site-header";
import { GrantStaffForm, StaffRowActions } from "@/components/admin-staff-actions";

export const dynamic = "force-dynamic"; // แอดมินต้องเห็นสถานะล่าสุดเสมอ

export default async function AdminStaffPage() {
  const staff = await prisma.user.findMany({
    where: { role: "STAFF" },
    select: {
      id: true,
      email: true,
      name: true,
      updatedAt: true,
      lastLoginAt: true,
      _count: { select: { checkedInTickets: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-fg">เจ้าหน้าที่หน้างาน</h1>
        <p className="mb-6 text-sm text-fg-faint">
          บัญชีที่แต่งตั้งจะเข้าได้เฉพาะ <span className="font-mono">/staff/checkin</span> (สแกนบัตรเข้างาน)
          — ไม่เห็นหน้าแอดมินอื่น · ถอนสิทธิ์แล้วมีผลทันที
        </p>

        <section className="mb-8 rounded-xl border border-fg/10 bg-ink-850 p-5">
          <h2 className="mb-3 font-display text-base font-semibold text-fg">แต่งตั้งเจ้าหน้าที่</h2>
          <GrantStaffForm />
          <p className="mt-3 text-xs text-fg-faint">
            เจ้าหน้าที่ต้องสมัครบัญชีของตัวเองก่อน (อีเมล/รหัส หรือ Google) แล้วแอดมินค่อยใส่อีเมลที่นี่
          </p>
        </section>

        <section className="rounded-xl border border-fg/10 bg-ink-850">
          <div className="flex items-center gap-2 border-b border-fg/10 px-5 py-3">
            <Users className="size-4 text-brand-400" />
            <h2 className="font-display text-base font-semibold text-fg">เจ้าหน้าที่ปัจจุบัน ({staff.length})</h2>
          </div>
          {staff.length === 0 ? (
            <p className="px-5 py-6 text-sm text-fg-faint">ยังไม่มีเจ้าหน้าที่ — แอดมินสแกนเองได้ที่จุดสแกนเช่นกัน</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-fg-faint">
                  <tr>
                    <th className="px-5 py-2 font-medium">อีเมล</th>
                    <th className="px-3 py-2 font-medium">ชื่อ</th>
                    <th className="px-3 py-2 font-medium">สแกนแล้ว</th>
                    <th className="px-3 py-2 font-medium">เข้าระบบล่าสุด</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {staff.map((u) => (
                    <tr key={u.id.toString()} className="border-t border-fg/10">
                      <td className="px-5 py-3 font-mono text-xs text-fg">{u.email}</td>
                      <td className="px-3 py-3 text-fg-dim">{u.name || "—"}</td>
                      <td className="px-3 py-3 text-fg-dim">
                        <span className="inline-flex items-center gap-1">
                          <ScanLine className="size-3.5 text-fg-faint" /> {u._count.checkedInTickets} ใบ
                        </span>
                      </td>
                      <td className="px-3 py-3 text-fg-dim">{u.lastLoginAt ? formatThaiDate(u.lastLoginAt) : "—"}</td>
                      <td className="px-3 py-3 text-right">
                        <StaffRowActions userId={u.id.toString()} email={u.email} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
