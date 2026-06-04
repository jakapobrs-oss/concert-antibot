// ส่งอีเมล transactional ผ่าน Resend REST API
// docs: https://resend.com/docs/api-reference/emails/send-email
//
// ตั้งใจ "ไม่" ใช้ Resend SDK — เรียก REST ตรงด้วย fetch เพื่อไม่เพิ่ม dependency
// (ทั้งโปรเจกต์ส่งอีเมลแค่จุดเดียว = verification ใช้ REST พอ ไม่ต้องลาก SDK + types เข้ามา)
import { env, isEmailEnabled } from "@/lib/env";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

// ผลลัพธ์มี 3 ทาง: ส่งสำเร็จ / ไม่ได้ตั้ง key (skip เงียบ ๆ ใน dev) / ส่งแล้วพลาด
export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; skipped: true } // ไม่ได้ตั้ง RESEND_API_KEY — caller ไป log link เอง
  | { ok: false; skipped: false; error: string };

// ส่งอีเมลหนึ่งฉบับ — ไม่ throw ออกไป (คืน error เป็นค่า) เพื่อให้ caller ตัดสินใจเองว่าจะ rollback ไหม
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // ไม่มี RESEND_API_KEY → ไม่ส่งจริง (dev mode) — คืน skipped ให้ caller จัดการ (เช่น log ลิงก์)
  if (!isEmailEnabled) {
    return { ok: false, skipped: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM, // ต้องเป็นโดเมนที่ verify ใน Resend แล้ว (ดู docs/17)
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
      }),
    });

    if (!res.ok) {
      // อ่าน body เพื่อ debug สาเหตุที่พบบ่อย: domain ยังไม่ verify / from ไม่ถูก / key ผิด
      const body = await res.text().catch(() => "");
      return { ok: false, skipped: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id ?? "unknown" };
  } catch (err) {
    // network error / DNS / timeout — ไม่ปล่อยให้ throw ทะลุไป crash server action
    return { ok: false, skipped: false, error: `Resend network error: ${(err as Error).message}` };
  }
}

// เทมเพลตอีเมลยืนยันตัวตน — แยกออกมาให้ auth action เรียกได้สั้น ๆ
export async function sendVerificationEmail(
  to: string,
  verifyUrl: string
): Promise<SendEmailResult> {
  const appName = env.APP_NAME;
  const subject = `ยืนยันอีเมลสำหรับ ${appName}`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;color:#111;">
      <h2 style="margin:0 0 12px;">ยืนยันอีเมลของคุณ</h2>
      <p style="margin:0 0 16px;line-height:1.6;">
        ขอบคุณที่สมัครใช้งาน <strong>${appName}</strong> — กดปุ่มด้านล่างเพื่อยืนยันอีเมล
        (ลิงก์หมดอายุใน 24 ชั่วโมง)
      </p>
      <p style="margin:24px 0;">
        <a href="${verifyUrl}"
           style="background:#111;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block;">
          ยืนยันอีเมล
        </a>
      </p>
      <p style="color:#666;font-size:13px;line-height:1.6;">
        ถ้าปุ่มกดไม่ได้ คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:<br>${verifyUrl}
      </p>
    </div>
  `.trim();
  const text = `ยืนยันอีเมลสำหรับ ${appName}: ${verifyUrl} (หมดอายุใน 24 ชม.)`;
  return sendEmail({ to, subject, html, text });
}
