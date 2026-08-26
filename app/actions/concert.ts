"use server";

// Server Actions สำหรับ Admin: สร้าง/แก้ไข/เผยแพร่คอนเสิร์ต
// ทุก action เช็คสิทธิ์ ADMIN ก่อนเสมอ (defense in depth — middleware กันชั้นนึงแล้ว)
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { assertVerifiedAdmin } from "@/lib/admin-guard";
import { parseThaiDateTimeLocal } from "@/lib/local-datetime";

// ตรวจสอบว่าเป็น admin จริง — throw ถ้าไม่ใช่
// F2 (Codex §4 #2): เช็ค role กับ DB จริง (ไม่เชื่อ JWT ที่ค้างได้ถึง 30 วัน)
async function requireAdmin() {
  return assertVerifiedAdmin();
}

// แปลง title → slug (ภาษาอังกฤษ/ตัวเลข + dash)
function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // ตัดอักขระพิเศษ
    .replace(/[\s_-]+/g, "-") // space → dash
    .replace(/^-+|-+$/g, "");
}

const concertSchema = z.object({
  title: z.string().min(1, "กรุณากรอกชื่อ").max(255),
  description: z.string().min(1, "กรุณากรอกรายละเอียด"),
  venue: z.string().min(1, "กรุณากรอกสถานที่").max(255),
  eventAt: z.string().min(1),
  saleStartAt: z.string().min(1),
  saleEndAt: z.string().min(1),
  maxTicketsPerUser: z.coerce.number().int().min(1).max(20),
});

export async function createConcert(formData: FormData) {
  await requireAdmin();

  const parsed = concertSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    venue: formData.get("venue"),
    eventAt: formData.get("eventAt"),
    saleStartAt: formData.get("saleStartAt"),
    saleEndAt: formData.get("saleEndAt"),
    maxTicketsPerUser: formData.get("maxTicketsPerUser"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  }

  const data = parsed.data;
  // datetime-local จากฟอร์มไม่มี timezone → ต้องตีความเป็นเวลาไทยเอง (server บน Vercel เป็น UTC)
  //   เดิม new Date(data.eventAt) ทำให้ทุกเวลาเลื่อน +7 ชม. (user-test 2026-08-26) — ดู lib/local-datetime.ts
  const eventAt = parseThaiDateTimeLocal(data.eventAt);
  const saleStartAt = parseThaiDateTimeLocal(data.saleStartAt);
  const saleEndAt = parseThaiDateTimeLocal(data.saleEndAt);
  if (!eventAt || !saleStartAt || !saleEndAt) throw new Error("วันเวลาไม่ถูกต้อง");
  if (saleEndAt <= saleStartAt) throw new Error("เวลาปิดขายต้องอยู่หลังเวลาเริ่มขาย");
  // gen slug + กันซ้ำ (เติม timestamp ถ้าซ้ำ)
  let slug = slugify(data.title);
  const existing = await prisma.concert.findUnique({ where: { slug } });
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;

  const concert = await prisma.concert.create({
    data: {
      title: data.title,
      slug,
      description: data.description,
      venue: data.venue,
      eventAt,
      saleStartAt,
      saleEndAt,
      maxTicketsPerUser: data.maxTicketsPerUser,
      status: "DRAFT",
    },
  });

  revalidatePath("/admin/concerts");
  redirect(`/admin/concerts/${concert.id}`);
}

// เปลี่ยนสถานะ (publish → ON_SALE, หรือกลับไป DRAFT)
export async function updateConcertStatus(concertId: string, status: string) {
  await requireAdmin();

  const valid = ["DRAFT", "SCHEDULED", "ON_SALE", "SOLD_OUT", "ENDED"];
  if (!valid.includes(status)) throw new Error("สถานะไม่ถูกต้อง");

  await prisma.concert.update({
    where: { id: BigInt(concertId) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { status: status as any },
  });

  revalidatePath("/admin/concerts");
  revalidatePath(`/admin/concerts/${concertId}`);
}
