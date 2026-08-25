// ============================================================
// Membership (Phase 2) — สมาชิกชั้นเดียว: "เป็น" หรือ "ไม่เป็น"
// ============================================================
// สิทธิ์เดียวที่สมาชิกได้ = เข้ารอบขายก่อน (SaleRound.audience = MEMBER_ONLY)
//   - ไม่มีส่วนลดราคา ไม่เพิ่มเพดานตั๋ว → ไม่แตะทางเดินเงิน/lib/ticket-limit.ts เลย
//   - ถ้าให้สมาชิกซื้อได้เยอะกว่าคนทั่วไป จะขัดกับระบบกันคนกวาดตั๋ว (named ticket)
//
// 🔑 หมดอายุคำนวณสดจาก expiresAt เทียบ now — ไม่มี status EXPIRED และไม่มี cron มาพลิกสถานะ
//    (บั๊กคลาสสิกที่กันไว้: cron ไม่วิ่ง → หมดอายุแล้วแต่ status ยัง ACTIVE → คนหมดอายุยังเข้ารอบสมาชิกได้)
//
// ความสัมพันธ์กับซับสคริปชั่น (Phase 2.2 — docs/22):
//    Subscription = ประวัติการสมัครแต่ละรอบ (ledger) · Membership (ไฟล์นี้) = สิทธิ์ปัจจุบัน
//    ⇒ ด่านตรวจทุกจุดอ่านจากไฟล์นี้เท่านั้น ห้ามไปอ่านตาราง subscriptions ตรง ๆ
//
// สัญญากับสาย sale-round (คนที่ 3) — ตกลงกันตอน D1:
//    isActiveMember(userId)      → boolean  ใช้เป็นด่านหน้ารอบ MEMBER_ONLY
//    getActiveMembership(userId) → รายละเอียด (null = ไม่ใช่สมาชิกที่ยัง active)
//    ทั้งคู่รับ userId เป็น string | bigint และรับ now เข้ามาได้เพื่อให้ทดสอบเวลาได้
import { prisma } from "@/lib/prisma";

// อายุสมาชิกมาตรฐานตอนสมัครเอง (วัน) — ฟรี ต่ออายุได้เมื่อใกล้หมด
export const MEMBERSHIP_DEFAULT_DAYS = 365;

// ระดับสมาชิก (Phase 2.1) — ชั้นสิทธิ์ ไม่ใช่ชั้นราคา: สมัครเองได้ STANDARD เสมอ
//   PREMIUM แอดมินให้เท่านั้น ใช้เปิดสิทธิ์เข้ารอบ FANCLUB (ดู lib/sale-round.ts)
export type MembershipTier = "STANDARD" | "PREMIUM";

// เพดาน "สิทธิ์คงเหลือ" ที่สะสมล่วงหน้าได้ (เดือน) — Phase 2.2
//   ระบบแพ็กเกจให้ซื้อล่วงหน้าได้หลายรอบ ถ้าไม่มีเพดานนี้ กดรัว ๆ = สิทธิ์ยาวเป็นสิบปี
//   (แทนที่ "หน้าต่างต่ออายุ 30 วัน" ของรอบก่อน ซึ่งใช้กับแพ็กเกจหลายระยะเวลาไม่ได้)
export const MAX_PREPAID_MONTHS = 24;

// ------------------------------------------------------------
// ส่วนที่ 1: pure logic (ไม่แตะ DB → unit test ตรง ๆ ได้)
// ------------------------------------------------------------

// สถานะที่ "หน้าจอ" ต้องแยกให้ออก — DB เก็บแค่ ACTIVE/REVOKED ที่เหลือคำนวณเอา
//   NONE = ยังไม่เคยสมัคร · EXPIRED = เคยเป็นแต่เลย expiresAt · REVOKED = แอดมินเพิกถอน
export type MembershipState = "NONE" | "ACTIVE" | "EXPIRED" | "REVOKED";

// รูปร่างขั้นต่ำที่ pure helper ต้องใช้ (รับ row จาก Prisma ได้ตรง ๆ)
export type MembershipLike = {
  status: "ACTIVE" | "REVOKED";
  expiresAt: Date | null;
};

// แกนกลางของทั้งไฟล์: active = status ACTIVE และ (ไม่มีวันหมดอายุ หรือ ยังไม่ถึง expiresAt)
//   ขอบเขต: expiresAt = now พอดี ถือว่า "หมดแล้ว" (ช่วงสิทธิ์เป็น [startedAt, expiresAt) — ปลายเปิด)
export function isMembershipActive(m: MembershipLike | null, now: Date = new Date()): boolean {
  if (!m) return false;
  if (m.status !== "ACTIVE") return false;
  if (m.expiresAt === null) return true;
  return m.expiresAt.getTime() > now.getTime();
}

// แปลงแถวใน DB → สถานะที่เอาไปโชว์ผู้ใช้ได้เลย
export function membershipState(m: MembershipLike | null, now: Date = new Date()): MembershipState {
  if (!m) return "NONE";
  if (m.status === "REVOKED") return "REVOKED"; // เพิกถอนชนะเสมอ ต่อให้ยังไม่ถึงวันหมดอายุ
  return isMembershipActive(m, now) ? "ACTIVE" : "EXPIRED";
}

// วันหมดอายุใหม่หลังสมัคร/ต่ออายุ
//   - ยังไม่หมด → ต่อท้ายของเดิม (วันที่เหลือไม่หาย)
//   - หมดแล้ว/ไม่เคยมี/ถูกเพิกถอน → เริ่มนับใหม่จาก now
//   - days <= 0 → null = ไม่มีวันหมดอายุ (แอดมินเท่านั้น)
export function nextExpiresAt(params: {
  current: Date | null;
  days: number;
  now?: Date;
  active?: boolean; // ต่อท้ายของเดิมได้เฉพาะตอนสิทธิ์ยัง active อยู่ (default: ดูจาก current เทียบ now)
}): Date | null {
  if (params.days <= 0) return null;
  const now = params.now ?? new Date();
  const stackable =
    params.active !== false && params.current !== null && params.current.getTime() > now.getTime();
  const base = stackable ? (params.current as Date) : now;
  return new Date(base.getTime() + params.days * 24 * 60 * 60 * 1000);
}

// เหลืออีกกี่วัน (ปัดขึ้น) — null = ไม่มีวันหมดอายุ, 0 = หมดแล้ว
export function daysLeft(expiresAt: Date | null, now: Date = new Date()): number | null {
  if (expiresAt === null) return null;
  const ms = expiresAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// สิทธิ์คงเหลือเป็น "จำนวนเดือน" (ปัดขึ้น) — ใช้คิดเพดานสมัครล่วงหน้า
//   null = ไม่มีวันหมดอายุ → ถือว่าเต็มเพดานไปเลย (ไม่ต้องให้สมัครเพิ่ม)
export function monthsBetween(from: Date, to: Date | null): number {
  if (to === null) return MAX_PREPAID_MONTHS;
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (30 * 24 * 60 * 60 * 1000));
}

// ผู้ใช้เริ่มรอบใหม่ (สมัคร/ต่ออายุแพ็กเกจ) ได้ตอนนี้ไหม
//   REVOKED → ไม่ได้ (ต้องให้แอดมินปลด) · ที่เหลือ → ได้ถ้ายังไม่ชนเพดานสิทธิ์คงเหลือ
export function canStartNewPeriod(params: {
  state: MembershipState;
  expiresAt: Date | null;
  now?: Date;
  addMonths?: number;
}): boolean {
  if (params.state === "REVOKED") return false;
  if (params.state !== "ACTIVE") return true; // NONE / EXPIRED — เริ่มรอบใหม่ได้เสมอ
  const remaining = monthsBetween(params.now ?? new Date(), params.expiresAt);
  return remaining + (params.addMonths ?? 1) <= MAX_PREPAID_MONTHS;
}

// จุดที่ระบบ "ตรวจสิทธิ์สมาชิก" — ตกลงกับสาย sale-round ว่าตรวจแค่ขาเข้า ไม่ตรวจย้อนหลัง
//   ROUND_ENTRY     = ตอนขอเข้ารอบ/คิวของรอบ MEMBER_ONLY
//   ORDER_CREATE    = ตอนกดจองที่นั่งสร้าง order
//   PAYMENT_CONFIRM = ตอนอัปสลิป/ยืนยันเงินของ order ที่สร้างไปแล้ว
//
// 🔑 กติกา D5 "หมดอายุตอนมี order ค้าง": PAYMENT_CONFIRM ไม่ตรวจสมาชิก
//    order ที่ผ่านด่านตอนสร้างไปแล้ว ต้องจ่ายจบได้เสมอ — ถ้าตัดสิทธิ์กลางทางจะเกิดเคสเลวร้ายที่สุด
//    ของระบบเงินจริง: ผู้ใช้โอนเงินไปแล้วแต่ระบบไม่ออกตั๋วให้ (กลายเป็นงานคืนเงินค้างแทน)
export type MembershipCheckpoint = "ROUND_ENTRY" | "ORDER_CREATE" | "PAYMENT_CONFIRM";

export function requiresActiveMembership(checkpoint: MembershipCheckpoint): boolean {
  return checkpoint !== "PAYMENT_CONFIRM";
}

// ยืนยันตัวตนขั้นต่ำก่อนสมัครสมาชิกเอง — กันปั๊มบัญชีทิ้งเพื่อยึดรอบสมาชิก
//   ผ่านได้ 2 ทาง: (1) ยืนยันอีเมลแล้ว (สมัครด้วย email/password) (2) ล็อกอินผ่าน Google
//   (บัญชี Google ที่ adapter สร้างมี emailVerified = null → ต้องนับ oauth account ด้วย ไม่งั้นบล็อกผิดคน)
export function isIdentityVerified(params: {
  emailVerified: Date | null;
  oauthAccountCount: number;
}): boolean {
  return params.emailVerified !== null || params.oauthAccountCount > 0;
}

// ------------------------------------------------------------
// ส่วนที่ 2: อ่าน/เขียน DB
// ------------------------------------------------------------

// รูปแบบที่ส่งข้าม server → client ได้ (BigInt แปลงเป็น string แล้ว)
export type ActiveMembership = {
  id: string;
  userId: string;
  source: "SELF_SIGNUP" | "ADMIN_GRANT";
  tier: MembershipTier;
  startedAt: Date;
  expiresAt: Date | null; // null = ไม่มีวันหมดอายุ
};

function toBigInt(userId: string | bigint): bigint {
  return typeof userId === "bigint" ? userId : BigInt(userId);
}

// ⭐ สัญญาหลักกับสาย sale-round — คืน null ถ้าไม่ใช่สมาชิกที่ยัง active ณ เวลา now
//    กรองวันหมดอายุใน where (ใช้ index [status, expiresAt]) ไม่ดึงมากรองใน JS
export async function getActiveMembership(
  userId: string | bigint,
  now: Date = new Date()
): Promise<ActiveMembership | null> {
  const row = await prisma.membership.findFirst({
    where: {
      userId: toBigInt(userId),
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true, userId: true, source: true, tier: true, startedAt: true, expiresAt: true },
  });
  if (!row) return null;
  return {
    id: row.id.toString(),
    userId: row.userId.toString(),
    source: row.source,
    tier: row.tier,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
  };
}

// ตัวย่อสำหรับด่านตรวจ (สาย sale-round เรียกตัวนี้เป็นหลัก)
export async function isActiveMember(
  userId: string | bigint,
  now: Date = new Date()
): Promise<boolean> {
  return (await getActiveMembership(userId, now)) !== null;
}

// ข้อมูลเต็มสำหรับ "หน้าสถานะสมาชิก" ของผู้ใช้
//   (ต้องมีแยกจาก getActiveMembership เพราะหน้าจอต้องบอกได้ว่า "หมดอายุ" ต่างจาก "ถูกระงับ")
export type MembershipView = {
  state: MembershipState;
  source: "SELF_SIGNUP" | "ADMIN_GRANT" | null;
  tier: MembershipTier | null;
  startedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  daysLeft: number | null; // เฉพาะตอน ACTIVE, null = ไม่มีวันหมดอายุ
  canRenew: boolean; // ปุ่ม "สมัคร/ต่ออายุ" บนหน้าจอกดได้ไหม
};

export async function getMembershipView(
  userId: string | bigint,
  now: Date = new Date()
): Promise<MembershipView> {
  const row = await prisma.membership.findUnique({
    where: { userId: toBigInt(userId) },
    select: {
      status: true,
      source: true,
      tier: true,
      startedAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  const state = membershipState(row, now);
  return {
    state,
    source: row?.source ?? null,
    tier: row?.tier ?? null,
    startedAt: row?.startedAt ?? null,
    expiresAt: row?.expiresAt ?? null,
    revokedAt: row?.revokedAt ?? null,
    daysLeft: state === "ACTIVE" ? daysLeft(row?.expiresAt ?? null, now) : null,
    canRenew: canStartNewPeriod({ state, expiresAt: row?.expiresAt ?? null, now }),
  };
}

export type MembershipWriteResult =
  | { ok: true; view: MembershipView }
  | { ok: false; error: string };

// ⚠️ ทางเก่า (Phase 2): สมัครฟรี 365 วันแบบไม่มีแพ็กเกจ
//    ตั้งแต่ Phase 2.2 หน้าจอผู้ใช้ไปทาง subscribeToPlan() ใน lib/subscription.ts แทน (docs/22)
//    คงไว้เพื่อความเข้ากันได้ย้อนหลัง + ใช้เป็นทางลัดในสคริปต์/เทส — กติกาเรื่องสิทธิ์เหมือนกันทุกข้อ
// 1 user 1 แถว จึงเป็น upsert ไม่ใช่ create
//   ถูกเพิกถอนอยู่ → สมัครเองใหม่ไม่ได้ (ต้องให้แอดมินปลดให้ ไม่งั้นการเพิกถอนไม่มีความหมาย)
export async function selfSignupMembership(
  userId: string | bigint,
  now: Date = new Date()
): Promise<MembershipWriteResult> {
  const id = toBigInt(userId);

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      emailVerified: true,
      _count: { select: { accounts: true } },
      membership: { select: { status: true, expiresAt: true } },
    },
  });
  if (!user) return { ok: false, error: "ไม่พบบัญชีผู้ใช้" };

  if (
    !isIdentityVerified({
      emailVerified: user.emailVerified,
      oauthAccountCount: user._count.accounts,
    })
  ) {
    return { ok: false, error: "กรุณายืนยันอีเมลก่อนสมัครสมาชิก" };
  }
  if (user.membership?.status === "REVOKED") {
    return { ok: false, error: "สิทธิ์สมาชิกของบัญชีนี้ถูกระงับ กรุณาติดต่อทีมงาน" };
  }

  const state = membershipState(user.membership ?? null, now);
  if (!canStartNewPeriod({ state, expiresAt: user.membership?.expiresAt ?? null, now, addMonths: 12 })) {
    return {
      ok: false,
      error: `สิทธิ์คงเหลือของคุณเกินเพดานแล้ว — สมัครล่วงหน้าได้ไม่เกิน ${MAX_PREPAID_MONTHS} เดือน`,
    };
  }

  const active = isMembershipActive(user.membership ?? null, now);
  const expiresAt = nextExpiresAt({
    current: user.membership?.expiresAt ?? null,
    days: MEMBERSHIP_DEFAULT_DAYS,
    now,
    active,
  });

  await prisma.membership.upsert({
    where: { userId: id },
    create: {
      userId: id,
      status: "ACTIVE",
      source: "SELF_SIGNUP",
      tier: "STANDARD", // สมัครเองได้ระดับมาตรฐานเสมอ — PREMIUM แอดมินให้เท่านั้น
      startedAt: now,
      expiresAt,
    },
    update: {
      status: "ACTIVE",
      source: "SELF_SIGNUP",
      // ⚠️ ไม่แตะ tier — สมาชิกพรีเมียมที่กดต่ออายุเองต้องไม่ถูกลดขั้นเงียบ ๆ
      expiresAt,
      revokedAt: null,
      grantedByUserId: null,
      // หมดอายุไปแล้วค่อยเริ่มรอบใหม่ → นับ startedAt ใหม่ / ถ้ายัง active อยู่คงวันเริ่มเดิมไว้
      ...(active ? {} : { startedAt: now }),
    },
  });

  return { ok: true, view: await getMembershipView(id, now) };
}

// แอดมินให้สิทธิ์/ต่ออายุให้ — days <= 0 = ไม่มีวันหมดอายุ
//   ต่างจาก selfSignup ตรงที่ "ปลดสถานะเพิกถอนได้" (ใช้เป็นทางกลับตัวให้ผู้ใช้ที่โดนระงับ)
export async function grantMembership(params: {
  userId: string | bigint;
  days?: number;
  tier?: MembershipTier; // ไม่ระบุ = คงระดับเดิม (สร้างใหม่ = STANDARD)
  grantedByUserId: string | bigint;
  now?: Date;
}): Promise<MembershipWriteResult> {
  const id = toBigInt(params.userId);
  const now = params.now ?? new Date();
  const days = params.days ?? MEMBERSHIP_DEFAULT_DAYS;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { membership: { select: { status: true, expiresAt: true, tier: true } } },
  });
  if (!user) return { ok: false, error: "ไม่พบบัญชีผู้ใช้" };

  const active = isMembershipActive(user.membership ?? null, now);
  const expiresAt = nextExpiresAt({
    current: user.membership?.expiresAt ?? null,
    days,
    now,
    active,
  });

  await prisma.membership.upsert({
    where: { userId: id },
    create: {
      userId: id,
      status: "ACTIVE",
      source: "ADMIN_GRANT",
      tier: params.tier ?? "STANDARD",
      startedAt: now,
      expiresAt,
      grantedByUserId: toBigInt(params.grantedByUserId),
    },
    update: {
      status: "ACTIVE",
      source: "ADMIN_GRANT",
      expiresAt,
      revokedAt: null,
      grantedByUserId: toBigInt(params.grantedByUserId),
      ...(params.tier ? { tier: params.tier } : {}),
      ...(active ? {} : { startedAt: now }),
    },
  });

  return { ok: true, view: await getMembershipView(id, now) };
}

// แอดมินเพิกถอนสิทธิ์ — เก็บแถวไว้ (ไม่ลบ) เพื่อให้ตามหลังได้ว่าใครเคยเป็นสมาชิกและถูกถอนเมื่อไร
//   ไม่แตะ order/ตั๋วที่ซื้อไปแล้ว — เพิกถอนมีผลกับ "รอบขายครั้งต่อไป" เท่านั้น
export async function revokeMembership(
  userId: string | bigint,
  now: Date = new Date()
): Promise<MembershipWriteResult> {
  const id = toBigInt(userId);
  const existing = await prisma.membership.findUnique({
    where: { userId: id },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "ผู้ใช้รายนี้ยังไม่เป็นสมาชิก" };

  await prisma.membership.update({
    where: { userId: id },
    data: { status: "REVOKED", revokedAt: now },
  });

  return { ok: true, view: await getMembershipView(id, now) };
}
