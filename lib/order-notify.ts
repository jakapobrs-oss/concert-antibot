// ส่งอีเมลใบเสร็จ/ตั๋วหลังชำระเงินสำเร็จ — เรียกจาก submitSlip ผ่าน after() (หลังตอบ client แล้ว)
// กติกา: ห้ามทำให้การจ่ายเงินล้ม — ทุกอย่างในนี้ห่อ try/catch แล้ว log อย่างเดียว
//   อีเมลไปหา "ผู้ซื้อ" คนเดียว (ผู้ถือคนอื่นเห็นบัตรในบัญชีตัวเองอยู่แล้ว)
import { prisma } from "@/lib/prisma";
import { env, isEmailEnabled } from "@/lib/env";
import { sendOrderPaidEmail } from "@/lib/email";
import { formatTHB, formatThaiDate } from "@/lib/format";
import { formatSeatLabel } from "@/lib/seatmap/seat-rows";

export async function notifyOrderPaid(orderId: bigint): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        totalAmount: true,
        user: { select: { email: true } },
        concert: { select: { title: true, venue: true, eventAt: true } },
        // Ticket.holderName = snapshot ชื่อผู้ถือตอนออกตั๋ว (named ticket) — ตรงกับที่โชว์หน้าตั๋วของฉัน
        tickets: {
          select: {
            holderName: true,
            seat: { select: { rowLabel: true, seatNumber: true, zone: { select: { name: true, isStanding: true } } } },
          },
          orderBy: { id: "asc" },
        },
      },
    });
    if (!order || order.tickets.length === 0) return;

    const to = order.user.email;
    if (!to.includes("@") || to.endsWith("@local")) return; // บัญชีเดโม dev (user@local) ไม่มีกล่องจดหมาย

    const data = {
      orderId: order.id.toString(),
      concertTitle: order.concert.title,
      venue: order.concert.venue,
      eventAtText: formatThaiDate(order.concert.eventAt),
      totalText: formatTHB(order.totalAmount.toString()),
      seats: order.tickets.map((t) => ({
        label: formatSeatLabel({
          zoneName: t.seat.zone.name,
          isStanding: t.seat.zone.isStanding,
          rowLabel: t.seat.rowLabel,
          seatNumber: t.seat.seatNumber,
        }),
        holderName: t.holderName,
      })),
      ticketsUrl: `${env.NEXTAUTH_URL}/account/tickets`,
    };

    if (!isEmailEnabled) {
      // dev ไม่มี Resend — บอกใน console พอ (ไม่ต้องมีลิงก์ลับอะไร ใบเสร็จไม่มี secret)
      console.log(`📧 [DEV MODE] ใบเสร็จคำสั่งซื้อ #${data.orderId} → ${to} (${data.seats.length} ที่นั่ง) — ไม่ได้ส่งจริง`);
      return;
    }

    const result = await sendOrderPaidEmail(to, data);
    if (result.ok) {
      console.log(`📧 ส่งใบเสร็จคำสั่งซื้อ #${data.orderId} ไป ${to} แล้ว (Resend id: ${result.id})`);
    } else {
      // ส่งไม่ออก (เช่น EMAIL_FROM เป็น sender ทดสอบ @resend.dev ส่งได้แค่อีเมลเจ้าของบัญชี) — ตั๋วออกแล้ว ผู้ใช้ดูในเว็บได้
      const reason = "error" in result ? result.error : "skipped";
      console.error(`📧 ส่งใบเสร็จคำสั่งซื้อ #${data.orderId} ไป ${to} ไม่สำเร็จ: ${reason}`);
    }
  } catch (e) {
    console.error("[order-notify] ส่งอีเมลใบเสร็จล้มเหลว (ไม่กระทบการจ่ายเงิน)", e);
  }
}
