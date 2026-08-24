// GET /api/admin/seatmap/template — ดาวน์โหลดไฟล์ Excel ตัวอย่างสำหรับกรอกข้อมูลโซน
//
// ทำเป็น route แยกแทนที่จะสร้างไฟล์ฝั่งเบราว์เซอร์ เพราะตัวสร้างไฟล์ (exceljs) หนัก
// ไม่ควรลากเข้า bundle ของหน้าแอดมินเพื่อใช้ปีละครั้ง — และ route เดียวยังคุมสิทธิ์ได้ที่เดียว
import { NextResponse } from "next/server";

import { isVerifiedAdmin } from "@/lib/admin-guard";
import { buildZoneTemplate } from "@/lib/seatmap/zone-sheet-xlsx";

export async function GET() {
  // เช็ค role กับ DB จริง ไม่เชื่อ JWT ค้าง (แพทเทิร์นเดียวกับ /api/admin/chat)
  if (!(await isVerifiedAdmin())) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const file = await buildZoneTemplate();
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="zones-template.xlsx"',
      // ไฟล์สร้างสดทุกครั้ง ไม่ต้องให้เบราว์เซอร์/CDN เก็บไว้
      "Cache-Control": "no-store",
    },
  });
}
