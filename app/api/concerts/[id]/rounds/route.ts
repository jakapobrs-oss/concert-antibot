// GET /api/concerts/[id]/rounds — ไทม์ไลน์รอบกดบัตร + สถานะของ "ผู้ใช้ที่เรียก"
// ทำเป็น API แยกเพราะหน้า /concerts/[slug] เป็นหน้า cache (revalidate 60) —
//   ข้อมูลรายบุคคล (เป็นสมาชิกไหม / ลงทะเบียนหรือยัง / ปลดล็อกโค้ดแล้วหรือยัง) ห้ามติดแคชร่วมกัน
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { preRegistrationCodes } from "@/lib/pre-registration";
import { getConcertAvailability } from "@/lib/sold-out";
import {
  loadRounds,
  loadUserRoundContext,
  describeRounds,
  resolveRoundEntry,
  entryDenyMessage,
  countRoundSeatsCommitted,
  AUDIENCE_LABEL,
  DENY_MESSAGE,
  type UserRoundContext,
} from "@/lib/sale-round";

export const dynamic = "force-dynamic";

const GUEST_CTX: UserRoundContext = {
  membership: null,
  preRegisteredRoundIds: [],
  unlockedRoundIds: [],
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // ชื่อ segment ต้องเป็น [id] ให้ตรงกับ app/api/concerts/[id]/zones/... ของสาย seatmap
  // (Next.js ห้ามใช้ชื่อ slug ต่างกันใต้ path เดียวกัน — เจอตอนยก dev server หลัง merge 2026-08-25)
  const { id: concertId } = await params;
  if (!/^\d+$/.test(concertId)) {
    return NextResponse.json({ error: "ไม่พบคอนเสิร์ต" }, { status: 404 });
  }

  const rounds = await loadRounds(concertId);
  // คอนเสิร์ตไม่มีระบบรอบ → บอก client ให้ซ่อนแผงนี้ไปเลย (พฤติกรรมเดิมทุกอย่าง)
  if (rounds.length === 0) {
    return NextResponse.json({ hasRounds: false, rounds: [], entry: null, me: null });
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const now = new Date();
  const [ctx, availability] = await Promise.all([
    userId ? loadUserRoundContext(userId, concertId, now) : Promise.resolve(GUEST_CTX),
    getConcertAvailability(concertId),
  ]);
  const codes = userId ? await preRegistrationCodes(userId, concertId) : {};

  const soldOut = availability.soldOut;
  const described = describeRounds(rounds, ctx, now, { soldOut });
  const entry = resolveRoundEntry(rounds, ctx, now, { soldOut });

  // จำนวนที่นั่งที่ผูกพันแล้วต่อรอบ — โชว์ความคืบหน้าโควต้าเฉพาะรอบที่ตั้งโควต้าไว้
  //   (รอบมีไม่กี่รอบต่อคอนเสิร์ต → นับทีละรอบอ่านง่ายกว่า groupBy แล้ว map กลับ)
  const quotaRounds = rounds.filter((r) => r.seatQuota != null && r.seatQuota > 0);
  const soldByRound = new Map<string, number>(
    await Promise.all(
      quotaRounds.map(
        async (r) => [r.id, await countRoundSeatsCommitted(r.id, now)] as [string, number]
      )
    )
  );

  return NextResponse.json({
    hasRounds: true,
    // 🎫 บัตรหมด = ประกาศทั้งงาน รอบที่ยังไม่เปิดก็ไม่ได้ขายแล้ว (docs/23)
    soldOut,
    seatsLeft: availability.available,
    me: {
      loggedIn: !!userId,
      membershipTier: ctx.membership?.tier ?? null,
    },
    entry: entry.ok
      ? { ok: true, roundId: entry.round?.id ?? null, roundName: entry.round?.name ?? null }
      : {
          ok: false,
          reason: entry.reason,
          message: entryDenyMessage(entry),
          nextRoundAt: entry.nextRound?.startAt.toISOString() ?? null,
        },
    rounds: described.map((d) => ({
      id: d.round.id,
      name: d.round.name,
      audience: d.round.audience,
      audienceLabel: AUDIENCE_LABEL[d.round.audience],
      startAt: d.round.startAt.toISOString(),
      endAt: d.round.endAt.toISOString(),
      state: d.state,
      denyReason: d.denyReason,
      denyMessage: d.denyReason ? DENY_MESSAGE[d.denyReason] : null,
      requiresPreRegistration: d.round.requiresPreRegistration,
      preRegisterEndAt: (d.round.preRegisterEndAt ?? d.round.startAt).toISOString(),
      canPreRegisterNow: d.canPreRegisterNow,
      preRegistered: d.preRegistered,
      preRegCode: codes[d.round.id] ?? null,
      unlocked: d.unlocked,
      maxTicketsPerUser: d.round.maxTicketsPerUser,
      seatQuota: d.round.seatQuota,
      seatsTaken: d.round.seatQuota ? (soldByRound.get(d.round.id) ?? 0) : null,
    })),
  });
}
