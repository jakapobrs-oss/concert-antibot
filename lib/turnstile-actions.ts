// ============================================================
// ชื่อ "action" ของ Turnstile widget — ผูก token กับ "จุดที่ขอ" (SECURITY_TODO #2)
// ============================================================
// widget ตั้ง action ตอน render → Cloudflare ฝังไว้ใน token → siteverify คืนกลับมาให้ server เทียบ
// ผล: token ที่มนุษย์แก้ให้ที่ด่านคิว เอาไปยิงด่านซื้อไม่ได้ (และกลับกัน)
//
// ไฟล์นี้ต้อง pure (ไม่อ่าน env/ไม่ import อะไร) เพราะถูกใช้ทั้งฝั่ง client (widget) และ server (verify)
// กติกาของ Cloudflare: ใช้ได้เฉพาะ a-z A-Z 0-9 _ - และยาวไม่เกิน 32 ตัว
export const TURNSTILE_ACTIONS = {
  QUEUE_JOIN: "queue_join", // ด่านเข้าคิว — app/api/queue/join (lib/antibot.ts assessRequest)
  PURCHASE: "purchase", // ด่านกดซื้อ — app/actions/booking.ts (lib/antibot-purchase.ts assessPurchase)
} as const;

export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
