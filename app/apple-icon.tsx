// ไอคอนตอน "เพิ่มไปยังหน้าจอโฮม" บน iOS — iOS ตัดมุมให้เอง จึงวาดเต็มสี่เหลี่ยม
import { ImageResponse } from "next/og";
import { BrandMark } from "./brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<BrandMark size={180} radius={0} />, size);
}
