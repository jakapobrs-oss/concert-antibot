// ============================================================
// โค้ดสิทธิ์รอบพาร์ทเนอร์ (Access code) — Phase 2.1, docs/21
// ============================================================
// มาจากของจริง: พรีเซล Mastercard/UOB (ผู้ถือบัตรร่วมรายการ), รหัสจากใบเสร็จ 7-11, โค้ดสปอนเซอร์
//   - โค้ดรวม (maxUses = null): ใครมีโค้ดก็เข้าได้ เช่น "MASTERCARD2026"
//   - โค้ดโควต้า (maxUses = n): ใช้ได้ n คนเท่านั้น (แจกตามใบเสร็จ/แคมเปญ)
// 1 คนใช้โค้ดเดิมซ้ำไม่ได้ (unique accessCodeId+userId) → กดซ้ำไม่กินโควต้าคนอื่น
import { prisma } from "@/lib/prisma";

// normalize ก่อนเทียบเสมอ — ผู้ใช้พิมพ์เว้นวรรค/ตัวเล็กใหญ่ปนกันเป็นเรื่องปกติ
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export type RedeemResult =
  | { ok: true; saleRoundId: string; roundName: string; already: boolean }
  | { ok: false; error: string };

// ใช้โค้ดปลดล็อกรอบ — ผูกกับคอนเสิร์ตที่กำลังดูอยู่ กันเอาโค้ดของงานอื่นมาใช้ข้ามงาน
export async function redeemAccessCode(params: {
  userId: string | bigint;
  concertId: string | bigint;
  code: string;
  now?: Date;
}): Promise<RedeemResult> {
  const now = params.now ?? new Date();
  const userId = typeof params.userId === "bigint" ? params.userId : BigInt(params.userId);
  const concertId =
    typeof params.concertId === "bigint" ? params.concertId : BigInt(params.concertId);

  const code = normalizeCode(params.code);
  if (code.length < 4) return { ok: false, error: "โค้ดไม่ถูกต้อง" };

  const row = await prisma.accessCode.findUnique({
    where: { code },
    select: {
      id: true,
      maxUses: true,
      usedCount: true,
      expiresAt: true,
      saleRound: { select: { id: true, name: true, concertId: true } },
    },
  });
  // ข้อความเดียวกันทั้ง "ไม่มีโค้ดนี้" และ "โค้ดของงานอื่น" — ไม่บอกใบ้ให้เดาโค้ดของงานอื่น
  if (!row || row.saleRound.concertId !== concertId) {
    return { ok: false, error: "โค้ดนี้ใช้กับคอนเสิร์ตนี้ไม่ได้" };
  }
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: "โค้ดนี้หมดอายุแล้ว" };
  }

  const saleRoundId = row.saleRound.id.toString();

  // เคยใช้แล้ว → บอกว่าปลดล็อกอยู่แล้ว ไม่นับโควต้าเพิ่ม
  const existing = await prisma.accessCodeRedemption.findUnique({
    where: { accessCodeId_userId: { accessCodeId: row.id, userId } },
    select: { id: true },
  });
  if (existing) {
    return { ok: true, saleRoundId, roundName: row.saleRound.name, already: true };
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (row.maxUses !== null) {
        // compare-and-set: เพิ่มยอดใช้เฉพาะตอนยังไม่เต็มโควต้า (แพทเทิร์นเดียวกับ order-finalize)
        //   กัน race ตอนคนสุดท้ายกดพร้อมกันหลายคน — ไม่ใช้ read-then-write ที่นับเกินได้
        const bumped = await tx.accessCode.updateMany({
          where: { id: row.id, usedCount: { lt: row.maxUses } },
          data: { usedCount: { increment: 1 } },
        });
        if (bumped.count === 0) throw new Error("CODE_EXHAUSTED");
      } else {
        await tx.accessCode.update({
          where: { id: row.id },
          data: { usedCount: { increment: 1 } },
        });
      }
      await tx.accessCodeRedemption.create({ data: { accessCodeId: row.id, userId } });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "CODE_EXHAUSTED") {
      return { ok: false, error: "โค้ดนี้ถูกใช้ครบจำนวนแล้ว" };
    }
    // ชน unique จากการกดรัวสองแท็บ → ถือว่าปลดล็อกสำเร็จแล้ว
    const again = await prisma.accessCodeRedemption.findUnique({
      where: { accessCodeId_userId: { accessCodeId: row.id, userId } },
      select: { id: true },
    });
    if (again) return { ok: true, saleRoundId, roundName: row.saleRound.name, already: true };
    return { ok: false, error: "ใช้โค้ดไม่สำเร็จ กรุณาลองใหม่" };
  }

  return { ok: true, saleRoundId, roundName: row.saleRound.name, already: false };
}

// จำนวนที่เหลือของโค้ด (null = ไม่จำกัด) — โชว์ในหน้าแอดมิน
export function remainingUses(code: { maxUses: number | null; usedCount: number }): number | null {
  if (code.maxUses === null) return null;
  return Math.max(0, code.maxUses - code.usedCount);
}
