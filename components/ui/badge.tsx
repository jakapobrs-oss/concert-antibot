// ป้ายสถานะเล็กๆ (โทนเวทีมืด) — ใช้กับสถานะคอนเสิร์ต / ผลตรวจบอท ฯลฯ
// พื้นเป็นสีจาง /15 + ตัวหนังสือสีสว่าง อ่านชัดบนการ์ดมืดทุกระดับ
import type { HTMLAttributes, ReactNode } from "react";

type Tone = "neutral" | "brand" | "spot" | "success" | "warning" | "danger" | "info";

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean; // แสดงจุดสีนำหน้า (เหมาะกับสถานะ live)
  children: ReactNode;
}

const toneClass: Record<Tone, string> = {
  neutral: "bg-fg/10 text-fg-dim",
  brand: "bg-brand-500/15 text-brand-300",
  spot: "bg-spot-400/15 text-spot-300",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
  info: "bg-info/12 text-info",
};

const dotColor: Record<Tone, string> = {
  neutral: "bg-fg-faint",
  brand: "bg-brand-500",
  spot: "bg-spot-400",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({ className = "", tone = "neutral", dot = false, children, ...props }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-display text-xs font-medium ${toneClass[tone]} ${className}`}
      {...props}
    >
      {dot && (
        <span className={`size-1.5 animate-pulse rounded-full ${dotColor[tone]}`} aria-hidden />
      )}
      {children}
    </span>
  );
}
