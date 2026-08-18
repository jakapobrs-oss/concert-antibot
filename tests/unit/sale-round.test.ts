// Unit tests — รอบกดบัตร "สมาชิกกดก่อน" (Phase 2)
//
// สิ่งที่ต้องพิสูจน์ (เรียงตามความเสียหายถ้าพลาด):
//   1. คอนเสิร์ตที่ไม่ได้ตั้งรอบ ต้องทำงานเหมือนเดิมทุกอย่าง (คอนเสิร์ตเก่าห้ามพัง)
//   2. คนทั่วไปต้องเข้ารอบสมาชิกไม่ได้ (ถ้ารั่ว = ฟีเจอร์นี้ไม่มีความหมาย)
//   3. สมาชิกต้องเข้ารอบทั่วไปได้ด้วย (ถ้าพลาด = สมาชิกโดนกันออกจากรอบที่ทุกคนเข้าได้)
//   4. ข้อความที่บอกผู้ใช้ต้องชี้ไปที่รอบที่ "คนนั้น" เข้าได้จริง ไม่ใช่รอบถัดไปเฉย ๆ
import { describe, it, expect } from "vitest";
import {
  resolveSaleAccess,
  isRoundOpenAt,
  canAudienceEnter,
  validateRoundWindow,
  type SaleRoundLike,
} from "@/lib/sale-round";

const at = (iso: string) => new Date(iso);

// สถานการณ์มาตรฐานที่ใช้ทั้งไฟล์ — ตรงกับเรื่องเล่าวันสาธิต:
// รอบสมาชิก 19:00-19:30 แล้วรอบทั่วไปต่อทันที 19:30-21:00
const MEMBER_ROUND: SaleRoundLike = {
  id: "1",
  name: "รอบสมาชิก",
  audience: "MEMBER_ONLY",
  startAt: at("2026-08-25T19:00:00+07:00"),
  endAt: at("2026-08-25T19:30:00+07:00"),
};
const PUBLIC_ROUND: SaleRoundLike = {
  id: "2",
  name: "รอบทั่วไป",
  audience: "PUBLIC",
  startAt: at("2026-08-25T19:30:00+07:00"),
  endAt: at("2026-08-25T21:00:00+07:00"),
};
const ROUNDS = [MEMBER_ROUND, PUBLIC_ROUND];

describe("🔴 คอนเสิร์ตที่ไม่ได้ตั้งรอบ — ต้องทำงานเหมือนเดิม", () => {
  it("ไม่มีรอบเลย: คนทั่วไปผ่าน", () => {
    const v = resolveSaleAccess({ rounds: [], now: at("2026-08-25T10:00:00+07:00"), isMember: false });
    expect(v.allowed).toBe(true);
  });

  it("ไม่มีรอบเลย: สมาชิกก็ผ่าน และ round เป็น null (ไม่ได้อยู่รอบไหน)", () => {
    const v = resolveSaleAccess({ rounds: [], now: at("2026-08-25T10:00:00+07:00"), isMember: true });
    expect(v).toEqual({ allowed: true, round: null });
  });
});

describe("🔴 รอบสมาชิก — คนทั่วไปต้องเข้าไม่ได้", () => {
  const during = at("2026-08-25T19:10:00+07:00"); // อยู่กลางรอบสมาชิก

  it("สมาชิกเข้าได้ และได้รอบสมาชิกกลับมา", () => {
    const v = resolveSaleAccess({ rounds: ROUNDS, now: during, isMember: true });
    expect(v.allowed).toBe(true);
    if (v.allowed) expect(v.round?.name).toBe("รอบสมาชิก");
  });

  it("คนทั่วไปถูกปฏิเสธด้วยเหตุผล MEMBER_ONLY", () => {
    const v = resolveSaleAccess({ rounds: ROUNDS, now: during, isMember: false });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toBe("MEMBER_ONLY");
  });

  it("คนทั่วไปต้องได้เวลาเปิดของ *รอบทั่วไป* ไม่ใช่เวลาอื่น", () => {
    const v = resolveSaleAccess({ rounds: ROUNDS, now: during, isMember: false });
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.nextOpenAt?.toISOString()).toBe(PUBLIC_ROUND.startAt.toISOString());
      expect(v.currentRound?.name).toBe("รอบสมาชิก");
      expect(v.message).toContain("สมาชิกเท่านั้น");
    }
  });
});

describe("รอบทั่วไป — ทุกคนเข้าได้", () => {
  const during = at("2026-08-25T20:00:00+07:00");

  it("คนทั่วไปเข้าได้", () => {
    const v = resolveSaleAccess({ rounds: ROUNDS, now: during, isMember: false });
    expect(v.allowed).toBe(true);
    if (v.allowed) expect(v.round?.name).toBe("รอบทั่วไป");
  });

  it("สมาชิกก็เข้าได้ (สิทธิ์สมาชิกไม่ได้กันตัวเองออกจากรอบทั่วไป)", () => {
    const v = resolveSaleAccess({ rounds: ROUNDS, now: during, isMember: true });
    expect(v.allowed).toBe(true);
  });
});

describe("ขอบเขตเวลา — ช่วงเป็นแบบ [เริ่ม, จบ)", () => {
  it("วินาทีที่รอบเริ่มพอดี = เข้าได้แล้ว", () => {
    const v = resolveSaleAccess({ rounds: ROUNDS, now: MEMBER_ROUND.startAt, isMember: true });
    expect(v.allowed).toBe(true);
  });

  it("วินาทีที่รอบสมาชิกจบพอดี = รอบทั่วไปเริ่มทันที ไม่มีช่องว่างให้ตกหล่น", () => {
    // 19:30 ตรง: รอบสมาชิกจบ (endAt) และรอบทั่วไปเริ่ม (startAt) พร้อมกัน
    const v = resolveSaleAccess({ rounds: ROUNDS, now: MEMBER_ROUND.endAt, isMember: false });
    expect(v.allowed).toBe(true);
    if (v.allowed) expect(v.round?.name).toBe("รอบทั่วไป");
  });

  it("ก่อนรอบแรก = NOT_STARTED พร้อมเวลาเปิด", () => {
    const v = resolveSaleAccess({
      rounds: ROUNDS,
      now: at("2026-08-25T18:00:00+07:00"),
      isMember: true,
    });
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.reason).toBe("NOT_STARTED");
      expect(v.nextOpenAt?.toISOString()).toBe(MEMBER_ROUND.startAt.toISOString());
    }
  });

  it("ก่อนรอบแรก แต่เป็นคนทั่วไป -> ชี้ไปรอบทั่วไป ไม่ใช่รอบสมาชิกที่เข้าไม่ได้", () => {
    const v = resolveSaleAccess({
      rounds: ROUNDS,
      now: at("2026-08-25T18:00:00+07:00"),
      isMember: false,
    });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.nextOpenAt?.toISOString()).toBe(PUBLIC_ROUND.startAt.toISOString());
  });

  it("หลังรอบสุดท้าย = ENDED และไม่มีเวลาเปิดถัดไป", () => {
    const v = resolveSaleAccess({
      rounds: ROUNDS,
      now: at("2026-08-25T22:00:00+07:00"),
      isMember: true,
    });
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.reason).toBe("ENDED");
      expect(v.nextOpenAt).toBeNull();
    }
  });

  it("ช่องว่างระหว่างรอบ (แอดมินตั้งเว้นไว้) = NOT_STARTED ไม่ใช่ ENDED", () => {
    const gapped = [
      MEMBER_ROUND,
      { ...PUBLIC_ROUND, startAt: at("2026-08-25T20:00:00+07:00") },
    ];
    const v = resolveSaleAccess({
      rounds: gapped,
      now: at("2026-08-25T19:45:00+07:00"),
      isMember: true,
    });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toBe("NOT_STARTED");
  });
});

describe("รอบที่ทับกัน — ต้องใช้รอบที่ผ่อนปรนที่สุด", () => {
  // แอดมินตั้งพลาดให้รอบทั่วไปเริ่มก่อนรอบสมาชิกจบ — คนทั่วไปต้องเข้าได้ ไม่ใช่โดนกัน
  const overlapping: SaleRoundLike[] = [
    MEMBER_ROUND,
    { ...PUBLIC_ROUND, startAt: at("2026-08-25T19:15:00+07:00") },
  ];

  it("คนทั่วไปเข้าได้เมื่อมีรอบทั่วไปทับอยู่ด้วย", () => {
    const v = resolveSaleAccess({
      rounds: overlapping,
      now: at("2026-08-25T19:20:00+07:00"),
      isMember: false,
    });
    expect(v.allowed).toBe(true);
  });

  it("ลำดับรอบใน array ไม่มีผลต่อคำตัดสิน", () => {
    const now = at("2026-08-25T19:20:00+07:00");
    const a = resolveSaleAccess({ rounds: overlapping, now, isMember: false });
    const b = resolveSaleAccess({ rounds: [...overlapping].reverse(), now, isMember: false });
    expect(a.allowed).toBe(b.allowed);
  });
});

describe("ตัวช่วยระดับล่าง", () => {
  it("isRoundOpenAt: นับ startAt แต่ไม่นับ endAt", () => {
    expect(isRoundOpenAt(MEMBER_ROUND, MEMBER_ROUND.startAt)).toBe(true);
    expect(isRoundOpenAt(MEMBER_ROUND, MEMBER_ROUND.endAt)).toBe(false);
  });

  it("canAudienceEnter: รอบทั่วไปเข้าได้ทุกคน รอบสมาชิกเฉพาะสมาชิก", () => {
    expect(canAudienceEnter(PUBLIC_ROUND, false)).toBe(true);
    expect(canAudienceEnter(PUBLIC_ROUND, true)).toBe(true);
    expect(canAudienceEnter(MEMBER_ROUND, false)).toBe(false);
    expect(canAudienceEnter(MEMBER_ROUND, true)).toBe(true);
  });

  it("validateRoundWindow: ปิดต้องหลังเปิด และไม่รับวันที่พัง", () => {
    expect(validateRoundWindow(MEMBER_ROUND.startAt, MEMBER_ROUND.endAt)).toBeNull();
    expect(validateRoundWindow(MEMBER_ROUND.endAt, MEMBER_ROUND.startAt)).toContain("หลังเวลาเปิด");
    expect(validateRoundWindow(MEMBER_ROUND.startAt, MEMBER_ROUND.startAt)).toContain("หลังเวลาเปิด");
    expect(validateRoundWindow(new Date("ไม่ใช่วันที่"), MEMBER_ROUND.endAt)).toContain("ไม่ถูกต้อง");
  });
});
