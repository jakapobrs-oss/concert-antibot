// Next.js instrumentation hook (App Router, Next 15 — ไม่ต้องเปิด flag)
//   onRequestError ถูกเรียกทุกครั้งที่ error ฝั่ง server หลุดถึง framework (page/route/server action/middleware)
//   → log เป็น JSON บรรทัดเดียวลง stderr = Vercel runtime log (ค้นด้วย "server_error" หรือ digest)
//   ไม่ลง dependency (Sentry ฯลฯ ต้องถาม user ก่อนตามกฎ CLAUDE.md) — ทางเลือกที่ได้ "ทำไม/ที่ไหน/request ไหน" โดยไม่มีของเพิ่ม
//   ไม่ log body/cookie/header อื่น — มีแค่ method, path, ชนิด route, request id ของ Vercel (x-vercel-id) และ digest ที่หน้า error โชว์ให้ผู้ใช้
//   (digest ตัวเดียวกันนี้คือสิ่งที่ user เห็นบนหน้า error → ใช้จับคู่รายงานจากผู้ใช้กับ log ได้)
import type { Instrumentation } from "next";

// register ถูกเรียกครั้งเดียวตอน server instance เริ่ม (ต่อ cold start บน Vercel)
//   → เช็คสถานะผู้ให้บริการตรวจสลิปที่เปิดใช้ (EasySlip หมดอายุ/โควต้า · SlipOK โควต้า) แบบไม่บล็อกการ boot — บทเรียน 2026-08-27: แอปหมดอายุเงียบ ๆ 2 เดือน
//   จนโอนจริงครั้งแรกถึงรู้ · ทำเฉพาะ Node runtime บน production (edge ไม่มี env/fetch ชุดนี้)
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { warnSlipProviderHealth } = await import("@/lib/slip-verify");
  void warnSlipProviderHealth().catch(() => {
    /* best-effort — ห้ามทำให้ boot ล้ม */
  });
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const err = error as { name?: string; message?: string; digest?: string };
  const requestId = request.headers["x-vercel-id"];
  console.error(
    JSON.stringify({
      level: "error",
      kind: "server_error",
      at: new Date().toISOString(),
      digest: err.digest ?? null,
      name: err.name ?? null,
      message: (err.message ?? "").slice(0, 500),
      method: request.method,
      path: request.path,
      requestId: Array.isArray(requestId) ? requestId[0] : (requestId ?? null),
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource ?? null,
    })
  );
};
