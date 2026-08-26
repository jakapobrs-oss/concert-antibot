// เทมเพลตอีเมล (pure — ไม่แตะ env/เครือข่าย) ให้ lib/email.ts เรียกส่ง และ unit test เช็คเนื้อหาได้
// ทุกค่าที่มาจากผู้ใช้/ฐานข้อมูล (ชื่องาน ชื่อผู้ถือ สถานที่) ต้อง escape ก่อนใส่ HTML — กัน HTML injection ในอีเมล

export type EmailContent = { subject: string; html: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// โครงอีเมลร่วม — inline style ล้วน (client อีเมลส่วนใหญ่ไม่โหลด CSS ภายนอก)
function shell(inner: string): string {
  return `
    <div style="font-family:-apple-system,Segoe UI,'Noto Sans Thai',sans-serif;max-width:520px;margin:0 auto;color:#111;">
      ${inner}
    </div>
  `.trim();
}

function button(href: string, label: string): string {
  return `
      <p style="margin:24px 0;">
        <a href="${escapeHtml(href)}"
           style="background:#111;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block;">
          ${escapeHtml(label)}
        </a>
      </p>`;
}

// ---------- ลืมรหัสผ่าน ----------
export function buildPasswordResetEmail(input: {
  appName: string;
  resetUrl: string;
  ttlMinutes: number;
}): EmailContent {
  const app = escapeHtml(input.appName);
  const subject = `ตั้งรหัสผ่านใหม่สำหรับ ${input.appName}`;
  const html = shell(`
      <h2 style="margin:0 0 12px;">ตั้งรหัสผ่านใหม่</h2>
      <p style="margin:0 0 16px;line-height:1.6;">
        มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี <strong>${app}</strong> ของคุณ
        กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์หมดอายุใน ${input.ttlMinutes} นาที และใช้ได้ครั้งเดียว)
      </p>
      ${button(input.resetUrl, "ตั้งรหัสผ่านใหม่")}
      <p style="color:#666;font-size:13px;line-height:1.6;">
        ถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร — รหัสผ่านเดิมยังใช้ได้ตามปกติ<br>
        ถ้าปุ่มกดไม่ได้ คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:<br>${escapeHtml(input.resetUrl)}
      </p>`);
  const text = `ตั้งรหัสผ่านใหม่สำหรับ ${input.appName}: ${input.resetUrl} (หมดอายุใน ${input.ttlMinutes} นาที ใช้ได้ครั้งเดียว) — ถ้าไม่ได้ขอ ไม่ต้องทำอะไร`;
  return { subject, html, text };
}

// ---------- ยืนยันคำสั่งซื้อ / ตั๋ว ----------
export type OrderPaidEmailInput = {
  appName: string;
  orderId: string;
  concertTitle: string;
  venue: string;
  eventAtText: string; // จัดรูปแบบไทยแล้ว (formatThaiDate)
  totalText: string; // จัดรูปแบบแล้ว (formatTHB)
  seats: { label: string; holderName: string }[];
  ticketsUrl: string;
};

// ตั้งใจ "ไม่" ใส่ QR/รหัสบัตรในอีเมล — QR เป็นแบบเปลี่ยนรอบและผูกกับบัญชีผู้ถือ (Ticket.qrSecret ห้ามออกจากระบบ)
//   อีเมลเป็นแค่ใบเสร็จ + ทางไปหน้าตั๋วของฉัน (อีเมลส่งต่อกันได้ ถ้ามี QR อยู่ = แชร์บัตรได้)
export function buildOrderPaidEmail(input: OrderPaidEmailInput): EmailContent {
  const title = escapeHtml(input.concertTitle);
  const subject = `ชำระเงินสำเร็จ — ${input.concertTitle} (คำสั่งซื้อ #${input.orderId})`;
  const seatRows = input.seats
    .map(
      (s) => `
          <tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(s.label)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#555;">${escapeHtml(s.holderName)}</td>
          </tr>`,
    )
    .join("");
  const html = shell(`
      <h2 style="margin:0 0 12px;">ชำระเงินสำเร็จ 🎫</h2>
      <p style="margin:0 0 16px;line-height:1.6;">
        เราได้รับเงินและออกบัตรสำหรับ <strong>${title}</strong> ให้คุณแล้ว
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 8px;">
        <tr><td style="padding:4px 8px;color:#666;">คำสั่งซื้อ</td><td style="padding:4px 8px;">#${escapeHtml(input.orderId)}</td></tr>
        <tr><td style="padding:4px 8px;color:#666;">สถานที่</td><td style="padding:4px 8px;">${escapeHtml(input.venue)}</td></tr>
        <tr><td style="padding:4px 8px;color:#666;">วันเวลาแสดง</td><td style="padding:4px 8px;">${escapeHtml(input.eventAtText)}</td></tr>
        <tr><td style="padding:4px 8px;color:#666;">ยอดชำระ</td><td style="padding:4px 8px;"><strong>${escapeHtml(input.totalText)}</strong></td></tr>
      </table>
      <table style="border-collapse:collapse;width:100%;font-size:14px;margin:8px 0 0;">
        <thead><tr>
          <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd;">ที่นั่ง</th>
          <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd;">ผู้ถือบัตร</th>
        </tr></thead>
        <tbody>${seatRows}
        </tbody>
      </table>
      ${button(input.ticketsUrl, "เปิดบัตรของฉัน")}
      <p style="color:#666;font-size:13px;line-height:1.6;">
        QR สำหรับเข้างานอยู่ในหน้า "ตั๋วของฉัน" เท่านั้น (ไม่แนบมาในอีเมลเพื่อความปลอดภัย) ·
        บัตรระบุชื่อผู้ถือ โอนสิทธิ์ไม่ได้ · คืนบัตรได้จากหน้าเดียวกันตามเงื่อนไขบัตร
      </p>`);
  const text = [
    `ชำระเงินสำเร็จ — ${input.concertTitle} (คำสั่งซื้อ #${input.orderId})`,
    `สถานที่: ${input.venue}`,
    `วันเวลาแสดง: ${input.eventAtText}`,
    `ยอดชำระ: ${input.totalText}`,
    `ที่นั่ง: ${input.seats.map((s) => `${s.label} (${s.holderName})`).join(", ")}`,
    `เปิดบัตรของฉัน: ${input.ticketsUrl}`,
    `QR เข้างานอยู่ในหน้าตั๋วของฉันเท่านั้น — ${input.appName}`,
  ].join("\n");
  return { subject, html, text };
}
