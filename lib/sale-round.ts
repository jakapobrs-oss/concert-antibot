// ============================================================
// Sale round — ลำดับรอบพรีเซล (Phase 2.1, docs/21)
// ============================================================
// อ้างอิงจากแพลตฟอร์มจริง (Live Nation Tero / Weverse / ALPHAZ / All Ticket / พรีเซลบัตรเครดิต):
//   คิว 1 FANCLUB     — สมาชิกระดับพรีเมียม (+ ลงทะเบียนล่วงหน้าถ้ารอบกำหนด)
//   คิว 2 PARTNER     — ต้องมีโค้ดสิทธิ์จากสปอนเซอร์/บัตรเครดิต
//   คิว 3 MEMBER_ONLY — สมาชิกที่ยัง active (สมัครฟรี)
//   คิว 4 PUBLIC      — ทุกคน
//
// 🔑 กฎเหล็กที่ห้ามแหก: ลำดับนี้คือ "ลำดับของรอบเวลา" ไม่ใช่สิทธิ์แซงคิวในรอบเดียวกัน
//    ภายในทุกรอบ คิวยังจัดด้วย time-bucket + random เหมือนเดิม → สถิติ fairness/inversion ในเล่มไม่กระทบ
//
// กติกาความเข้ากันได้ย้อนหลัง (สำคัญกว่าฟีเจอร์ใหม่ทุกข้อ):
//    คอนเสิร์ตที่ไม่มีแถวใน sale_rounds เลย = พฤติกรรมเดิมทุกอย่าง (ไม่มีด่านเพิ่ม)
import { prisma } from "@/lib/prisma";
import { formatThaiDate } from "@/lib/format";
import { getActiveMembership } from "@/lib/membership";
import { getConcertAvailability } from "@/lib/sold-out";

export type RoundAudience = "FANCLUB" | "PARTNER" | "MEMBER_ONLY" | "PUBLIC";

// เรียงจาก "เข้ายากสุด/มาก่อน" ไป "เปิดกว้างสุด" — ใช้ทั้งจัดลำดับรอบและตัดสินว่าจะลองรอบไหนก่อน
export const AUDIENCE_ORDER: RoundAudience[] = ["FANCLUB", "PARTNER", "MEMBER_ONLY", "PUBLIC"];

export const AUDIENCE_LABEL: Record<RoundAudience, string> = {
  FANCLUB: "รอบแฟนคลับ (สมาชิกพรีเมียม)",
  PARTNER: "รอบพาร์ทเนอร์ (ต้องมีโค้ดสิทธิ์)",
  MEMBER_ONLY: "รอบสมาชิก",
  PUBLIC: "รอบทั่วไป",
};

export function audienceRank(a: RoundAudience): number {
  const i = AUDIENCE_ORDER.indexOf(a);
  return i === -1 ? AUDIENCE_ORDER.length : i;
}

// ------------------------------------------------------------
// ส่วนที่ 1: pure logic (unit test ได้โดยไม่ต้องมี DB)
// ------------------------------------------------------------

export type RoundLike = {
  id: string;
  name: string;
  audience: RoundAudience;
  startAt: Date;
  endAt: Date;
  requiresPreRegistration: boolean;
  preRegisterStartAt: Date | null;
  preRegisterEndAt: Date | null;
  maxTicketsPerUser: number | null;
  seatQuota: number | null;
};

// บริบทของผู้ใช้ที่ใช้ตัดสินสิทธิ์ (ดึงมาทีเดียวแล้วส่งเข้า pure function)
export type UserRoundContext = {
  // null = ไม่ใช่สมาชิกที่ยัง active ณ เวลานั้น
  membership: { tier: "STANDARD" | "PREMIUM" } | null;
  preRegisteredRoundIds: string[]; // รอบที่ลงทะเบียนล่วงหน้าไว้แล้ว
  unlockedRoundIds: string[]; // รอบที่ปลดล็อกด้วยโค้ดสิทธิ์แล้ว
};

export type DenyReason =
  | "SOLD_OUT" // บัตรหมดทั้งงาน — รอบที่ยังไม่เปิดก็ไม่ได้ขายแล้ว
  | "ROUND_CLOSED" // ยังไม่ถึงเวลา / หมดเวลารอบแล้ว
  | "NOT_MEMBER"
  | "NEED_PREMIUM"
  | "NEED_PRE_REGISTRATION"
  | "NEED_ACCESS_CODE";

export const DENY_MESSAGE: Record<DenyReason, string> = {
  SOLD_OUT: "บัตรหมดแล้ว",
  ROUND_CLOSED: "ยังไม่ถึงเวลาเปิดขายรอบที่คุณมีสิทธิ์",
  NOT_MEMBER: "รอบนี้สำหรับสมาชิกเท่านั้น",
  NEED_PREMIUM: "รอบนี้สำหรับสมาชิกระดับพรีเมียมเท่านั้น",
  NEED_PRE_REGISTRATION: "รอบนี้ต้องลงทะเบียนล่วงหน้าก่อนถึงจะกดบัตรได้",
  NEED_ACCESS_CODE: "รอบนี้ต้องใช้โค้ดสิทธิ์จากผู้สนับสนุน",
};

// ช่วงรอบเป็น [startAt, endAt) — ปลายเปิด เพื่อให้รอบถัดไปเริ่มตรงเวลาที่รอบก่อนจบพอดีได้
export function isRoundOpen(round: RoundLike, now: Date): boolean {
  return round.startAt.getTime() <= now.getTime() && now.getTime() < round.endAt.getTime();
}

// หน้าต่างลงทะเบียนล่วงหน้า — ไม่ตั้งเวลาไว้ = เปิดจนถึงเวลาที่รอบเริ่ม
export function isPreRegisterOpen(round: RoundLike, now: Date): boolean {
  if (!round.requiresPreRegistration) return false;
  const t = now.getTime();
  const start = round.preRegisterStartAt?.getTime() ?? -Infinity;
  const end = round.preRegisterEndAt?.getTime() ?? round.startAt.getTime();
  return t >= start && t < end;
}

export type EligibilityResult = { ok: true } | { ok: false; reason: DenyReason };

// ตรวจเฉพาะ "กลุ่มผู้มีสิทธิ์" ของรอบ — ยังไม่รวมด่านลงทะเบียนล่วงหน้า
//   แยกออกมาเพราะตอนจะ "ลงทะเบียนล่วงหน้า" ต้องเช็คว่าอยู่ในกลุ่มก่อน
//   (ถ้าใช้ meetsRoundRequirements จะวนลูป: ลงทะเบียนไม่ได้เพราะยังไม่ได้ลงทะเบียน)
export function meetsAudienceRequirements(
  round: RoundLike,
  ctx: UserRoundContext
): EligibilityResult {
  switch (round.audience) {
    case "PUBLIC":
      break;
    case "MEMBER_ONLY":
      if (!ctx.membership) return { ok: false, reason: "NOT_MEMBER" };
      break;
    case "FANCLUB":
      if (!ctx.membership) return { ok: false, reason: "NOT_MEMBER" };
      if (ctx.membership.tier !== "PREMIUM") return { ok: false, reason: "NEED_PREMIUM" };
      break;
    case "PARTNER":
      if (!ctx.unlockedRoundIds.includes(round.id)) return { ok: false, reason: "NEED_ACCESS_CODE" };
      break;
  }
  return { ok: true };
}

// ตรวจ "คุณสมบัติ" ครบทุกด่าน (กลุ่มผู้มีสิทธิ์ + ลงทะเบียนล่วงหน้า) — ยังไม่ดูเวลา
//   แยกจากเวลาเพื่อให้หน้าจอบอกล่วงหน้าได้ว่า "รอบหน้าคุณเข้าได้"
export function meetsRoundRequirements(round: RoundLike, ctx: UserRoundContext): EligibilityResult {
  const audience = meetsAudienceRequirements(round, ctx);
  if (!audience.ok) return audience;
  // ลงทะเบียนล่วงหน้าเป็นด่านซ้อนบนคุณสมบัติ — "เป็นสมาชิกอย่างเดียวไม่พอ" ตามแพลตฟอร์มจริง
  if (round.requiresPreRegistration && !ctx.preRegisteredRoundIds.includes(round.id)) {
    return { ok: false, reason: "NEED_PRE_REGISTRATION" };
  }
  return { ok: true };
}

// ตรวจครบทั้งเวลาและคุณสมบัติ
export function checkRoundEligibility(
  round: RoundLike,
  ctx: UserRoundContext,
  now: Date
): EligibilityResult {
  if (!isRoundOpen(round, now)) return { ok: false, reason: "ROUND_CLOSED" };
  return meetsRoundRequirements(round, ctx);
}

export type EntryDecision =
  // round = null → คอนเสิร์ตนี้ไม่มีระบบรอบ (พฤติกรรมเดิม)
  | { ok: true; round: RoundLike | null }
  | {
      ok: false;
      reason: DenyReason;
      message: string;
      // รอบถัดไปที่ "ผู้ใช้คนนี้" มีสิทธิ์เข้า (ถ้ามี) — เอาไปบอกผู้ใช้ว่ารออีกนานเท่าไร
      nextRound: { name: string; audience: RoundAudience; startAt: Date } | null;
    };

// ⭐ ด่านหลักที่ทั้ง queue join และ booking เรียก
export function resolveRoundEntry(
  rounds: RoundLike[],
  ctx: UserRoundContext,
  now: Date,
  opts: { soldOut?: boolean } = {}
): EntryDecision {
  // 🎫 บัตรหมดทั้งงาน → จบตั้งแต่ตรงนี้ ไม่ต้องดูรอบเลย
  //   (ตรงกับพฤติกรรมจริง: หมดตั้งแต่รอบสมาชิก = รอบทั่วไปไม่เปิดขาย)
  if (opts.soldOut) {
    return { ok: false, reason: "SOLD_OUT", message: DENY_MESSAGE.SOLD_OUT, nextRound: null };
  }

  // ไม่มีรอบเลย = คอนเสิร์ตแบบเดิม ไม่มีด่านเพิ่ม (ห้ามพังของเก่า)
  if (rounds.length === 0) return { ok: true, round: null };

  const open = rounds
    .filter((r) => isRoundOpen(r, now))
    .sort((a, b) => audienceRank(a.audience) - audienceRank(b.audience));

  // เข้าได้รอบไหนก็ใช้รอบนั้น — ไล่จากรอบที่จำกัดที่สุดก่อน เพื่อให้ order ถูกบันทึกเข้ารอบที่ถูกต้อง
  for (const round of open) {
    if (meetsRoundRequirements(round, ctx).ok) return { ok: true, round };
  }

  // เข้าไม่ได้ — เลือกเหตุผลจาก "รอบที่เปิดกว้างที่สุดที่กำลังเปิดอยู่" (ใกล้เคียงกับสิ่งที่ผู้ใช้ต้องทำที่สุด)
  const nextRound = nextEligibleRound(rounds, ctx, now);
  if (open.length === 0) {
    return {
      ok: false,
      reason: "ROUND_CLOSED",
      message: DENY_MESSAGE.ROUND_CLOSED,
      nextRound,
    };
  }
  const widest = open[open.length - 1];
  const denied = meetsRoundRequirements(widest, ctx);
  const reason = denied.ok ? "ROUND_CLOSED" : denied.reason;
  return { ok: false, reason, message: DENY_MESSAGE[reason], nextRound };
}

// ข้อความปฏิเสธที่ผู้ใช้เอาไปทำอะไรต่อได้ — บอกด้วยว่ารอบที่ตัวเองมีสิทธิ์เริ่มเมื่อไร
export function entryDenyMessage(decision: Extract<EntryDecision, { ok: false }>): string {
  if (!decision.nextRound) return decision.message;
  return `${decision.message} — ${decision.nextRound.name} เริ่ม ${formatThaiDate(decision.nextRound.startAt)}`;
}

// รอบในอนาคตที่ใกล้ที่สุดซึ่งผู้ใช้คนนี้ผ่านคุณสมบัติแล้ว
//   (ไม่นับรอบที่ยังต้องลงทะเบียนล่วงหน้า — รอบนั้นผู้ใช้ยังต้องไปกดเอง จึงไม่ใช่ "รอเฉย ๆ แล้วได้")
export function nextEligibleRound(
  rounds: RoundLike[],
  ctx: UserRoundContext,
  now: Date
): { name: string; audience: RoundAudience; startAt: Date } | null {
  const upcoming = rounds
    .filter((r) => r.startAt.getTime() > now.getTime() && meetsRoundRequirements(r, ctx).ok)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const r = upcoming[0];
  return r ? { name: r.name, audience: r.audience, startAt: r.startAt } : null;
}

// เพดานตั๋วที่ใช้จริง — รอบ "ตึงกว่า" ได้ แต่ผ่อนให้หลวมกว่าคอนเสิร์ตไม่ได้
//   (พรีเซลจริงมักจำกัด 2 ใบ ขณะที่รอบทั่วไป 4 ใบ — ทิศทางเดียวที่ยอมให้คือตึงขึ้น)
export function effectiveTicketLimit(concertMax: number, roundMax: number | null): number {
  if (roundMax === null || roundMax <= 0) return concertMax;
  return Math.min(concertMax, roundMax);
}

// โควต้าที่นั่งของรอบ (รอบแฟนคลับล็อกโควต้าไว้ก่อน) — quota = null/0 คือไม่จำกัดเพิ่มเติม
export function exceedsRoundQuota(params: {
  sold: number;
  requested: number;
  quota: number | null;
}): boolean {
  if (params.quota === null || params.quota <= 0) return false;
  return params.sold + params.requested > params.quota;
}

// สถานะรายรอบสำหรับหน้าจอ (ไทม์ไลน์รอบขายในหน้าคอนเสิร์ต)
export type RoundState = "OPEN_ELIGIBLE" | "OPEN_DENIED" | "UPCOMING" | "ENDED" | "SOLD_OUT";

export type RoundStatusForUser = {
  round: RoundLike;
  state: RoundState;
  denyReason: DenyReason | null;
  canPreRegisterNow: boolean;
  preRegistered: boolean;
  unlocked: boolean;
};

export function describeRounds(
  rounds: RoundLike[],
  ctx: UserRoundContext,
  now: Date,
  opts: { soldOut?: boolean } = {}
): RoundStatusForUser[] {
  return [...rounds]
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((round) => {
      const requirements = meetsRoundRequirements(round, ctx);
      let state: RoundState;
      if (now.getTime() >= round.endAt.getTime()) state = "ENDED";
      // บัตรหมดแล้ว → รอบที่ยังไม่ถึงเวลา "ไม่ได้ขายแล้ว" ไม่ใช่แค่ยังไม่เริ่ม
      else if (opts.soldOut) state = "SOLD_OUT";
      else if (now.getTime() < round.startAt.getTime()) state = "UPCOMING";
      else state = requirements.ok ? "OPEN_ELIGIBLE" : "OPEN_DENIED";

      return {
        round,
        state,
        denyReason: requirements.ok ? null : requirements.reason,
        // ปุ่ม "ลงทะเบียนล่วงหน้า" ต้องโผล่เฉพาะคนที่ผ่านคุณสมบัติของรอบแล้วเท่านั้น —
        //   ถ้าโชว์ให้คนที่ไม่ใช่กลุ่มเป้าหมาย กดแล้วจะเด้ง error จาก server เปล่า ๆ
        canPreRegisterNow:
          !opts.soldOut &&
          isPreRegisterOpen(round, now) &&
          !ctx.preRegisteredRoundIds.includes(round.id) &&
          meetsAudienceRequirements(round, ctx).ok,
        preRegistered: ctx.preRegisteredRoundIds.includes(round.id),
        unlocked: ctx.unlockedRoundIds.includes(round.id),
      };
    });
}

// ------------------------------------------------------------
// ส่วนที่ 2: อ่าน DB
// ------------------------------------------------------------

const ROUND_SELECT = {
  id: true,
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

type RoundRow = {
  id: bigint;
  name: string;
  audience: RoundAudience;
  startAt: Date;
  endAt: Date;
  requiresPreRegistration: boolean;
  preRegisterStartAt: Date | null;
  preRegisterEndAt: Date | null;
  maxTicketsPerUser: number | null;
  seatQuota: number | null;
};

function toRoundLike(r: RoundRow): RoundLike {
  return { ...r, id: r.id.toString() };
}

export async function loadRounds(concertId: string | bigint): Promise<RoundLike[]> {
  const rows = await prisma.saleRound.findMany({
    where: { concertId: typeof concertId === "bigint" ? concertId : BigInt(concertId) },
    select: ROUND_SELECT,
    orderBy: { startAt: "asc" },
  });
  return rows.map(toRoundLike);
}

// ดึงบริบทผู้ใช้ทีเดียว (สมาชิก + ลงทะเบียนล่วงหน้า + โค้ดที่ปลดล็อกแล้ว) เฉพาะคอนเสิร์ตนี้
export async function loadUserRoundContext(
  userId: string | bigint,
  concertId: string | bigint,
  now: Date = new Date()
): Promise<UserRoundContext> {
  const uid = typeof userId === "bigint" ? userId : BigInt(userId);
  const cid = typeof concertId === "bigint" ? concertId : BigInt(concertId);

  const [membership, preRegs, redemptions] = await Promise.all([
    getActiveMembership(uid, now),
    prisma.preRegistration.findMany({
      where: { userId: uid, saleRound: { concertId: cid } },
      select: { saleRoundId: true },
    }),
    prisma.accessCodeRedemption.findMany({
      where: { userId: uid, accessCode: { saleRound: { concertId: cid } } },
      select: { accessCode: { select: { saleRoundId: true } } },
    }),
  ]);

  return {
    membership: membership ? { tier: membership.tier } : null,
    preRegisteredRoundIds: preRegs.map((p) => p.saleRoundId.toString()),
    unlockedRoundIds: redemptions.map((r) => r.accessCode.saleRoundId.toString()),
  };
}

// context เปล่าสำหรับคอนเสิร์ตที่ไม่มีรอบ — ไม่ต้องโหลดสมาชิก/ลงทะเบียน/โค้ดสิทธิ์ (ไม่มีรอบให้เทียบ)
const NO_ROUND_CONTEXT: UserRoundContext = {
  membership: null,
  preRegisteredRoundIds: [],
  unlockedRoundIds: [],
};

// ⭐ ตัวที่ route/action เรียกจริง — คอนเสิร์ตไม่มีรอบ = ไม่มีด่านรอบ (พฤติกรรมเดิม)
//   แต่ "บัตรหมด" ต้องปิดประตูทุกคอนเสิร์ตรวมที่ไม่มีรอบ — เดิม return ok ก่อนเช็คบัตรหมด
//   → คอนเสิร์ตที่ไม่เหลือที่นั่ง (0 ที่นั่ง / ขายหมดแต่ป้าย SOLD_OUT ยังไม่ถูกติด) ปล่อยคนเข้าคิว
//   แล้วค้างตำแหน่ง 1 ตลอดกาล (regression: scripts/test-queue-soldout.ts)
export async function resolveEntryForUser(
  concertId: string | bigint,
  userId: string | bigint,
  now: Date = new Date()
): Promise<EntryDecision> {
  const rounds = await loadRounds(concertId);
  const [ctx, availability] = await Promise.all([
    rounds.length > 0
      ? loadUserRoundContext(userId, concertId, now)
      : Promise.resolve(NO_ROUND_CONTEXT),
    getConcertAvailability(concertId),
  ]);
  return resolveRoundEntry(rounds, ctx, now, { soldOut: availability.soldOut });
}

// นับที่นั่งที่ "ผูกพันแล้ว" ในรอบนี้ (จ่ายแล้ว + ค้างจ่ายที่ยังไม่หมดอายุ) — ใช้คุมโควต้ารอบ
export async function countRoundSeatsCommitted(
  saleRoundId: string | bigint,
  now: Date = new Date()
): Promise<number> {
  return prisma.orderItem.count({
    where: {
      order: {
        saleRoundId: typeof saleRoundId === "bigint" ? saleRoundId : BigInt(saleRoundId),
        OR: [{ status: "PAID" }, { status: "PENDING", expiresAt: { gt: now } }],
      },
    },
  });
}
