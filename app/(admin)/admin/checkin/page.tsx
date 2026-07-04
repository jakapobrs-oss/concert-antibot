// จุดสแกนเช็คอินหน้างาน (docs/19 Phase 2) — admin เท่านั้น
// (RBAC: middleware + (admin)/layout.tsx เช็ค role ADMIN สองชั้นอยู่แล้ว
//  + ตัว action checkInTicket เช็คซ้ำอีกชั้น — หน้านี้แค่ UI)
import { SiteHeader } from "@/components/site-header";
import { CheckinClient } from "@/components/checkin-client";

export const dynamic = "force-dynamic";

export default function CheckinPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl px-4 py-8">
        <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-fg">
          เช็คอินหน้างาน
        </h1>
        <p className="mb-6 text-sm text-fg-faint">
          1 บัตรเข้าได้ครั้งเดียว — ระบบโชว์ชื่อผู้ถือให้เทียบบัตรประชาชน
        </p>
        <CheckinClient />
      </main>
    </>
  );
}
