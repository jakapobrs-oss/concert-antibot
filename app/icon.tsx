// favicon — วาดจากโค้ดตอน build (ไม่ต้องมีไฟล์ .ico/.png ใน repo): ป้ายตั๋วแดงบนพื้นเวที เหมือนโลโก้ในหัวเว็บ
// Next ใส่ <link rel="icon"> ให้อัตโนมัติจากไฟล์นี้
import { ImageResponse } from "next/og";
import { BrandMark } from "./brand-mark";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<BrandMark size={64} radius={14} />, size);
}
