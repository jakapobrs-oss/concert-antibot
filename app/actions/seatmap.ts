"use server";

// ============================================================
// Server Actions — ผังที่นั่งจากรูป (Phase 2)
// ============================================================
// flow ฝั่งแอดมิน: อัปโหลดรูปผังสถานที่ -> คลิกวาดกรอบทับโซน -> สั่งจำนวนที่นั่ง -> กดเจน
// ตัวอัลกอริทึมอยู่ที่ lib/seatmap/generate.ts (pure) ไฟล์นี้รับผิดชอบแค่
//   สิทธิ์ + ตรวจ input + ด่านความปลอดภัย + เขียน DB
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertVerifiedAdmin } from "@/lib/admin-guard";
import { compareSeatOrder, fillPolygonWithSeats, type Polygon } from "@/lib/seatmap/generate";
import { canRegenerateZoneSeats, type ExistingSeatState } from "@/lib/seatmap/guard";
import { getHeldSeats } from "@/lib/seat-hold";
import { isLikelyBase64Image } from "@/lib/slip-image";

// ผลลัพธ์ของ action — คืน error เป็นข้อความแทนการ throw
// เพื่อให้หน้าแอดมินโชว์เหตุผลตรง ๆ ได้ (โดยเฉพาะตอนถูกด่านกันเจนทับปฏิเสธ)
export type SeatmapActionResult = { ok: true; message: string } | { ok: false; error: string };

// base64 พองจาก binary ~33% -> ~2.8M ตัวอักษร ประมาณรูป 2MB
// ต้องต่ำกว่า serverActions.bodySizeLimit (3mb) ใน next.config.ts
const MAX_LAYOUT_IMAGE_BASE64_LEN = 2_800_000;
// เพดานที่นั่งต่อโซน — กันสั่งเลขมหาศาลแล้วระบบไปเจนกริดยักษ์
const MAX_SEATS_PER_ZONE = 5_000;

const idSchema = z.string().regex(/^\d+$/, "รหัสไม่ถูกต้อง");

// พิกัดทุกจุดต้องเป็นสัดส่วน 0-1 ของขนาดรูป (ไม่ใช่พิกเซล)
const pointSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

const layoutImageSchema = z.object({
  concertId: idSchema,
  base64: z.string().min(1).max(MAX_LAYOUT_IMAGE_BASE64_LEN, "รูปใหญ่เกินไป กรุณาย่อก่อนอัปโหลด"),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
});

const zoneSchema = z.object({
  concertId: idSchema,
  zoneId: idSchema.optional(),
  name: z.string().min(1, "กรุณาตั้งชื่อโซน").max(50),
  price: z.number().nonnegative().max(1_000_000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "สีต้องเป็นรหัส hex เช่น #ef4444"),
  polygon: z.array(pointSchema).min(3, "กรอบต้องมีอย่างน้อย 3 จุด").max(60, "กรอบมีจุดมากเกินไป"),
  seatCount: z.coerce.number().int().min(1).max(MAX_SEATS_PER_ZONE),
});

/** บันทึกรูปผังสถานที่ (เก็บเป็น base64 ใน Postgres แบบเดียวกับสลิป ไม่ได้ใช้ MinIO/S3) */
export async function saveLayoutImage(input: {
  concertId: string;
  base64: string;
  width: number;
  height: number;
}): Promise<SeatmapActionResult> {
  await assertVerifiedAdmin();

  const parsed = layoutImageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  // ต้องหน้าตาเป็นรูปจริง — กันยัด data:text/html หรือ payload แปลก ๆ เข้ามา
  if (!isLikelyBase64Image(parsed.data.base64)) {
    return { ok: false, error: "ไฟล์ที่อัปโหลดไม่ใช่รูปภาพ" };
  }

  const { concertId, base64, width, height } = parsed.data;
  await prisma.concert.update({
    where: { id: BigInt(concertId) },
    data: { layoutImageBase64: base64, layoutImageWidth: width, layoutImageHeight: height },
  });

  revalidatePath(`/admin/concerts/${concertId}/seatmap`);
  return { ok: true, message: "บันทึกรูปผังแล้ว" };
}

/**
 * สร้าง/แก้โซน พร้อมเจนที่นั่งให้เต็มกรอบที่วาดไว้
 *
 * 🔴 ด่านสำคัญ: ถ้าโซนเดิมมีที่นั่งที่ขายแล้ว/ถูกจองค้าง/มีตั๋วผูกอยู่ ต้องปฏิเสธ
 *    เพราะการเจนใหม่คือการ "ลบที่นั่งเดิมทิ้งแล้วสร้างใหม่"
 *    ถ้าปล่อยผ่าน ตั๋วที่ลูกค้าจ่ายเงินจริงจะชี้ไปยังที่นั่งที่ไม่มีอยู่
 */
export async function saveZoneWithSeats(input: {
  concertId: string;
  zoneId?: string;
  name: string;
  price: number;
  color: string;
  polygon: Polygon;
  seatCount: number;
}): Promise<SeatmapActionResult> {
  await assertVerifiedAdmin();

  const parsed = zoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { concertId, zoneId, name, price, color, polygon, seatCount } = parsed.data;

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(concertId) },
    select: { id: true, layoutImageWidth: true, layoutImageHeight: true },
  });
  if (!concert) return { ok: false, error: "ไม่พบคอนเสิร์ตนี้" };

  // ถ้าแก้โซนเดิม ต้องยืนยันว่าโซนนั้นเป็นของคอนเสิร์ตนี้จริง (กันแก้ข้ามคอนเสิร์ต)
  if (zoneId) {
    const owner = await prisma.zone.findUnique({
      where: { id: BigInt(zoneId) },
      select: { concertId: true },
    });
    if (!owner) return { ok: false, error: "ไม่พบโซนนี้" };
    if (owner.concertId !== concert.id) return { ok: false, error: "โซนนี้ไม่ได้อยู่ในคอนเสิร์ตนี้" };
  }

  // อัตราส่วนรูป ใช้ชดเชยให้ระยะห่างที่นั่งบนจอจริงเท่ากันทั้งสองแกน
  const aspectRatio =
    concert.layoutImageWidth && concert.layoutImageHeight
      ? concert.layoutImageWidth / concert.layoutImageHeight
      : 1;

  const seats = fillPolygonWithSeats(polygon as Polygon, { targetCount: seatCount, aspectRatio });
  if (seats.length === 0) {
    return { ok: false, error: "กรอบที่วาดเล็กเกินไป ไม่สามารถวางที่นั่งได้" };
  }
  if (seats.length < seatCount) {
    return {
      ok: false,
      error: `กรอบนี้วางได้มากสุด ${seats.length} ที่ (สั่งไว้ ${seatCount}) — ขยายกรอบหรือลดจำนวนลง`,
    };
  }

  // ---------- ด่านกันเจนทับของที่มีภาระผูกพัน ----------
  if (zoneId) {
    const existing = await prisma.seat.findMany({
      where: { zoneId: BigInt(zoneId) },
      select: {
        id: true,
        status: true,
        orderItem: { select: { id: true } },
        tickets: { select: { id: true }, take: 1 },
      },
    });

    // ⚠️ hold จริงอยู่ใน Redis (TTL 300s) — DB จะเป็น HELD ก็ต่อเมื่อ confirm แล้วเท่านั้น
    //    ถ้าดูแค่ DB จะพลาดคนที่กำลังอยู่หน้าจ่ายเงิน แล้วลบที่นั่งใต้เท้าเขา
    const heldInRedis = await getHeldSeats(existing.map((s) => s.id.toString()));

    const states: ExistingSeatState[] = existing.map((seat) => ({
      status: heldInRedis.has(seat.id.toString()) ? "HELD" : seat.status,
      hasOrderItem: seat.orderItem !== null,
      hasTicket: seat.tickets.length > 0,
    }));

    const verdict = canRegenerateZoneSeats(states);
    if (!verdict.allowed) return { ok: false, error: verdict.reason };
  }

  // ---------- เขียน DB ----------
  const savedZoneId = await prisma.$transaction(async (tx) => {
    const zone = zoneId
      ? await tx.zone.update({
          where: { id: BigInt(zoneId) },
          data: { name, price, color, polygon, totalSeats: seats.length },
        })
      : await tx.zone.create({
          data: {
            concertId: concert.id,
            name,
            price,
            color,
            polygon,
            totalSeats: seats.length,
          },
        });

    // เจนใหม่ = ล้างที่นั่งเดิมของโซนนี้ทิ้งทั้งหมด (ผ่านด่านข้างบนมาแล้วว่าไม่มีภาระผูกพัน)
    if (zoneId) await tx.seat.deleteMany({ where: { zoneId: zone.id } });

    await tx.seat.createMany({
      data: seats.map((seat) => ({
        zoneId: zone.id,
        rowLabel: seat.rowLabel,
        seatNumber: seat.seatNumber,
        x: seat.x,
        y: seat.y,
      })),
    });

    return zone.id.toString();
  });

  revalidatePath(`/admin/concerts/${concertId}`);
  revalidatePath(`/admin/concerts/${concertId}/seatmap`);
  return {
    ok: true,
    message: `บันทึกโซน "${name}" แล้ว — เจนที่นั่ง ${seats.length} ที่ (zone ${savedZoneId})`,
  };
}

/** ลบโซนทั้งโซน — ใช้ด่านชุดเดียวกับการเจนทับ เพราะผลลัพธ์กับที่นั่งเหมือนกันคือหายไป */
export async function deleteZone(input: {
  concertId: string;
  zoneId: string;
}): Promise<SeatmapActionResult> {
  await assertVerifiedAdmin();

  const parsed = z
    .object({ concertId: idSchema, zoneId: idSchema })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "รหัสไม่ถูกต้อง" };

  const zone = await prisma.zone.findUnique({
    where: { id: BigInt(parsed.data.zoneId) },
    select: { id: true, name: true, concertId: true },
  });
  if (!zone) return { ok: false, error: "ไม่พบโซนนี้" };
  if (zone.concertId !== BigInt(parsed.data.concertId)) {
    return { ok: false, error: "โซนนี้ไม่ได้อยู่ในคอนเสิร์ตนี้" };
  }

  const existing = await prisma.seat.findMany({
    where: { zoneId: zone.id },
    select: {
      id: true,
      status: true,
      orderItem: { select: { id: true } },
      tickets: { select: { id: true }, take: 1 },
    },
  });
  const heldInRedis = await getHeldSeats(existing.map((s) => s.id.toString()));
  const verdict = canRegenerateZoneSeats(
    existing.map((seat) => ({
      status: heldInRedis.has(seat.id.toString()) ? "HELD" : seat.status,
      hasOrderItem: seat.orderItem !== null,
      hasTicket: seat.tickets.length > 0,
    })),
  );
  if (!verdict.allowed) return { ok: false, error: verdict.reason.replace("เจนที่นั่งใหม่ทับ", "ลบ") };

  // Seat มี onDelete: Cascade จาก Zone อยู่แล้ว — ลบโซนที่นั่งหายตาม
  await prisma.zone.delete({ where: { id: zone.id } });

  revalidatePath(`/admin/concerts/${parsed.data.concertId}`);
  revalidatePath(`/admin/concerts/${parsed.data.concertId}/seatmap`);
  return { ok: true, message: `ลบโซน "${zone.name}" แล้ว` };
}

/**
 * ตั้งกรอบโซน + จัดตำแหน่งที่นั่ง "เดิม" ลงบนผัง โดยไม่ลบที่นั่งสักที่
 *
 * ทำไมต้องมีทั้งที่มี saveZoneWithSeats อยู่แล้ว:
 *   โซนที่ขายบัตรไปแล้วจะถูกด่านกันเจนทับปฏิเสธตลอดไป (ถูกต้องแล้ว เพราะ "เจน" = ลบทิ้งสร้างใหม่)
 *   แปลว่าคอนเสิร์ตที่กำลังขายอยู่/ขายไปแล้ว จะไม่มีวันได้ผังรูปจริงเลย
 *   -> ต้องมีทางที่แตะ "แค่พิกัด" ซึ่งไม่กระทบเงิน = ตัวนี้
 *
 * ปลอดภัยเพราะ: ไม่ลบ ไม่สร้าง ไม่แตะ id / rowLabel / seatNumber / status
 *   ตั๋วที่ลูกค้าถืออยู่ยังชี้ที่นั่ง id เดิม เลขที่นั่งบนตั๋วก็ยังเป็นเลขเดิม
 *   เปลี่ยนแค่ "จุดบนรูป" ซึ่งเป็นข้อมูลไว้แสดงผลล้วน ๆ
 */
export async function assignZoneFrame(input: {
  concertId: string;
  zoneId: string;
  polygon: Polygon;
}): Promise<SeatmapActionResult> {
  await assertVerifiedAdmin();

  const parsed = z
    .object({
      concertId: idSchema,
      zoneId: idSchema,
      polygon: z.array(pointSchema).min(3, "กรอบต้องมีอย่างน้อย 3 จุด").max(60, "กรอบมีจุดมากเกินไป"),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { concertId, zoneId, polygon } = parsed.data;

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(concertId) },
    select: { id: true, layoutImageWidth: true, layoutImageHeight: true },
  });
  if (!concert) return { ok: false, error: "ไม่พบคอนเสิร์ตนี้" };

  const zone = await prisma.zone.findUnique({
    where: { id: BigInt(zoneId) },
    select: { id: true, name: true, concertId: true },
  });
  if (!zone) return { ok: false, error: "ไม่พบโซนนี้" };
  if (zone.concertId !== concert.id) return { ok: false, error: "โซนนี้ไม่ได้อยู่ในคอนเสิร์ตนี้" };

  const existing = await prisma.seat.findMany({
    where: { zoneId: zone.id },
    select: { id: true, rowLabel: true, seatNumber: true },
  });
  if (existing.length === 0) {
    return { ok: false, error: "โซนนี้ยังไม่มีที่นั่ง — ใช้ปุ่มเจนที่นั่งแทน" };
  }

  const aspectRatio =
    concert.layoutImageWidth && concert.layoutImageHeight
      ? concert.layoutImageWidth / concert.layoutImageHeight
      : 1;

  const generated = fillPolygonWithSeats(polygon as Polygon, {
    targetCount: existing.length,
    aspectRatio,
  });
  if (generated.length < existing.length) {
    return {
      ok: false,
      error: `กรอบนี้วางได้มากสุด ${generated.length} ที่ แต่โซนนี้มี ${existing.length} ที่ — ขยายกรอบให้ใหญ่ขึ้น`,
    };
  }

  // จับคู่ "ที่นั่งเดิม" กับ "ตำแหน่งใหม่" ตามลำดับอ่านผัง (compareSeatOrder — มี unit test คุม)
  const seatsInOrder = [...existing].sort(compareSeatOrder);
  const spotsInOrder = [...generated].sort(compareSeatOrder);

  // อัปเดตพิกัดทีเดียวทั้งโซนด้วย VALUES เดียว — ถ้ายิงทีละ UPDATE โซนหลายร้อยที่จะชน transaction timeout
  const rows = seatsInOrder.map((seat, i) =>
    Prisma.sql`(${seat.id}::bigint, ${spotsInOrder[i].x}::double precision, ${spotsInOrder[i].y}::double precision)`
  );

  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE seats SET x = v.x, y = v.y
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, x, y)
      WHERE seats.id = v.id
    `,
    prisma.zone.update({ where: { id: zone.id }, data: { polygon } }),
  ]);

  revalidatePath(`/admin/concerts/${concertId}`);
  revalidatePath(`/admin/concerts/${concertId}/seatmap`);
  return {
    ok: true,
    message: `ตั้งกรอบโซน "${zone.name}" แล้ว — จัดตำแหน่งที่นั่งเดิม ${existing.length} ที่ลงบนผัง (ไม่ลบที่นั่ง)`,
  };
}
