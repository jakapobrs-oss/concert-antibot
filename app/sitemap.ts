// sitemap.xml — หน้าแรก / รายการ / รายละเอียดคอนเสิร์ตที่เปิดเผยอยู่ / เอกสารผู้ใช้
// Google ไม่สนใจ changefreq/priority แล้ว จึงใส่แค่ url + lastModified
import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

export const revalidate = 3600; // คอนเสิร์ตเพิ่ม/ลบไม่บ่อย — สร้างใหม่ทุกชั่วโมงพอ

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.NEXTAUTH_URL.replace(/\/$/, "");
  const now = new Date();

  const concerts = await prisma.concert.findMany({
    where: { status: { in: ["ON_SALE", "SCHEDULED", "SOLD_OUT"] } },
    select: { slug: true, updatedAt: true },
  });

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now },
    { url: `${base}/concerts`, lastModified: now },
    { url: `${base}/terms`, lastModified: now },
    { url: `${base}/privacy`, lastModified: now },
    { url: `${base}/ticket-terms`, lastModified: now },
  ];

  return [
    ...staticPages,
    ...concerts.map((c) => ({ url: `${base}/concerts/${c.slug}`, lastModified: c.updatedAt })),
  ];
}
