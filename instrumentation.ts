// Next.js instrumentation hook (App Router, Next 15 — ไม่ต้องเปิด flag)
//   onRequestError ถูกเรียกทุกครั้งที่ error ฝั่ง server หลุดถึง framework (page/route/server action/middleware)
//   → log เป็น JSON บรรทัดเดียวลง stderr = Vercel runtime log (ค้นด้วย "server_error" หรือ digest)
//   ไม่ลง dependency (Sentry ฯลฯ ต้องถาม user ก่อนตามกฎ CLAUDE.md) — ทางเลือกที่ได้ "ทำไม/ที่ไหน/request ไหน" โดยไม่มีของเพิ่ม
//   ไม่ log body/cookie/header อื่น — มีแค่ method, path, ชนิด route, request id ของ Vercel (x-vercel-id) และ digest ที่หน้า error โชว์ให้ผู้ใช้
//   (digest ตัวเดียวกันนี้คือสิ่งที่ user เห็นบนหน้า error → ใช้จับคู่รายงานจากผู้ใช้กับ log ได้)
import type { Instrumentation } from "next";

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
