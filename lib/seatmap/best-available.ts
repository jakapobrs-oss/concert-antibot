import { compareSeatOrder } from "@/lib/seatmap/seat-rows";

export interface BestAvailableSeat {
  id: string;
  rowLabel: string;
  seatNumber: number;
}

/**
 * เลือกที่นั่งที่ดีที่สุดแบบคงที่: ให้ที่นั่งติดกันในแถวหน้าก่อน แล้วค่อยกระจายข้ามแถว
 * รับเฉพาะผู้สมัครที่ DB ระบุว่าว่าง และไม่แก้ลำดับของ array ที่ caller ส่งเข้ามา
 */
export function pickBestSeats(
  seats: BestAvailableSeat[],
  quantity: number,
): string[] {
  if (!Number.isInteger(quantity) || quantity <= 0 || seats.length < quantity)
    return [];

  const ordered = [...seats].sort(compareSeatOrder);
  const rows = new Map<string, BestAvailableSeat[]>();
  for (const seat of ordered) {
    const row = rows.get(seat.rowLabel);
    if (row) row.push(seat);
    else rows.set(seat.rowLabel, [seat]);
  }

  // มองหา run แรกของแถวหน้าสุดที่มีที่นั่งติดกันพอ โดยเลขต้องต่อเนื่องจริง
  for (const row of rows.values()) {
    let runStart = 0;
    for (let index = 1; index <= row.length; index++) {
      const continues =
        index < row.length &&
        row[index].seatNumber === row[index - 1].seatNumber + 1;
      if (continues) continue;

      if (index - runStart >= quantity) {
        return row.slice(runStart, runStart + quantity).map((seat) => seat.id);
      }
      runStart = index;
    }
  }

  // ไม่มี run ที่ยาวพอเลย: เก็บจากแถวหน้าและเลขน้อยไปก่อน ข้ามแถวได้
  return ordered.slice(0, quantity).map((seat) => seat.id);
}
