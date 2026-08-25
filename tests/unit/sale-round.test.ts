// Unit tests — ลำดับรอบพรีเซล (Phase 2.1, docs/21)
// เน้น 3 เรื่องที่พังแล้วเจ็บสุด: (1) คอนเสิร์ตเก่าไม่มีรอบต้องไม่พัง (2) ลำดับสิทธิ์ (3) เพดานตั๋วต้องตึงขึ้นเท่านั้น
import { describe, it, expect } from "vitest";
import {
  audienceRank,
  isRoundOpen,
  isPreRegisterOpen,
  meetsAudienceRequirements,
  meetsRoundRequirements,
  checkRoundEligibility,
  resolveRoundEntry,
  nextEligibleRound,
  effectiveTicketLimit,
  exceedsRoundQuota,
  describeRounds,
  type RoundLike,
  type RoundAudience,
  type UserRoundContext,
} from "@/lib/sale-round";

const now = new Date("2026-08-20T19:15:00+07:00");
const T = (hhmm: string) => new Date(`2026-08-20T${hhmm}:00+07:00`);

function round(over: Partial<RoundLike> & { id: string; audience: RoundAudience }): RoundLike {
  return {
    name: `รอบ ${over.id}`,
    startAt: T("19:00"),
    endAt: T("19:30"),
    requiresPreRegistration: false,
    preRegisterStartAt: null,
    preRegisterEndAt: null,
    maxTicketsPerUser: null,
    seatQuota: null,
    ...over,
  };
}

const guest: UserRoundContext = { membership: null, preRegisteredRoundIds: [], unlockedRoundIds: [] };
const member: UserRoundContext = { ...guest, membership: { tier: "STANDARD" } };
const premium: UserRoundContext = { ...guest, membership: { tier: "PREMIUM" } };

// ============================================================
// 1. ลำดับชั้น + ช่วงเวลา
// ============================================================
describe("audienceRank — ลำดับรอบตามแพลตฟอร์มจริง (แฟนคลับ → พาร์ทเนอร์ → สมาชิก → ทั่วไป)", () => {
  it("เรียงจากเข้ายากสุดไปเปิดกว้างสุด", () => {
    expect(audienceRank("FANCLUB")).toBeLessThan(audienceRank("PARTNER"));
    expect(audienceRank("PARTNER")).toBeLessThan(audienceRank("MEMBER_ONLY"));
    expect(audienceRank("MEMBER_ONLY")).toBeLessThan(audienceRank("PUBLIC"));
  });
});

describe("isRoundOpen — ช่วงรอบเป็น [start, end) ปลายเปิด", () => {
  const r = round({ id: "1", audience: "PUBLIC", startAt: T("19:00"), endAt: T("19:30") });

  it("อยู่ในช่วง → เปิด", () => expect(isRoundOpen(r, T("19:15"))).toBe(true));
  it("เวลาเริ่มพอดี → เปิด", () => expect(isRoundOpen(r, T("19:00"))).toBe(true));
  it("เวลาจบพอดี → ปิดแล้ว (ให้รอบถัดไปรับช่วงต่อได้พอดีไม่ทับกัน)", () =>
    expect(isRoundOpen(r, T("19:30"))).toBe(false));
  it("ก่อนเริ่ม → ยังไม่เปิด", () => expect(isRoundOpen(r, T("18:59"))).toBe(false));
});

describe("isPreRegisterOpen — หน้าต่างลงทะเบียนล่วงหน้า", () => {
  it("ไม่ต้องลงทะเบียน → ไม่มีหน้าต่าง", () => {
    expect(isPreRegisterOpen(round({ id: "1", audience: "FANCLUB" }), now)).toBe(false);
  });

  it("ไม่ตั้งเวลาไว้ → เปิดจนถึงเวลาที่รอบเริ่ม", () => {
    const r = round({ id: "1", audience: "FANCLUB", requiresPreRegistration: true });
    expect(isPreRegisterOpen(r, T("18:00"))).toBe(true);
    expect(isPreRegisterOpen(r, T("19:00"))).toBe(false); // รอบเริ่มแล้ว ปิดรับลงทะเบียน
  });

  it("ตั้งช่วงเวลาไว้ → นอกช่วงลงไม่ได้ (แบบ Weverse ที่ต้องกดในช่วงที่ประกาศ)", () => {
    const r = round({
      id: "1",
      audience: "FANCLUB",
      requiresPreRegistration: true,
      preRegisterStartAt: T("10:00"),
      preRegisterEndAt: T("12:00"),
    });
    expect(isPreRegisterOpen(r, T("09:59"))).toBe(false);
    expect(isPreRegisterOpen(r, T("10:00"))).toBe(true);
    expect(isPreRegisterOpen(r, T("11:59"))).toBe(true);
    expect(isPreRegisterOpen(r, T("12:00"))).toBe(false);
  });
});

// ============================================================
// 2. คุณสมบัติผู้เข้ารอบ
// ============================================================
describe("meetsAudienceRequirements — ใครเข้ารอบไหนได้", () => {
  it("PUBLIC — ใครก็เข้าได้ แม้ไม่ล็อกอินเป็นสมาชิก", () => {
    expect(meetsAudienceRequirements(round({ id: "1", audience: "PUBLIC" }), guest).ok).toBe(true);
  });

  it("MEMBER_ONLY — สมาชิกทุกระดับเข้าได้ คนทั่วไปไม่ได้", () => {
    const r = round({ id: "1", audience: "MEMBER_ONLY" });
    expect(meetsAudienceRequirements(r, member).ok).toBe(true);
    expect(meetsAudienceRequirements(r, premium).ok).toBe(true);
    expect(meetsAudienceRequirements(r, guest)).toEqual({ ok: false, reason: "NOT_MEMBER" });
  });

  it("FANCLUB — เฉพาะสมาชิกพรีเมียม (สมาชิกธรรมดาได้เหตุผลว่าต้องอัประดับ ไม่ใช่ 'ไม่ใช่สมาชิก')", () => {
    const r = round({ id: "1", audience: "FANCLUB" });
    expect(meetsAudienceRequirements(r, premium).ok).toBe(true);
    expect(meetsAudienceRequirements(r, member)).toEqual({ ok: false, reason: "NEED_PREMIUM" });
    expect(meetsAudienceRequirements(r, guest)).toEqual({ ok: false, reason: "NOT_MEMBER" });
  });

  it("PARTNER — ต้องปลดล็อกด้วยโค้ดสิทธิ์ (เป็นสมาชิกก็ไม่ช่วย)", () => {
    const r = round({ id: "9", audience: "PARTNER" });
    expect(meetsAudienceRequirements(r, premium)).toEqual({ ok: false, reason: "NEED_ACCESS_CODE" });
    expect(meetsAudienceRequirements(r, { ...guest, unlockedRoundIds: ["9"] }).ok).toBe(true);
  });
});

describe("meetsRoundRequirements — ลงทะเบียนล่วงหน้าเป็นด่านซ้อน (สมาชิกอย่างเดียวไม่พอ)", () => {
  const r = round({ id: "5", audience: "FANCLUB", requiresPreRegistration: true });

  it("❌ พรีเมียมแต่ยังไม่ลงทะเบียนล่วงหน้า → เข้าไม่ได้", () => {
    expect(meetsRoundRequirements(r, premium)).toEqual({
      ok: false,
      reason: "NEED_PRE_REGISTRATION",
    });
  });

  it("พรีเมียม + ลงทะเบียนแล้ว → เข้าได้", () => {
    expect(meetsRoundRequirements(r, { ...premium, preRegisteredRoundIds: ["5"] }).ok).toBe(true);
  });

  it("ลงทะเบียนแล้วแต่ไม่ใช่พรีเมียม → ยังติดด่านกลุ่มผู้มีสิทธิ์", () => {
    expect(meetsRoundRequirements(r, { ...member, preRegisteredRoundIds: ["5"] })).toEqual({
      ok: false,
      reason: "NEED_PREMIUM",
    });
  });
});

describe("checkRoundEligibility — เวลามาก่อนคุณสมบัติ", () => {
  it("คุณสมบัติผ่านแต่ยังไม่ถึงเวลา → ROUND_CLOSED", () => {
    const r = round({ id: "1", audience: "PUBLIC", startAt: T("20:00"), endAt: T("21:00") });
    expect(checkRoundEligibility(r, guest, now)).toEqual({ ok: false, reason: "ROUND_CLOSED" });
  });
});

// ============================================================
// 3. ด่านหลัก resolveRoundEntry
// ============================================================
describe("resolveRoundEntry — ด่านที่คิวและการจองเรียกใช้", () => {
  it("🔑 คอนเสิร์ตไม่มีรอบเลย → ผ่านเสมอ (คอนเสิร์ตเก่าต้องไม่พัง)", () => {
    expect(resolveRoundEntry([], guest, now)).toEqual({ ok: true, round: null });
  });

  it("รอบทั่วไปกำลังเปิด → คนทั่วไปเข้าได้", () => {
    const rounds = [round({ id: "1", audience: "PUBLIC" })];
    const res = resolveRoundEntry(rounds, guest, now);
    expect(res.ok).toBe(true);
    expect(res.ok && res.round?.id).toBe("1");
  });

  it("รอบสมาชิกกำลังเปิด + คนทั่วไป → ถูกปฏิเสธ พร้อมบอกว่ารอบทั่วไปเริ่มกี่โมง", () => {
    const rounds = [
      round({ id: "1", audience: "MEMBER_ONLY", startAt: T("19:00"), endAt: T("19:30") }),
      round({ id: "2", audience: "PUBLIC", startAt: T("19:30"), endAt: T("23:00") }),
    ];
    const res = resolveRoundEntry(rounds, guest, now);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("NOT_MEMBER");
      expect(res.nextRound?.startAt).toEqual(T("19:30"));
      expect(res.nextRound?.audience).toBe("PUBLIC");
    }
  });

  it("สมาชิกเข้ารอบสมาชิกได้", () => {
    const rounds = [round({ id: "1", audience: "MEMBER_ONLY" })];
    expect(resolveRoundEntry(rounds, member, now).ok).toBe(true);
  });

  it("รอบซ้อนกันหลายรอบ → เลือกรอบที่จำกัดที่สุดที่ผู้ใช้เข้าได้ (order ถูกบันทึกเข้ารอบที่ถูก)", () => {
    const rounds = [
      round({ id: "fan", audience: "FANCLUB" }),
      round({ id: "mem", audience: "MEMBER_ONLY" }),
      round({ id: "pub", audience: "PUBLIC" }),
    ];
    const res = resolveRoundEntry(rounds, premium, now);
    expect(res.ok && res.round?.id).toBe("fan");

    const res2 = resolveRoundEntry(rounds, member, now);
    expect(res2.ok && res2.round?.id).toBe("mem");

    const res3 = resolveRoundEntry(rounds, guest, now);
    expect(res3.ok && res3.round?.id).toBe("pub");
  });

  it("ยังไม่ถึงเวลารอบไหนเลย → ROUND_CLOSED + บอกรอบถัดไปที่ตัวเองมีสิทธิ์", () => {
    const rounds = [
      round({ id: "1", audience: "MEMBER_ONLY", startAt: T("20:00"), endAt: T("20:30") }),
      round({ id: "2", audience: "PUBLIC", startAt: T("20:30"), endAt: T("23:00") }),
    ];
    const res = resolveRoundEntry(rounds, member, now);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("ROUND_CLOSED");
      expect(res.nextRound?.startAt).toEqual(T("20:00")); // สมาชิกได้รอบ 20:00 ไม่ใช่ 20:30
    }
  });

  it("รอบพาร์ทเนอร์เปิดอยู่ ไม่มีโค้ด → NEED_ACCESS_CODE", () => {
    const rounds = [round({ id: "p", audience: "PARTNER" })];
    const res = resolveRoundEntry(rounds, member, now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("NEED_ACCESS_CODE");
  });

  it("มีโค้ดแล้ว → เข้ารอบพาร์ทเนอร์ได้", () => {
    const rounds = [round({ id: "p", audience: "PARTNER" })];
    expect(resolveRoundEntry(rounds, { ...guest, unlockedRoundIds: ["p"] }, now).ok).toBe(true);
  });

  it("รอบแฟนคลับที่ต้องลงทะเบียนล่วงหน้า — พรีเมียมที่ลืมลงทะเบียน เข้าไม่ได้", () => {
    const rounds = [round({ id: "f", audience: "FANCLUB", requiresPreRegistration: true })];
    const res = resolveRoundEntry(rounds, premium, now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("NEED_PRE_REGISTRATION");
  });

  it("รอบหมดเวลาไปแล้วทั้งหมด → ROUND_CLOSED และไม่มีรอบถัดไป", () => {
    const rounds = [round({ id: "1", audience: "PUBLIC", startAt: T("10:00"), endAt: T("11:00") })];
    const res = resolveRoundEntry(rounds, guest, now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.nextRound).toBeNull();
  });
});

describe("nextEligibleRound — บอกผู้ใช้ว่ารออีกนานแค่ไหน", () => {
  const rounds = [
    round({ id: "f", audience: "FANCLUB", startAt: T("20:00"), endAt: T("20:30") }),
    round({ id: "m", audience: "MEMBER_ONLY", startAt: T("20:30"), endAt: T("21:00") }),
    round({ id: "p", audience: "PUBLIC", startAt: T("21:00"), endAt: T("23:00") }),
  ];

  it("คนทั่วไป → ได้รอบทั่วไป 21:00", () => {
    expect(nextEligibleRound(rounds, guest, now)?.startAt).toEqual(T("21:00"));
  });
  it("สมาชิกธรรมดา → ได้รอบสมาชิก 20:30", () => {
    expect(nextEligibleRound(rounds, member, now)?.startAt).toEqual(T("20:30"));
  });
  it("สมาชิกพรีเมียม → ได้รอบแฟนคลับ 20:00", () => {
    expect(nextEligibleRound(rounds, premium, now)?.startAt).toEqual(T("20:00"));
  });
});

// ============================================================
// 4. เพดานตั๋ว + โควต้าที่นั่ง
// ============================================================
describe("effectiveTicketLimit — รอบตึงกว่าได้ แต่ผ่อนให้หลวมกว่าไม่ได้", () => {
  it("รอบพรีเซลจำกัด 2 ใบ ขณะคอนเสิร์ตให้ 4 → ใช้ 2", () => {
    expect(effectiveTicketLimit(4, 2)).toBe(2);
  });
  it("🔑 รอบพยายามให้ 10 ใบ ขณะคอนเสิร์ตให้ 4 → ยังได้แค่ 4 (สมาชิกห้ามซื้อเยอะกว่าคนทั่วไป)", () => {
    expect(effectiveTicketLimit(4, 10)).toBe(4);
  });
  it("รอบไม่ตั้งค่า → ใช้ของคอนเสิร์ต", () => {
    expect(effectiveTicketLimit(4, null)).toBe(4);
    expect(effectiveTicketLimit(4, 0)).toBe(4);
  });
});

describe("exceedsRoundQuota — โควต้าที่นั่งที่ล็อกไว้ให้รอบ", () => {
  it("ยังไม่เกินโควต้า", () => {
    expect(exceedsRoundQuota({ sold: 48, requested: 2, quota: 50 })).toBe(false);
  });
  it("❌ เกินโควต้า → ปฏิเสธ", () => {
    expect(exceedsRoundQuota({ sold: 49, requested: 2, quota: 50 })).toBe(true);
  });
  it("ไม่ตั้งโควต้า → ไม่จำกัดเพิ่มจากที่นั่งจริง", () => {
    expect(exceedsRoundQuota({ sold: 999, requested: 5, quota: null })).toBe(false);
    expect(exceedsRoundQuota({ sold: 999, requested: 5, quota: 0 })).toBe(false);
  });
});

// ============================================================
// 5. หน้าจอไทม์ไลน์รอบ
// ============================================================
describe("describeRounds — สถานะรายรอบสำหรับหน้าคอนเสิร์ต", () => {
  const rounds = [
    round({ id: "past", audience: "FANCLUB", startAt: T("10:00"), endAt: T("11:00") }),
    round({ id: "open", audience: "MEMBER_ONLY", startAt: T("19:00"), endAt: T("19:30") }),
    round({
      id: "soon",
      audience: "FANCLUB",
      startAt: T("20:00"),
      endAt: T("21:00"),
      requiresPreRegistration: true,
      preRegisterStartAt: T("19:00"),
      preRegisterEndAt: T("19:45"),
    }),
  ];

  it("เรียงตามเวลาเริ่ม + ให้สถานะครบ 4 แบบ", () => {
    const got = describeRounds(rounds, member, now);
    expect(got.map((g) => g.round.id)).toEqual(["past", "open", "soon"]);
    expect(got[0].state).toBe("ENDED");
    expect(got[1].state).toBe("OPEN_ELIGIBLE"); // สมาชิก + รอบสมาชิกเปิดอยู่
    expect(got[2].state).toBe("UPCOMING");
  });

  it("รอบที่เข้าไม่ได้ → OPEN_DENIED พร้อมเหตุผลไว้แสดงบนการ์ด", () => {
    const got = describeRounds(rounds, guest, now);
    expect(got[1].state).toBe("OPEN_DENIED");
    expect(got[1].denyReason).toBe("NOT_MEMBER");
  });

  it("บอกได้ว่าตอนนี้กดลงทะเบียนล่วงหน้าได้ไหม", () => {
    const got = describeRounds(rounds, premium, now);
    expect(got[2].canPreRegisterNow).toBe(true); // 19:15 อยู่ในช่วง 19:00-19:45
    const after = describeRounds(rounds, premium, T("19:50"));
    expect(after[2].canPreRegisterNow).toBe(false);
  });

  it("❌ คนที่ไม่ผ่านคุณสมบัติของรอบ → ไม่โชว์ปุ่มลงทะเบียน (กดไปก็โดน server ปฏิเสธ)", () => {
    const asMember = describeRounds(rounds, member, now); // รอบ soon เป็น FANCLUB ต้องพรีเมียม
    expect(asMember[2].canPreRegisterNow).toBe(false);
    const asGuest = describeRounds(rounds, guest, now);
    expect(asGuest[2].canPreRegisterNow).toBe(false);
  });

  it("ลงทะเบียนแล้ว → ไม่ต้องโชว์ปุ่มซ้ำ", () => {
    const got = describeRounds(rounds, { ...premium, preRegisteredRoundIds: ["soon"] }, now);
    expect(got[2].preRegistered).toBe(true);
    expect(got[2].canPreRegisterNow).toBe(false);
  });
});
