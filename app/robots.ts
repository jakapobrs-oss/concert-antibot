// robots.txt — ให้ search engine เก็บเฉพาะหน้าสาธารณะ; หน้าคิว/เลือกที่นั่ง/ชำระเงิน/บัญชี/แอดมิน เป็นหน้าเฉพาะคนและไม่ควรถูก index
import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/api/",
          "/account",
          "/checkout",
          "/verify",
          "/prototype",
          "/concerts/*/queue",
          "/concerts/*/seats",
        ],
      },
    ],
    sitemap: `${env.NEXTAUTH_URL}/sitemap.xml`,
  };
}
