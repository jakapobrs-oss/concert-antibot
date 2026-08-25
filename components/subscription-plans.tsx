"use client";

// เลือกแพ็กเกจสมาชิก + ยกเลิกการต่ออายุ (Phase 2.2, docs/22)
// แพ็กเกจ = ระดับ (มาตรฐาน/พรีเมียม) × ระยะเวลา (1/3/12 เดือน)
// 💰 ช่วงนี้ยังไม่เก็บเงินจริง — การ์ดจึงเขียนชัดว่า "ทดลองใช้ฟรี" ไม่ใช่ปล่อยให้เข้าใจว่าจ่ายแล้ว
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Star, Check, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { subscribeToPlanAction, cancelSubscriptionAction } from "@/app/actions/membership";

export type PlanCardView = {
  code: string;
  name: string;
  tier: "STANDARD" | "PREMIUM";
  months: number;
  priceTHB: number;
  note: string;
  available: boolean;
  blockedReason: string | null;
  current: boolean;
};

export function SubscriptionPlans({
  plans,
  hasActiveSubscription,
}: {
  plans: PlanCardView[];
  hasActiveSubscription: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSubscribe(planCode: string) {
    setBusy(planCode);
    setMsg(null);
    const res = await subscribeToPlanAction({ planCode });
    if (res.ok) {
      setMsg({
        ok: true,
        text: `สมัคร${res.planName}แล้ว — ใช้ได้ถึง ${new Date(res.expiresAt).toLocaleDateString("th-TH", { dateStyle: "long" })}`,
      });
      router.refresh();
    } else {
      setMsg({ ok: false, text: res.error });
    }
    setBusy(null);
  }

  async function handleCancel() {
    setBusy("cancel");
    setMsg(null);
    const res = await cancelSubscriptionAction();
    if (res.ok) {
      setMsg({
        ok: true,
        text: res.usableUntil
          ? `ยกเลิกการต่ออายุแล้ว — สิทธิ์ยังใช้ได้ถึง ${new Date(res.usableUntil).toLocaleDateString("th-TH", { dateStyle: "long" })}`
          : "ยกเลิกการต่ออายุแล้ว",
      });
      router.refresh();
    } else {
      setMsg({ ok: false, text: res.error });
    }
    setBusy(null);
  }

  const standard = plans.filter((p) => p.tier === "STANDARD");
  const premium = plans.filter((p) => p.tier === "PREMIUM");

  return (
    <div className="space-y-6">
      <PlanGroup
        title="มาตรฐาน"
        subtitle="เข้ารอบสมาชิกของคอนเสิร์ตที่เปิดรอบไว้"
        icon={<Sparkles className="size-4 text-brand-300" />}
        plans={standard}
        busy={busy}
        onSubscribe={handleSubscribe}
      />
      <PlanGroup
        title="พรีเมียม"
        subtitle="เข้ารอบแฟนคลับซึ่งเป็นรอบแรกสุด (ก่อนรอบสมาชิกและรอบทั่วไป)"
        icon={<Star className="size-4 text-spot-300" />}
        plans={premium}
        busy={busy}
        onSubscribe={handleSubscribe}
      />

      {msg && (
        <p role="status" className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>
          {msg.text}
        </p>
      )}

      {hasActiveSubscription && (
        <div className="border-t border-fg/10 pt-4">
          <button
            type="button"
            disabled={busy !== null}
            onClick={handleCancel}
            className="inline-flex items-center gap-1.5 text-sm text-fg-faint hover:text-danger disabled:opacity-50"
          >
            <XCircle className="size-4" />
            ยกเลิกการต่ออายุ
          </button>
          <p className="mt-1 text-xs text-fg-faint">
            ยกเลิกแล้วสิทธิ์ยังใช้ได้จนจบรอบที่สมัครไว้ — ระบบไม่ตัดสิทธิ์กลางคัน
          </p>
        </div>
      )}
    </div>
  );
}

function PlanGroup({
  title,
  subtitle,
  icon,
  plans,
  busy,
  onSubscribe,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  plans: PlanCardView[];
  busy: string | null;
  onSubscribe: (code: string) => void;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-1.5 font-display font-semibold text-fg">
        {icon}
        {title}
      </h3>
      <p className="mb-3 text-xs text-fg-faint">{subtitle}</p>

      <div className="grid gap-3 sm:grid-cols-3">
        {plans.map((p) => (
          <div
            key={p.code}
            className={`rounded-xl border p-4 ${
              p.available ? "border-fg/10 bg-ink-850" : "border-fg/5 bg-ink-900/60 opacity-70"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-display font-medium text-fg">{p.months} เดือน</span>
              {p.current && <Badge tone="success">แพ็กเกจปัจจุบัน</Badge>}
            </div>

            <p className="text-led mt-1 text-2xl font-bold text-spot-300">
              {p.priceTHB === 0 ? "ฟรี" : `฿${p.priceTHB.toLocaleString()}`}
            </p>
            {p.priceTHB === 0 && (
              <p className="text-xs text-fg-faint">ช่วงทดลอง — ยังไม่เปิดเก็บค่าสมาชิก</p>
            )}

            <div className="mt-3">
              {p.available ? (
                <Button
                  size="sm"
                  variant={p.tier === "PREMIUM" ? "primary" : "subtle"}
                  className="w-full"
                  loading={busy === p.code}
                  onClick={() => onSubscribe(p.code)}
                  leftIcon={<Check className="size-4" />}
                >
                  สมัครแพ็กเกจนี้
                </Button>
              ) : (
                <p className="text-xs leading-relaxed text-fg-faint">{p.blockedReason}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
