// ============================================================
// Order view — สถานะคำสั่งซื้อสำหรับ "หน้าประวัติการสั่งซื้อ" (Phase 2.4, docs/24)
// ============================================================
// ปัญหาที่แก้: order ที่ยังไม่จ่าย (PENDING, อายุ 5 นาที) ไม่มีทางกลับเข้าไปจ่ายต่อเลย
//   ถ้าผู้ใช้เผลอปิดแท็บ checkout → ที่นั่งค้าง HELD จนหมดอายุ ผู้ใช้ไม่รู้ว่าเกิดอะไรขึ้น
//   เว็บกดบัตรจริงทุกเจ้ามีหน้า "คำสั่งซื้อของฉัน" ที่กลับไปจ่ายต่อได้ก่อนหมดเวลา
//
// สถานะที่ผู้ใช้ต้องแยกออกจากกันให้ได้ (คำนวณสดจากเวลา ไม่ต้องรอ sweeper มาปิด order):
//   AWAITING_PAYMENT = ยังจ่ายได้ (มีเวลาเหลือ)      → ปุ่ม "จ่ายเงินต่อ"
//   EXPIRED          = หมดเวลาแล้ว ที่นั่งถูกคืนแล้ว → บอกให้จองใหม่
//   PAID / CANCELLED / REFUND_REQUIRED / REFUNDED    → ดูอย่างเดียว

export type OrderDisplayStatus =
  | "AWAITING_PAYMENT"
  | "EXPIRED"
  | "PAID"
  | "CANCELLED"
  | "REFUND_REQUIRED"
  | "REFUNDED";

export type OrderLike = {
  status: "PENDING" | "PAID" | "CANCELLED" | "REFUNDED";
  expiresAt: Date;
  // สถานะการจ่ายเงิน (ถ้ามี) — ใช้แยกเคส "เงินเข้าแล้วแต่ออกตั๋วไม่ได้" ที่ต้องรอทีมงานคืนเงิน
  paymentStatus?: "PENDING" | "VERIFYING" | "SUCCESS" | "FAILED" | "REFUND_REQUIRED" | "REFUNDED" | null;
};

export function orderDisplayStatus(order: OrderLike, now: Date = new Date()): OrderDisplayStatus {
  // เงินเข้าแล้วแต่ระบบออกตั๋วไม่ได้ — ต้องเด้งขึ้นก่อนสถานะ order เพราะผู้ใช้ต้องรู้ว่ากำลังรอคืนเงิน
  if (order.paymentStatus === "REFUND_REQUIRED") return "REFUND_REQUIRED";
  if (order.paymentStatus === "REFUNDED") return "REFUNDED";

  switch (order.status) {
    case "PAID":
      return "PAID";
    case "REFUNDED":
      return "REFUNDED";
    case "CANCELLED":
      return "CANCELLED";
    case "PENDING":
      // หมดเวลาแล้วแต่ sweeper ยังไม่มาเก็บ → ผู้ใช้ต้องเห็นว่า "หมดเวลา" ไม่ใช่ "รอจ่าย"
      return order.expiresAt.getTime() > now.getTime() ? "AWAITING_PAYMENT" : "EXPIRED";
  }
}

// กลับไปจ่ายต่อได้ไหม — เงื่อนไขเดียวกับที่หน้า checkout ใช้ (กันปุ่มพาไปหน้าที่เด้งกลับ)
export function canResumePayment(order: OrderLike, now: Date = new Date()): boolean {
  return orderDisplayStatus(order, now) === "AWAITING_PAYMENT";
}

// เหลือเวลาจ่ายอีกกี่มิลลิวินาที (0 = หมดแล้ว) — ใช้ป้อนตัวนับถอยหลังบนหน้าจอ
export function msLeftToPay(order: OrderLike, now: Date = new Date()): number {
  const ms = order.expiresAt.getTime() - now.getTime();
  return ms > 0 ? ms : 0;
}

export const ORDER_STATUS_LABEL: Record<
  OrderDisplayStatus,
  { text: string; tone: "warning" | "success" | "neutral" | "danger" }
> = {
  AWAITING_PAYMENT: { text: "รอชำระเงิน", tone: "warning" },
  EXPIRED: { text: "หมดเวลาชำระ", tone: "neutral" },
  PAID: { text: "ชำระแล้ว", tone: "success" },
  CANCELLED: { text: "ยกเลิกแล้ว", tone: "neutral" },
  REFUND_REQUIRED: { text: "รอทีมงานคืนเงิน", tone: "danger" },
  REFUNDED: { text: "คืนเงินแล้ว", tone: "neutral" },
};
