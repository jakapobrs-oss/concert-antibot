"use server";

// Server Actions สำหรับ Admin: สร้าง/แก้ไข/ลบ/เผยแพร่คอนเสิร์ต
// ทุก action เช็คสิทธิ์ ADMIN ก่อนเสมอ (defense in depth — middleware กันชั้นนึงแล้ว)
// กติกา validate ของฟอร์มอยู่ที่ lib/concert-form.ts (pure) — ที่นี่ทำแค่ auth + DB + ล้างแคช
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { assertVerifiedAdmin } from "@/lib/admin-guard";
import { slugifyTitle, resolveConcertSlug } from "@/lib/slug";
import { parseConcertForm, canDeleteConcert, changesAffectingBuyers } from "@/lib/concert-form";

// ตรวจสอบว่าเป็น admin จริง — throw ถ้าไม่ใช่
// F2 (Codex §4 #2): เช็ค role กับ DB จริง (ไม่เชื่อ JWT ที่ค้างได้ถึง 30 วัน)
async function requireAdmin() {
  return assertVerifiedAdmin();
}

function formToRaw(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

// หน้าสาธารณะเป็น ISR (60 วิ) — แก้อะไรที่โชว์หน้าเว็บต้องล้างทั้งรายการ/หน้ารายละเอียด (slug เก่า+ใหม่)/หน้าแรก
function revalidateConcertPages(concertId: string, slugs: string[]) {
  revalidatePath("/admin/concerts");
  revalidatePath(`/admin/concerts/${concertId}`);
  revalidatePath(`/admin/concerts/${concertId}/edit`);
  revalidatePath("/concerts");
  revalidatePath("/");
  for (const slug of new Set(slugs)) revalidatePath(`/concerts/${slug}`);
}

export async function createConcert(formData: FormData) {
  await requireAdmin();

  const parsed = parseConcertForm(formToRaw(formData));
  // ฟอร์มสร้างยังเป็น <form action> ธรรมดา — throw ให้เห็นข้อความบนหน้า error เหมือนเดิม
  if (!parsed.ok) throw new Error(parsed.error);
  const data = parsed.data;

  // slug (lib/slug.ts): ชื่อไทยล้วนแปลงเป็น ASCII ไม่ได้ → ต้องใช้ concert-<id> จึงต้องรู้ id ก่อน
  //   บั๊ก 2026-08-27: "คอนพี่เจี๊ยบ" ได้ slug "" → การ์ดลิงก์ไป /concerts กดเข้าคอนเสิร์ตไม่ได้ทั้งที่ขึ้น "กำลังขาย"
  //   → สร้างด้วย slug ชั่วคราว (ไม่ชนแน่) แล้วตั้ง slug จริงจาก id ใน transaction เดียวกัน
  const base = slugifyTitle(data.title);
  const slugTaken = base
    ? !!(await prisma.concert.findUnique({ where: { slug: base }, select: { id: true } }))
    : false;

  const concert = await prisma.$transaction(async (tx) => {
    const created = await tx.concert.create({
      data: {
        title: data.title,
        slug: `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        description: data.description,
        venue: data.venue,
        eventAt: data.eventAt,
        saleStartAt: data.saleStartAt,
        saleEndAt: data.saleEndAt,
        maxTicketsPerUser: data.maxTicketsPerUser,
        coverImageUrl: data.coverImageUrl,
        status: "DRAFT",
      },
    });
    return tx.concert.update({
      where: { id: created.id },
      data: { slug: resolveConcertSlug({ title: data.title, id: created.id, slugTaken }) },
    });
  });

  revalidatePath("/admin/concerts");
  redirect(`/admin/concerts/${concert.id}`);
}

// ============================================================
// แก้ไขข้อมูลคอนเสิร์ต (rev 41) — ใช้กับ useActionState ในฟอร์ม client (แสดง error/คำเตือนบนหน้าเดิม)
// ============================================================
export type ConcertEditState =
  | { ok: true; message: string; slug: string; warnings: string[] }
  | { ok: false; error: string; field?: string }
  | null;

export async function updateConcertAction(
  concertId: string,
  _prev: ConcertEditState,
  formData: FormData
): Promise<ConcertEditState> {
  await requireAdmin();
  if (!/^\d+$/.test(concertId)) return { ok: false, error: "ไม่พบคอนเสิร์ต" };

  const parsed = parseConcertForm(formToRaw(formData), { withSlug: true, withStatus: true });
  if (!parsed.ok) return { ok: false, error: parsed.error, field: parsed.field };
  const data = parsed.data;

  const before = await prisma.concert.findUnique({
    where: { id: BigInt(concertId) },
    select: { slug: true, eventAt: true, venue: true, _count: { select: { orders: true } } },
  });
  if (!before) return { ok: false, error: "ไม่พบคอนเสิร์ต" };

  // slug ว่าง = คงเดิม · เปลี่ยนแล้วต้องไม่ชนคอนเสิร์ตอื่น (UNIQUE ใน DB เป็นด่านสุดท้าย)
  const slug = data.slug ?? before.slug;
  if (slug !== before.slug) {
    const taken = await prisma.concert.findUnique({ where: { slug }, select: { id: true } });
    if (taken) return { ok: false, error: `slug "${slug}" ถูกใช้โดยคอนเสิร์ตอื่นแล้ว`, field: "slug" };
  }

  await prisma.concert.update({
    where: { id: BigInt(concertId) },
    data: {
      title: data.title,
      description: data.description,
      venue: data.venue,
      eventAt: data.eventAt,
      saleStartAt: data.saleStartAt,
      saleEndAt: data.saleEndAt,
      maxTicketsPerUser: data.maxTicketsPerUser,
      coverImageUrl: data.coverImageUrl,
      slug,
      status: data.status,
    },
  });

  revalidateConcertPages(concertId, [before.slug, slug]);

  // ไม่บล็อกการแก้ แต่บอกให้รู้ว่าอะไรกระทบคนที่ซื้อไปแล้ว/ลิงก์ที่แชร์ไปแล้ว
  const warnings: string[] = [];
  const affecting = changesAffectingBuyers(before, data);
  if (affecting.length > 0 && before._count.orders > 0) {
    warnings.push(
      `เปลี่ยน${affecting.join("/")} ทั้งที่มีคำสั่งซื้อแล้ว ${before._count.orders} รายการ — ระบบไม่ส่งอีเมลแจ้งอัตโนมัติ ต้องแจ้งผู้ซื้อเอง`
    );
  }
  if (slug !== before.slug) {
    warnings.push(`ลิงก์เดิม /concerts/${before.slug} ใช้ไม่ได้แล้ว — ลิงก์ใหม่คือ /concerts/${slug}`);
  }
  return { ok: true, message: "บันทึกแล้ว — หน้าเว็บอัปเดตทันที", slug, warnings };
}

// ============================================================
// ลบคอนเสิร์ต — เฉพาะที่ยังไม่มีคำสั่งซื้อ (Order ไม่ cascade เพราะเก็บประวัติเงิน)
//   โซน/ที่นั่ง/รอบกดบัตร/คิว ลบตาม FK cascade · คีย์คิวใน Redis หมดอายุเอง
// ============================================================
export type ConcertDeleteState = { ok: false; error: string } | null;

export async function deleteConcertAction(
  concertId: string,
  _prev: ConcertDeleteState,
  _formData: FormData
): Promise<ConcertDeleteState> {
  await requireAdmin();
  if (!/^\d+$/.test(concertId)) return { ok: false, error: "ไม่พบคอนเสิร์ต" };

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(concertId) },
    select: { slug: true, _count: { select: { orders: true } } },
  });
  if (!concert) return { ok: false, error: "ไม่พบคอนเสิร์ต" };

  const gate = canDeleteConcert({ orderCount: concert._count.orders });
  if (!gate.ok) return { ok: false, error: gate.reason };

  await prisma.concert.delete({ where: { id: BigInt(concertId) } });
  revalidateConcertPages(concertId, [concert.slug]);
  redirect("/admin/concerts?deleted=1");
}

// เปลี่ยนสถานะ (publish → ON_SALE, หรือกลับไป DRAFT)
export async function updateConcertStatus(concertId: string, status: string) {
  await requireAdmin();

  const valid = ["DRAFT", "SCHEDULED", "ON_SALE", "SOLD_OUT", "ENDED"];
  if (!valid.includes(status)) throw new Error("สถานะไม่ถูกต้อง");

  const concert = await prisma.concert.update({
    where: { id: BigInt(concertId) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { status: status as any },
    select: { slug: true },
  });

  revalidateConcertPages(concertId, [concert.slug]);
}
