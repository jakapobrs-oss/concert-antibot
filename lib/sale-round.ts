// ============================================================
// Sale Round — รอบกดบัตร "สมาชิกกดก่อน" (Phase 2)
// ============================================================
// 🔑 ดีไซน์ที่ปกป้องผลวิจัยในเล่ม:
//    "สมาชิกกดก่อน" ทำเป็น **รอบเวลาแยก** ไม่ใช่ให้สมาชิกแซงคิวในรอบเดียวกัน
//    -> คิวในแต่ละรอบยังเป็น FIFO เป็นธรรมเหมือนเดิม -> สถิติความเป็นธรรมในเล่มยังใช้ได้
//    (ถ้าทำเป็นคิวลำดับความสำคัญ จะต้องวัดผลใหม่ทั้งบท — ตัดสินใจไปแล้วว่าไม่ทำ)
//
// กติกาการบังคับใช้:
//    - Concert.status = ON_SALE ยังเป็นสวิตช์หลักเหมือนเดิม รอบเป็นด่าน "ซ้อนทับ" ไม่ใช่มาแทน
//      (ผู้เรียกเช็ค ON_SALE เองก่อน แล้วค่อยเรียกไฟล์นี้)
//    - 🔴 คอนเสิร์ตที่ไม่มีรอบเลย = พฤติกรรมเดิมทุกอย่าง -> คอนเสิร์ตเก่าไม่พังจากฟีเจอร์นี้
//    - ผ่านได้เมื่อ: มีรอบที่ตอนนี้อยู่ในช่วง [startAt, endAt) และ (รอบทั่วไป หรือ เป็นสมาชิก)
//
// เขียนเป็น pure function ทั้งไฟล์ — ไม่แตะฐานข้อมูล ไม่อ่านนาฬิกาเอง (รับ now เข้ามา)
// เพื่อให้เทสกำหนดเวลาได้เองและไม่มีเทสที่ผลลัพธ์เปลี่ยนตามเวลาที่รัน

export type SaleRoundAudienceLike = "MEMBER_ONLY" | "PUBLIC";

export interface SaleRoundLike {
  id: string;
  name: string;
  audience: SaleRoundAudienceLike;
  startAt: Date;
  endAt: Date;
}

export type SaleAccessVerdict =
  /** ผ่าน — `round` เป็น null เมื่อคอนเสิร์ตนี้ไม่ได้ตั้งรอบไว้เลย (พฤติกรรมเดิม) */
  | { allowed: true; round: SaleRoundLike | null }
  | {
      allowed: false;
      /**
       * MEMBER_ONLY  = ตอนนี้อยู่ในรอบสมาชิก แต่คนนี้ไม่ใช่สมาชิก (เคสหลักของฟีเจอร์)
       * NOT_STARTED  = ยังไม่ถึงรอบที่คนนี้เข้าได้ (อาจอยู่ในช่องว่างระหว่างรอบด้วย)
       * ENDED        = ไม่มีรอบไหนที่คนนี้เข้าได้อีกแล้ว
       */
      reason: "MEMBER_ONLY" | "NOT_STARTED" | "ENDED";
      message: string;
      /** เวลาที่รอบถัดไปซึ่ง "คนนี้" เข้าได้จะเปิด — null เมื่อไม่มีอีกแล้ว */
      nextOpenAt: Date | null;
      /** รอบที่กำลังเปิดอยู่ตอนนี้ (ถ้ามี) — ใช้บอกผู้ใช้ว่าตอนนี้เป็นรอบอะไร */
      currentRound: SaleRoundLike | null;
    };

/** รอบนี้ครอบเวลานี้อยู่ไหม — ช่วงเป็นแบบ [เริ่ม, จบ) ให้รอบต่อกันได้พอดีโดยไม่ทับกัน */
export function isRoundOpenAt(round: SaleRoundLike, now: Date): boolean {
  const t = now.getTime();
  return round.startAt.getTime() <= t && t < round.endAt.getTime();
}

/** คนแบบนี้เข้ารอบนี้ได้ไหม (ไม่สนเวลา) — รอบทั่วไปเข้าได้ทุกคน รวมสมาชิกด้วย */
export function canAudienceEnter(round: SaleRoundLike, isMember: boolean): boolean {
  return round.audience === "PUBLIC" || isMember;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

/**
 * ตัดสินว่า user คนนี้กดบัตรคอนเสิร์ตนี้ได้ตอนนี้ไหม
 *
 * เจตนาเรื่องรอบที่ทับกัน: ถ้าเวลานี้อยู่ในหลายรอบพร้อมกัน ให้ใช้รอบที่ "ผ่อนปรนที่สุด"
 * คือถ้ามีรอบไหนที่คนนี้เข้าได้ก็ผ่าน — แอดมินตั้งรอบทับกันโดยไม่ตั้งใจต้องไม่ทำให้คนเข้าไม่ได้
 */
export function resolveSaleAccess(params: {
  rounds: SaleRoundLike[];
  now: Date;
  isMember: boolean;
}): SaleAccessVerdict {
  const { rounds, now, isMember } = params;

  // ไม่ได้ตั้งรอบไว้ = ระบบเดิมก่อนมีฟีเจอร์นี้ ปล่อยผ่านทั้งหมด
  if (rounds.length === 0) return { allowed: true, round: null };

  const openNow = rounds.filter((r) => isRoundOpenAt(r, now));

  // ผ่านทันทีถ้ามีรอบที่เปิดอยู่และคนนี้เข้าได้
  const enterable = openNow.find((r) => canAudienceEnter(r, isMember));
  if (enterable) return { allowed: true, round: enterable };

  // รอบถัดไปที่ "คนนี้" เข้าได้ (ไม่ใช่รอบถัดไปเฉย ๆ — คนทั่วไปต้องรอรอบทั่วไป ไม่ใช่รอบสมาชิกถัดไป)
  const nextEnterable = rounds
    .filter((r) => canAudienceEnter(r, isMember) && r.startAt.getTime() > now.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];
  const nextOpenAt = nextEnterable?.startAt ?? null;

  // กำลังอยู่ในรอบสมาชิกแต่ไม่ใช่สมาชิก — เคสหลักของฟีเจอร์นี้
  if (openNow.length > 0) {
    const current = openNow[0];
    return {
      allowed: false,
      reason: "MEMBER_ONLY",
      message: nextOpenAt
        ? `ตอนนี้เป็น "${current.name}" สำหรับสมาชิกเท่านั้น — รอบถัดไปเปิด ${formatTime(nextOpenAt)}`
        : `ตอนนี้เป็น "${current.name}" สำหรับสมาชิกเท่านั้น`,
      nextOpenAt,
      currentRound: current,
    };
  }

  // ยังไม่ถึงรอบที่เข้าได้ (รวมกรณีอยู่ในช่องว่างระหว่างรอบ)
  if (nextOpenAt) {
    return {
      allowed: false,
      reason: "NOT_STARTED",
      message: `ยังไม่เปิดขายสำหรับคุณ — เปิด ${formatTime(nextOpenAt)}`,
      nextOpenAt,
      currentRound: null,
    };
  }

  return {
    allowed: false,
    reason: "ENDED",
    message: "ปิดรอบขายแล้ว",
    nextOpenAt: null,
    currentRound: null,
  };
}

/** ตรวจว่าช่วงเวลาของรอบที่แอดมินกรอกสมเหตุสมผลไหม — คืนข้อความผิดพลาด หรือ null ถ้าผ่าน */
export function validateRoundWindow(startAt: Date, endAt: Date): string | null {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return "รูปแบบวันเวลาไม่ถูกต้อง";
  }
  if (endAt.getTime() <= startAt.getTime()) return "เวลาปิดรอบต้องอยู่หลังเวลาเปิดรอบ";
  return null;
}
