"use server";

// ============================================================
// Server Actions — ผังที่นั่งจากรูป (Phase 2)
// ============================================================
// flow ฝั่งแอดมิน: อัปโหลดรูปผังสถานที่ -> นำเข้าข้อมูลโซนจาก Excel -> วาดกรอบเวที
//                  -> คลิกวาดกรอบทับแต่ละโซน
// ไฟล์นี้รับผิดชอบแค่ สิทธิ์ + ตรวจ input + ด่านความปลอดภัย + เขียน DB
//
// 📌 ผังบอก "ตำแหน่ง" ไม่ได้บอก "ที่นั่งรายตัว": กรอบโซนคือรูปร่างของโซนบนรูปสถานที่
//    ส่วนที่นั่งเป็นแค่รายชื่อ A1..A20 ที่ไม่มีพิกัดบนรูป (เลือกที่นั่งในแผงย่อยฝั่งคนซื้อ)
//    -> จำนวนที่นั่งไม่ผูกกับขนาดกรอบอีกต่อไป กรอบเล็กจะสั่งกี่ที่ก็ได้
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertVerifiedAdmin } from "@/lib/admin-guard";
import {
  buildSeatRows,
  buildSeatRowsFromSpec,
  buildStandingSeats,
  parseRowSpec,
  type SeatSpot,
} from "@/lib/seatmap/seat-rows";
import {
  parsePolygon,
  stageSideAuto,
  type Polygon,
  type StageSide,
} from "@/lib/seatmap/polygon";
import { suggestRowSpec } from "@/lib/seatmap/row-spec-suggest";
import { hasSignificantAspectRatioChange } from "@/lib/seatmap/aspect-ratio";
import { readZoneSheet } from "@/lib/seatmap/zone-sheet-xlsx";
import { canRegenerateZoneSeats, type ExistingSeatState } from "@/lib/seatmap/guard";
import { getHeldSeats } from "@/lib/seat-hold";
import { isLikelyBase64Image } from "@/lib/slip-image";

// ผลลัพธ์ของ action — คืน error เป็นข้อความแทนการ throw
// เพื่อให้หน้าแอดมินโชว์เหตุผลตรง ๆ ได้ (โดยเฉพาะตอนถูกด่านกันเจนทับปฏิเสธ)
export type SeatmapActionResult =
  | { ok: true; message: string; warning?: string }
  | { ok: false; error: string };

// base64 พองจาก binary ~33% -> ~2.8M ตัวอักษร ประมาณรูป 2MB
// ต้องต่ำกว่า serverActions.bodySizeLimit (3mb) ใน next.config.ts
const MAX_LAYOUT_IMAGE_BASE64_LEN = 2_800_000;
// เพดานที่นั่งต่อโซน — กันสั่งเลขมหาศาลแล้วระบบไปเจนกริดยักษ์
const MAX_SEATS_PER_ZONE = 5_000;

const idSchema = z.string().regex(/^\d+$/, "รหัสไม่ถูกต้อง");
const stageSideSchema = z.enum(["auto", "top", "bottom", "left", "right"]);
const rowSpecStringSchema = z
  .string()
  .max(2_000, "ที่นั่งต่อแถวยาวเกินไป")
  .optional()
  .nullable();

// พิกัดทุกจุดต้องเป็นสัดส่วน 0-1 ของขนาดรูป (ไม่ใช่พิกเซล)
const pointSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

const layoutImageSchema = z.object({
  concertId: idSchema,
  base64: z.string().min(1).max(MAX_LAYOUT_IMAGE_BASE64_LEN, "รูปใหญ่เกินไป กรุณาย่อก่อนอัปโหลด"),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
});

const polygonSchema = z
  .array(pointSchema)
  .min(3, "กรอบต้องมีอย่างน้อย 3 จุด")
  .max(60, "กรอบมีจุดมากเกินไป");

const zoneSchema = z.object({
  concertId: idSchema,
  zoneId: idSchema.optional(),
  name: z.string().min(1, "กรุณาตั้งชื่อโซน").max(50),
  tier: z.string().max(50).optional(),
  price: z.number().nonnegative().max(1_000_000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "สีต้องเป็นรหัส hex เช่น #ef4444"),
  polygon: polygonSchema,
  seatCount: z.coerce.number().int().min(1).max(MAX_SEATS_PER_ZONE),
  isStanding: z.boolean().default(false),
  rowSpec: rowSpecStringSchema,
});

type RowSpecValidation =
  | { ok: true; spec: number[] | null; serialized: string | null }
  | { ok: false; error: string };

/** ตรวจ invariant ของ rowSpec ร่วมกับจำนวนบัตร — ห้ามปรับยอดให้อัตโนมัติเมื่อไม่ตรง */
function validateRowSpecForZone(
  value: string | null | undefined,
  seatCount: number,
  isStanding: boolean,
): RowSpecValidation {
  const text = value?.trim() ?? "";
  if (!text) return { ok: true, spec: null, serialized: null };

  const spec = parseRowSpec(text);
  if (!spec) {
    return {
      ok: false,
      error: "ที่นั่งต่อแถวไม่ถูกต้อง — ใช้จำนวนเต็มบวก เช่น 12,14,16",
    };
  }
  if (isStanding) return { ok: false, error: "โซนยืนกำหนดที่นั่งต่อแถวไม่ได้" };

  const total = spec.reduce((sum, count) => sum + count, 0);
  if (total !== seatCount) {
    return {
      ok: false,
      error: `ที่นั่งต่อแถวรวม ${total} ไม่เท่ากับจำนวนที่นั่ง ${seatCount}`,
    };
  }
  return { ok: true, spec, serialized: JSON.stringify(spec) };
}

function buildZoneSeats(
  seatCount: number,
  isStanding: boolean,
  rowSpec: number[] | null,
): SeatSpot[] {
  if (isStanding) return buildStandingSeats(seatCount);
  return rowSpec ? buildSeatRowsFromSpec(rowSpec) : buildSeatRows(seatCount);
}

/** ด่านเดียวของทุก path ที่จะลบ/เจนที่นั่งโซนเดิม รวม hold จริงใน Redis */
async function regenerationVerdict(zoneId: bigint) {
  const existing = await prisma.seat.findMany({
    where: { zoneId },
    select: {
      id: true,
      status: true,
      orderItem: { select: { id: true } },
      tickets: { select: { id: true }, take: 1 },
    },
  });
  const heldInRedis = await getHeldSeats(existing.map((seat) => seat.id.toString()));
  const states: ExistingSeatState[] = existing.map((seat) => ({
    status: heldInRedis.has(seat.id.toString()) ? "HELD" : seat.status,
    hasOrderItem: seat.orderItem !== null,
    hasTicket: seat.tickets.length > 0,
  }));
  return canRegenerateZoneSeats(states);
}

async function createSeats(
  tx: Prisma.TransactionClient,
  zoneId: bigint,
  seats: SeatSpot[],
): Promise<void> {
  await tx.seat.createMany({
    data: seats.map((seat) => ({
      zoneId,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
    })),
  });
}

async function replaceSeats(
  tx: Prisma.TransactionClient,
  zoneId: bigint,
  seats: SeatSpot[],
): Promise<void> {
  await tx.seat.deleteMany({ where: { zoneId } });
  await createSeats(tx, zoneId, seats);
}

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
  const existing = await prisma.concert.findUnique({
    where: { id: BigInt(concertId) },
    select: {
      layoutImageBase64: true,
      layoutImageWidth: true,
      layoutImageHeight: true,
      stagePolygon: true,
      zones: { select: { polygon: true } },
    },
  });
  if (!existing) return { ok: false, error: "ไม่พบคอนเสิร์ตนี้" };

  const framedZoneCount = existing.zones.filter((zone) => parsePolygon(zone.polygon)).length;
  const hasStageFrame = parsePolygon(existing.stagePolygon) !== null;
  const hasExistingFrames = framedZoneCount > 0 || hasStageFrame;
  const aspectRatioChanged =
    existing.layoutImageBase64 !== null &&
    existing.layoutImageWidth !== null &&
    existing.layoutImageHeight !== null &&
    hasSignificantAspectRatioChange(
      existing.layoutImageWidth,
      existing.layoutImageHeight,
      width,
      height,
    );

  await prisma.concert.update({
    where: { id: BigInt(concertId) },
    data: { layoutImageBase64: base64, layoutImageWidth: width, layoutImageHeight: height },
  });

  // เปลี่ยนรูปได้เสมอและคงกรอบเดิมไว้ เพราะบางงานเปลี่ยนแค่รูปที่คมกว่าในสัดส่วนเดิม
  // แต่ถ้ารูปร่างรูปเปลี่ยน ต้องบอกจำนวนงานแก้ที่อาจตามมาแทนการปล่อยให้เพี้ยนเงียบ ๆ
  const affectedFrames =
    framedZoneCount > 0
      ? `${framedZoneCount} โซน${hasStageFrame ? " และกรอบเวที" : ""}`
      : "กรอบเวที";
  const warning =
    aspectRatioChanged && hasExistingFrames
      ? `⚠️ สัดส่วนรูปใหม่ต่างจากรูปเดิม — กรอบที่วาดไว้ ${affectedFrames} จะไม่ตรงตำแหน่ง ตรวจแล้ววาดใหม่เฉพาะที่เพี้ยน`
      : undefined;

  revalidatePath(`/admin/concerts/${concertId}/seatmap`);
  return { ok: true, message: "บันทึกรูปผังแล้ว", warning };
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
  tier?: string;
  price: number;
  color: string;
  polygon: Polygon;
  seatCount: number;
  isStanding?: boolean;
  rowSpec?: string | null;
}): Promise<SeatmapActionResult> {
  await assertVerifiedAdmin();

  const parsed = zoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { concertId, zoneId, name, tier, price, color, polygon, seatCount, isStanding } =
    parsed.data;
  const validatedRowSpec = validateRowSpecForZone(parsed.data.rowSpec, seatCount, isStanding);
  if (!validatedRowSpec.ok) return validatedRowSpec;

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(concertId) },
    select: { id: true },
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

  // ที่นั่งเป็นแค่รายชื่อแถว/เลขที่นั่ง ไม่มีพิกัดบนรูป -> ขนาดกรอบไม่จำกัดจำนวนที่นั่งแล้ว
  const seats = buildZoneSeats(seatCount, isStanding, validatedRowSpec.spec);

  // ---------- ด่านกันเจนทับของที่มีภาระผูกพัน ----------
  if (zoneId) {
    const verdict = await regenerationVerdict(BigInt(zoneId));
    if (!verdict.allowed) return { ok: false, error: verdict.reason };
  }

  // ---------- เขียน DB ----------
  const savedZoneId = await prisma.$transaction(async (tx) => {
    const zone = zoneId
      ? await tx.zone.update({
          where: { id: BigInt(zoneId) },
          data: {
            name,
            tier: tier ?? null,
            price,
            color,
            polygon,
            totalSeats: seats.length,
            isStanding,
            rowSpec: validatedRowSpec.serialized,
          },
        })
      : await tx.zone.create({
          data: {
            concertId: concert.id,
            name,
            tier: tier ?? null,
            price,
            color,
            polygon,
            totalSeats: seats.length,
            isStanding,
            rowSpec: validatedRowSpec.serialized,
          },
        });

    // เจนใหม่ = ล้างที่นั่งเดิมของโซนนี้ทิ้งทั้งหมด (ผ่านด่านข้างบนมาแล้วว่าไม่มีภาระผูกพัน)
    if (zoneId) await replaceSeats(tx, zone.id, seats);
    else await createSeats(tx, zone.id, seats);

    return zone.id.toString();
  });

  revalidatePath(`/admin/concerts/${concertId}`);
  revalidatePath(`/admin/concerts/${concertId}/seatmap`);
  return {
    ok: true,
    message: `บันทึกโซน "${name}" แล้ว — เจนที่นั่ง ${seats.length} ที่ (zone ${savedZoneId})`,
  };
}

/** ปรับจำนวนที่นั่งรายแถวโดยคงจำนวนบัตรรวมของโซนเดิมไว้เท่าเดิม */
export async function saveZoneRowSpec(input: {
  concertId: string;
  zoneId: string;
  rowSpec: string;
}): Promise<SeatmapActionResult> {
  await assertVerifiedAdmin();

  const parsed = z
    .object({
      concertId: idSchema,
      zoneId: idSchema,
      rowSpec: z.string().min(1, "กรุณากำหนดอย่างน้อย 1 แถว").max(2_000),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const zone = await prisma.zone.findUnique({
    where: { id: BigInt(parsed.data.zoneId) },
    select: { id: true, concertId: true, name: true, totalSeats: true, isStanding: true },
  });
  if (!zone) return { ok: false, error: "ไม่พบโซนนี้" };
  if (zone.concertId !== BigInt(parsed.data.concertId)) {
    return { ok: false, error: "โซนนี้ไม่ได้อยู่ในคอนเสิร์ตนี้" };
  }
  if (zone.isStanding) return { ok: false, error: "โซนยืนจัดแถวไม่ได้" };

  const validatedRowSpec = validateRowSpecForZone(
    parsed.data.rowSpec,
    zone.totalSeats,
    false,
  );
  if (!validatedRowSpec.ok || !validatedRowSpec.spec || !validatedRowSpec.serialized) {
    return validatedRowSpec.ok
      ? { ok: false, error: "กรุณากำหนดอย่างน้อย 1 แถว" }
      : validatedRowSpec;
  }

  const verdict = await regenerationVerdict(zone.id);
  if (!verdict.allowed) return { ok: false, error: verdict.reason };

  const seats = buildSeatRowsFromSpec(validatedRowSpec.spec);
  await prisma.$transaction(async (tx) => {
    await replaceSeats(tx, zone.id, seats);
    await tx.zone.update({
      where: { id: zone.id },
      data: { rowSpec: validatedRowSpec.serialized },
    });
  });

  revalidatePath(`/admin/concerts/${parsed.data.concertId}`);
  revalidatePath(`/admin/concerts/${parsed.data.concertId}/seatmap`);
  return { ok: true, message: `จัดแถวโซน "${zone.name}" แล้ว (${validatedRowSpec.spec.length} แถว)` };
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

  const verdict = await regenerationVerdict(zone.id);
  if (!verdict.allowed) return { ok: false, error: verdict.reason.replace("เจนที่นั่งใหม่ทับ", "ลบ") };

  // Seat มี onDelete: Cascade จาก Zone อยู่แล้ว — ลบโซนที่นั่งหายตาม
  await prisma.zone.delete({ where: { id: zone.id } });

  revalidatePath(`/admin/concerts/${parsed.data.concertId}`);
  revalidatePath(`/admin/concerts/${parsed.data.concertId}/seatmap`);
  return { ok: true, message: `ลบโซน "${zone.name}" แล้ว` };
}

/**
 * ตั้ง/แก้กรอบโซนบนรูปผัง — แตะแค่รูปร่างของโซน ไม่ยุ่งกับที่นั่งเลยสักที่
 *
 * ทำไมต้องแยกจาก saveZoneWithSeats:
 *   saveZoneWithSeats จะ "เจนที่นั่งใหม่" = ลบของเดิมทิ้งแล้วสร้างใหม่
 *   -> โซนที่ขายบัตรไปแล้วจะถูกด่านกันเจนทับปฏิเสธตลอดไป (ถูกต้องแล้ว)
 *   แต่การวาดกรอบเป็นเรื่องการแสดงผลล้วน ๆ ไม่กระทบตั๋วที่ขายไปแล้ว จึงต้องทำได้เสมอ
 *
 * ปลอดภัยเพราะแตะแค่ Zone.polygon — ไม่ลบ ไม่สร้าง ไม่แตะ id/rowLabel/seatNumber/status ของที่นั่ง
 */
export async function assignZoneFrame(input: {
  concertId: string;
  zoneId: string;
  polygon: Polygon;
}): Promise<SeatmapActionResult> {
  await assertVerifiedAdmin();

  const parsed = z
    .object({ concertId: idSchema, zoneId: idSchema, polygon: polygonSchema })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { concertId, zoneId, polygon } = parsed.data;

  const zone = await prisma.zone.findUnique({
    where: { id: BigInt(zoneId) },
    select: { id: true, name: true, concertId: true },
  });
  if (!zone) return { ok: false, error: "ไม่พบโซนนี้" };
  if (zone.concertId !== BigInt(concertId)) {
    return { ok: false, error: "โซนนี้ไม่ได้อยู่ในคอนเสิร์ตนี้" };
  }

  await prisma.zone.update({ where: { id: zone.id }, data: { polygon } });

  revalidatePath(`/admin/concerts/${concertId}`);
  revalidatePath(`/admin/concerts/${concertId}/seatmap`);
  return { ok: true, message: `ตั้งกรอบโซน "${zone.name}" แล้ว` };
}

/** ตั้งทิศเวทีของโซนโดยไม่แตะข้อมูลที่นั่ง ค่า auto จะกลับไปใช้การคำนวณจากกรอบ */
export async function setZoneStageSide(input: {
  concertId: string;
  zoneId: string;
  stageSide: "auto" | StageSide;
}): Promise<SeatmapActionResult> {
  await assertVerifiedAdmin();

  const parsed = z
    .object({ concertId: idSchema, zoneId: idSchema, stageSide: stageSideSchema })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { concertId, zoneId, stageSide } = parsed.data;

  const zone = await prisma.zone.findUnique({
    where: { id: BigInt(zoneId) },
    select: { id: true, name: true, concertId: true },
  });
  if (!zone) return { ok: false, error: "ไม่พบโซนนี้" };
  if (zone.concertId !== BigInt(concertId)) {
    return { ok: false, error: "โซนนี้ไม่ได้อยู่ในคอนเสิร์ตนี้" };
  }

  await prisma.zone.update({
    where: { id: zone.id },
    data: { stageSide: stageSide === "auto" ? null : stageSide },
  });

  revalidatePath(`/admin/concerts/${concertId}`);
  revalidatePath(`/admin/concerts/${concertId}/seatmap`);
  const stageSideLabel =
    stageSide === "auto"
      ? "อัตโนมัติ"
      : { top: "บน", bottom: "ล่าง", left: "ซ้าย", right: "ขวา" }[stageSide];
  return {
    ok: true,
    message: `ตั้งทิศเวทีของโซน "${zone.name}" เป็น ${stageSideLabel} แล้ว`,
  };
}

/**
 * บันทึกกรอบเวที — ส่ง polygon = null เพื่อลบเวทีออกจากผัง
 *
 * เวทีต้องเป็น "ข้อมูล" ไม่ใช่แค่ส่วนหนึ่งของรูปที่อัปโหลด เพราะระบบต้องใช้ตอบว่า
 * โซนไหนอยู่ใกล้/ไกลเวที และปักป้าย "เวที" ให้คนซื้ออ่านผังออกโดยไม่ต้องเดา
 */
export async function saveStagePolygon(input: {
  concertId: string;
  polygon: Polygon | null;
}): Promise<SeatmapActionResult> {
  await assertVerifiedAdmin();

  const parsed = z
    .object({ concertId: idSchema, polygon: polygonSchema.nullable() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { concertId, polygon } = parsed.data;

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(concertId) },
    select: { id: true },
  });
  if (!concert) return { ok: false, error: "ไม่พบคอนเสิร์ตนี้" };

  await prisma.concert.update({
    where: { id: concert.id },
    data: { stagePolygon: polygon ?? Prisma.DbNull },
  });

  revalidatePath(`/admin/concerts/${concertId}`);
  revalidatePath(`/admin/concerts/${concertId}/seatmap`);
  return { ok: true, message: polygon ? "บันทึกกรอบเวทีแล้ว" : "ลบกรอบเวทีออกจากผังแล้ว" };
}

/** ผลลัพธ์การนำเข้าโซนจาก Excel — แยกจาก SeatmapActionResult เพราะต้องรายงานหลายบรรทัด */
export type ZoneImportResult =
  | {
      ok: true;
      message: string;
      /** โซนที่ถูกข้าม พร้อมเหตุผล (เช่น ที่นั่งขายไปแล้วจึงเปลี่ยนจำนวนไม่ได้) */
      skipped: string[];
      /** โซนที่มีในระบบแต่ไม่มีในไฟล์ — ไม่ลบให้อัตโนมัติ ให้แอดมินตัดสินใจเอง */
      notInFile: string[];
    }
  | { ok: false; error: string; issues?: string[] };

// base64 ของไฟล์ .xlsx — ไฟล์ 500 โซนจริงยังไม่ถึง 100KB ตั้งเพดานไว้ ~1MB ก็เหลือเฟือ
const MAX_SHEET_BASE64_LEN = 1_400_000;

/**
 * นำเข้าข้อมูลโซนทั้งงานจากไฟล์ Excel — จับคู่กับโซนเดิมด้วย "ชื่อโซน"
 *
 * เจตนา: ผังสนามจริงมีหลายสิบโซน การพิมพ์ทีละโซนบนหน้าเว็บช้าและพลาดง่าย
 *   ไฟล์เดียวจบ แล้วเหลือแค่งานที่ทำแทนกันไม่ได้จริง ๆ คือ "วาดกรอบทับรูป"
 *
 * 🔴 ด่านเงิน: การเปลี่ยน "จำนวนที่นั่ง" = ลบที่นั่งเดิมทิ้งสร้างใหม่ ต้องผ่าน canRegenerateZoneSeats
 *    โซนที่ผ่านไม่ได้จะถูกข้าม (พร้อมบอกเหตุผล) แต่ยังอัปเดตราคา/สี/เรทให้ได้
 *    เพราะ OrderItem.price เก็บราคาแบบ snapshot ไว้แล้ว ออร์เดอร์เก่าจึงไม่ถูกแก้ย้อนหลัง
 *
 * ทำทีละโซน (คนละ transaction) ตั้งใจไม่รวบเป็นก้อนเดียว เพราะผังใหญ่ = ที่นั่งหลักหมื่นแถว
 * ถ้ารวบทั้งหมดจะชน transaction timeout แล้วล้มทั้งไฟล์ทั้งที่ส่วนใหญ่ผ่าน
 */
export async function importZonesFromSheet(input: {
  concertId: string;
  fileBase64: string;
}): Promise<ZoneImportResult> {
  await assertVerifiedAdmin();

  const parsed = z
    .object({
      concertId: idSchema,
      fileBase64: z.string().min(1).max(MAX_SHEET_BASE64_LEN, "ไฟล์ใหญ่เกินไป"),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { concertId, fileBase64 } = parsed.data;

  const concert = await prisma.concert.findUnique({
    where: { id: BigInt(concertId) },
    select: { id: true },
  });
  if (!concert) return { ok: false, error: "ไม่พบคอนเสิร์ตนี้" };

  // ตัดหัว data URL ถ้าฝั่งเบราว์เซอร์ส่งมาทั้งก้อน
  const commaAt = fileBase64.indexOf(",");
  const base64 = commaAt >= 0 ? fileBase64.slice(commaAt + 1) : fileBase64;
  const sheet = await readZoneSheet(Buffer.from(base64, "base64"));
  if (!sheet.ok) {
    return { ok: false, error: "ไฟล์มีข้อมูลไม่ถูกต้อง", issues: sheet.errors };
  }

  const existingZones = await prisma.zone.findMany({
    where: { concertId: concert.id },
    select: { id: true, name: true, totalSeats: true, isStanding: true, rowSpec: true },
  });
  const byName = new Map(existingZones.map((zone) => [zone.name.toLowerCase(), zone]));

  let created = 0;
  let updated = 0;
  const skipped: string[] = [];

  for (const row of sheet.zones) {
    const existing = byName.get(row.name.toLowerCase());

    if (!existing) {
      const normalizedRowSpec = row.rowSpec ? JSON.stringify(row.rowSpec) : null;
      const seats = buildZoneSeats(row.seatCount, row.isStanding, row.rowSpec);
      await prisma.$transaction(async (tx) => {
        const zone = await tx.zone.create({
          data: {
            concertId: concert.id,
            name: row.name,
            tier: row.tier,
            price: row.price,
            color: row.color,
            totalSeats: seats.length,
            isStanding: row.isStanding,
            rowSpec: normalizedRowSpec,
          },
        });
        await createSeats(tx, zone.id, seats);
      });
      created += 1;
      continue;
    }

    // ราคา/สี/เรท อัปเดตได้เสมอ — ไม่กระทบออร์เดอร์เดิมเพราะราคาถูก snapshot ไว้แล้ว
    await prisma.zone.update({
      where: { id: existing.id },
      data: { tier: row.tier, price: row.price, color: row.color },
    });
    updated += 1;

    const normalizedRowSpec = row.rowSpec ? JSON.stringify(row.rowSpec) : null;
    const needsRegeneration =
      existing.totalSeats !== row.seatCount ||
      existing.isStanding !== row.isStanding ||
      existing.rowSpec !== normalizedRowSpec;
    if (!needsRegeneration) continue;

    // ---- เปลี่ยนจำนวนหรือชนิดโซน = ลบสร้างใหม่ ต้องผ่านด่านเงินก่อน ----
    const verdict = await regenerationVerdict(existing.id);
    if (!verdict.allowed) {
      skipped.push(
        `${row.name}: คงรูปแบบเดิม ${existing.isStanding ? "โซนยืน" : "โซนนั่ง"} ${existing.totalSeats} ใบ ` +
          `(ไฟล์สั่ง ${row.isStanding ? "โซนยืน" : "โซนนั่ง"} ${row.seatCount} ใบ) — ${verdict.reason}`,
      );
      continue;
    }

    const seats = buildZoneSeats(row.seatCount, row.isStanding, row.rowSpec);
    await prisma.$transaction(async (tx) => {
      await replaceSeats(tx, existing.id, seats);
      await tx.zone.update({
        where: { id: existing.id },
        data: {
          totalSeats: seats.length,
          isStanding: row.isStanding,
          rowSpec: normalizedRowSpec,
        },
      });
    });
  }

  const namesInFile = new Set(sheet.zones.map((zone) => zone.name.toLowerCase()));
  const notInFile = existingZones
    .filter((zone) => !namesInFile.has(zone.name.toLowerCase()))
    .map((zone) => zone.name);

  revalidatePath(`/admin/concerts/${concertId}`);
  revalidatePath(`/admin/concerts/${concertId}/seatmap`);
  return {
    ok: true,
    message: `นำเข้าสำเร็จ — สร้างใหม่ ${created} โซน อัปเดต ${updated} โซน (${sheet.tiers.length} เรทราคา)`,
    skipped,
    notInFile,
  };
}

/**
 * เสนอ "ที่นั่งต่อแถว" จากกรอบโซนแล้วบันทึกให้ทีเดียวหลายโซน (ระดับ A: เครื่องเสนอ คนแก้ทับได้)
 *
 * ทำไมต้องมีแบบยกชุด: ผังจริง 69 โซน กดทีละโซนก็ 69 รอบ — แต่การ "เจนที่นั่งใหม่" มีผลกับที่นั่งเดิม
 * จึงเดินผ่านด่านเดียวกับ saveZoneRowSpec ทุกโซน (regenerationVerdict: ขายแล้ว/จองค้าง = ข้าม ไม่แตะ)
 * และทำทีละโซนใน transaction แยกกัน — โซนที่ผ่านก็ผ่าน โซนที่ติดด่านก็รายงานชื่อกลับไป
 *
 * onlyMissing=true (ค่าปกติ) = แตะเฉพาะโซนที่ยังไม่เคยกำหนดที่นั่งต่อแถว
 * ไม่ทับของที่แอดมินตั้งใจกรอกมาจาก Excel
 */
export async function applySuggestedRowSpecs(input: {
  concertId: string;
  onlyMissing?: boolean;
}): Promise<SeatmapActionResult> {
  await assertVerifiedAdmin();

  const parsed = z
    .object({ concertId: idSchema, onlyMissing: z.boolean().default(true) })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const concertId = BigInt(parsed.data.concertId);

  const concert = await prisma.concert.findUnique({
    where: { id: concertId },
    select: {
      layoutImageWidth: true,
      layoutImageHeight: true,
      stagePolygon: true,
      zones: {
        select: {
          id: true,
          name: true,
          totalSeats: true,
          isStanding: true,
          polygon: true,
          stageSide: true,
          rowSpec: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!concert) return { ok: false, error: "ไม่พบคอนเสิร์ต" };

  const stagePolygon = parsePolygon(concert.stagePolygon);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const zone of concert.zones) {
    if (zone.isStanding) continue; // โซนยืนไม่มีแถว
    if (parsed.data.onlyMissing && zone.rowSpec !== null) continue; // เคารพค่าที่แอดมินกรอกไว้แล้ว
    const polygon = parsePolygon(zone.polygon);
    if (!polygon) {
      skipped.push(`${zone.name} (ยังไม่มีกรอบ)`);
      continue;
    }

    const spec = suggestRowSpec({
      polygon,
      stageSide:
        (zone.stageSide as StageSide | null) ?? stageSideAuto(polygon, stagePolygon),
      seatCount: zone.totalSeats,
      imageWidth: concert.layoutImageWidth ?? 0,
      imageHeight: concert.layoutImageHeight ?? 0,
    });
    if (!spec) {
      skipped.push(`${zone.name} (คำนวณไม่ได้)`);
      continue;
    }

    // ด่านเดียวกับการจัดแถวรายโซน — ที่นั่งที่มีภาระผูกพันห้ามถูกลบทิ้ง
    const verdict = await regenerationVerdict(zone.id);
    if (!verdict.allowed) {
      skipped.push(`${zone.name} (${verdict.reason})`);
      continue;
    }

    const seats = buildSeatRowsFromSpec(spec);
    await prisma.$transaction(async (tx) => {
      await replaceSeats(tx, zone.id, seats);
      await tx.zone.update({
        where: { id: zone.id },
        data: { rowSpec: JSON.stringify(spec) },
      });
    });
    applied.push(zone.name);
  }

  revalidatePath(`/admin/concerts/${parsed.data.concertId}`);
  revalidatePath(`/admin/concerts/${parsed.data.concertId}/seatmap`);

  if (applied.length === 0) {
    return {
      ok: false,
      error:
        skipped.length > 0
          ? `ไม่ได้จัดแถวโซนไหนเลย — ${skipped.join(", ")}`
          : "ไม่มีโซนที่ต้องเสนอ (ทุกโซนกำหนดที่นั่งต่อแถวไว้แล้ว หรือเป็นโซนยืน)",
    };
  }
  return {
    ok: true,
    message:
      `เสนอและจัดแถวให้ ${applied.length} โซนแล้ว — ตรวจ/แก้ทับได้ที่ปุ่ม "จัดแถว" ของแต่ละโซน` +
      (skipped.length > 0 ? ` · ข้าม ${skipped.length} โซน: ${skipped.join(", ")}` : ""),
  };
}
