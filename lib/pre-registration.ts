// ============================================================
// ลงทะเบียนล่วงหน้า (Pre-registration) — Phase 2.1, docs/21
// ============================================================
// มาจากพฤติกรรมจริงของแพลตฟอร์มแฟนคลับ (Weverse ฯลฯ):
//   "ซื้อสมาชิกอย่างเดียวไม่พอ ต้องกดลงทะเบียนล่วงหน้าในช่วงเวลาที่ประกาศ ถึงจะปลดล็อกสิทธิ์ซื้อ"
//
// ทำไมของแบบนี้ดีกับระบบ (ไม่ใช่แค่ลอกของจริง):
//   1) รู้ยอดคนที่ตั้งใจจะกดล่วงหน้า → ตั้ง cap ห้องเลือกที่นั่งได้พอดีจริง ไม่ต้องเดา
//   2) ย้ายภาระ "พิสูจน์ความตั้งใจ" ออกจากวินาทีเปิดขาย → โหลดตอนเปิดขายเบาลง
//   3) เป็นด่านที่บอทต้องมาสองรอบ (ลงทะเบียน + กดจริง) โดยผู้ใช้จริงเสียแรงเพิ่มแค่คลิกเดียว
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  isPreRegisterOpen,
  meetsAudienceRequirements,
  loadUserRoundContext,
  DENY_MESSAGE,
  type RoundLike,
} from "@/lib/sale-round";

// ตัวอักษรอ่านง่าย ไม่มี I/O/0/1 (คนต้องอ่านโค้ดนี้จากหน้าจอ/แคปหน้าจอ)
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 8;

export function generatePreRegCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `PR-${out}`;
}

export type PreRegisterResult =
  | { ok: true; code: string; already: boolean }
  | { ok: false; error: string };

const ROUND_SELECT = {
  id: true,
  concertId: true,
  name: true,
  audience: true,
  startAt: true,
  endAt: true,
  requiresPreRegistration: true,
  preRegisterStartAt: true,
  preRegisterEndAt: true,
  maxTicketsPerUser: true,
  seatQuota: true,
} as const;

// ลงทะเบียนล่วงหน้าให้รอบหนึ่ง — idempotent: กดซ้ำได้โค้ดเดิม ไม่ error ไม่สร้างแถวใหม่
export async function preRegister(params: {
  userId: string | bigint;
  saleRoundId: string | bigint;
  now?: Date;
}): Promise<PreRegisterResult> {
  const now = params.now ?? new Date();
  const userId = typeof params.userId === "bigint" ? params.userId : BigInt(params.userId);
  const roundId =
    typeof params.saleRoundId === "bigint" ? params.saleRoundId : BigInt(params.saleRoundId);

  const row = await prisma.saleRound.findUnique({ where: { id: roundId }, select: ROUND_SELECT });
  if (!row) return { ok: false, error: "ไม่พบรอบขายนี้" };

  const round: RoundLike = { ...row, id: row.id.toString() };

  if (!round.requiresPreRegistration) {
    return { ok: false, error: "รอบนี้ไม่ต้องลงทะเบียนล่วงหน้า" };
  }
  if (!isPreRegisterOpen(round, now)) {
    return { ok: false, error: "ไม่อยู่ในช่วงเวลาลงทะเบียนล่วงหน้าของรอบนี้" };
  }

  // ต้องอยู่ใน "กลุ่มผู้มีสิทธิ์" ของรอบก่อน (เช่น รอบแฟนคลับต้องเป็นสมาชิกพรีเมียมอยู่แล้ว)
  const ctx = await loadUserRoundContext(userId, row.concertId, now);
  const audience = meetsAudienceRequirements(round, ctx);
  if (!audience.ok) return { ok: false, error: DENY_MESSAGE[audience.reason] };

  // ลงไว้แล้ว → คืนโค้ดเดิม (ผู้ใช้กดซ้ำ/เปิดหลายแท็บเป็นเรื่องปกติ)
  const existing = await prisma.preRegistration.findUnique({
    where: { saleRoundId_userId: { saleRoundId: roundId, userId } },
    select: { code: true },
  });
  if (existing) return { ok: true, code: existing.code, already: true };

  try {
    const created = await prisma.preRegistration.create({
      data: { saleRoundId: roundId, userId, code: generatePreRegCode() },
      select: { code: true },
    });
    return { ok: true, code: created.code, already: false };
  } catch {
    // ชน unique (กดรัวพร้อมกันสองแท็บ) → อ่านของที่มีอยู่คืนไป แทนที่จะโยน error ใส่หน้าผู้ใช้
    const again = await prisma.preRegistration.findUnique({
      where: { saleRoundId_userId: { saleRoundId: roundId, userId } },
      select: { code: true },
    });
    if (again) return { ok: true, code: again.code, already: true };
    return { ok: false, error: "ลงทะเบียนล่วงหน้าไม่สำเร็จ กรุณาลองใหม่" };
  }
}

// โค้ดลงทะเบียนล่วงหน้าของผู้ใช้ในคอนเสิร์ตหนึ่ง (roundId → code) สำหรับโชว์บนหน้าจอ
export async function preRegistrationCodes(
  userId: string | bigint,
  concertId: string | bigint
): Promise<Record<string, string>> {
  const rows = await prisma.preRegistration.findMany({
    where: {
      userId: typeof userId === "bigint" ? userId : BigInt(userId),
      saleRound: { concertId: typeof concertId === "bigint" ? concertId : BigInt(concertId) },
    },
    select: { saleRoundId: true, code: true },
  });
  return Object.fromEntries(rows.map((r) => [r.saleRoundId.toString(), r.code]));
}

// จำนวนคนที่ลงทะเบียนล่วงหน้าไว้ในรอบ — แอดมินใช้ตั้ง cap ห้องเลือกที่นั่งให้พอดีกับคนจริง
export async function countPreRegistrations(saleRoundId: string | bigint): Promise<number> {
  return prisma.preRegistration.count({
    where: {
      saleRoundId: typeof saleRoundId === "bigint" ? saleRoundId : BigInt(saleRoundId),
    },
  });
}
