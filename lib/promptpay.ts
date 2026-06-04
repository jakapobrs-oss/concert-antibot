// PromptPay QR generator
// สร้าง EMVCo payload (มาตรฐาน QR พร้อมเพย์) + render เป็น data URL
// ฟรี 100% — เงินโอนเข้าบัญชี PROMPTPAY_ID ของ user โดยตรง
import generatePayload from "promptpay-qr";
import QRCode from "qrcode";

// สร้าง PromptPay QR เป็น data URL (PNG base64) — ฝังใน <img> ได้เลย
export async function generatePromptPayQR(amount: number): Promise<{
  dataUrl: string;
  promptPayId: string;
}> {
  const promptPayId = process.env.PROMPTPAY_ID || "0000000000"; // dev placeholder

  // payload ตามมาตรฐาน EMVCo — ผูกยอดเงินเข้าไป (ลูกค้าสแกนแล้วยอดขึ้นอัตโนมัติ)
  const payload = generatePayload(promptPayId, { amount });

  // render เป็น PNG data URL
  const dataUrl = await QRCode.toDataURL(payload, {
    width: 300,
    margin: 2,
    errorCorrectionLevel: "M",
  });

  return { dataUrl, promptPayId };
}

export const isPromptPayConfigured = !!process.env.PROMPTPAY_ID;
