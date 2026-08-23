// ============================================================
// Concert filter — ค้นหา/กรองรายการงาน (Phase 2.4, docs/24)
// ============================================================
// เว็บกดบัตรจริงมีงานพร้อมกันหลายสิบงาน — รายการยาวเป็นพรืดใช้ไม่ได้
// กรองฝั่ง client เพราะรายการงานที่เปิดขายมีไม่มาก (หลักสิบ) และหน้ารายการเป็นหน้าแคช
//   → พิมพ์แล้วผลขึ้นทันทีโดยไม่ยิงเซิร์ฟเวอร์เพิ่มสักครั้ง (สำคัญตอนคนแห่เข้าเว็บวันเปิดขาย)

export type ConcertFilterStatus = "ALL" | "ON_SALE" | "SCHEDULED" | "SOLD_OUT";

export type FilterableConcert = {
  title: string;
  venue: string;
  status: string;
};

// normalize ก่อนเทียบ — ผู้ใช้พิมพ์เว้นวรรค/ตัวพิมพ์ใหญ่เล็กไม่ตรงเป็นเรื่องปกติ
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchesQuery(concert: FilterableConcert, query: string): boolean {
  const q = normalize(query);
  if (q.length === 0) return true;
  // ค้นได้ทั้งชื่องานและสถานที่ — คนจำ "อิมแพ็ค" ได้แต่จำชื่อทัวร์เต็มไม่ได้ เป็นเรื่องปกติ
  return normalize(concert.title).includes(q) || normalize(concert.venue).includes(q);
}

export function matchesStatus(concert: FilterableConcert, status: ConcertFilterStatus): boolean {
  return status === "ALL" || concert.status === status;
}

export function filterConcerts<T extends FilterableConcert>(
  concerts: T[],
  params: { query?: string; status?: ConcertFilterStatus }
): T[] {
  const query = params.query ?? "";
  const status = params.status ?? "ALL";
  return concerts.filter((c) => matchesQuery(c, query) && matchesStatus(c, status));
}

// นับจำนวนต่อสถานะไว้โชว์บนแท็บ — ผู้ใช้เห็นตั้งแต่ยังไม่กดว่ามีงานในหมวดนั้นกี่งาน
export function countByStatus(concerts: FilterableConcert[]): Record<ConcertFilterStatus, number> {
  return {
    ALL: concerts.length,
    ON_SALE: concerts.filter((c) => c.status === "ON_SALE").length,
    SCHEDULED: concerts.filter((c) => c.status === "SCHEDULED").length,
    SOLD_OUT: concerts.filter((c) => c.status === "SOLD_OUT").length,
  };
}
