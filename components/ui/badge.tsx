// ป้ายสถานะเล็กๆ — ใช้กับสถานะคอนเสิร์ต / ผลตรวจบอท ฯลฯ
import type { HTMLAttributes, ReactNode } from "react";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean; // แสดงจุดสีนำหน้า (เหมาะกับสถานะ live)
  children: ReactNode;
}

const toneClass: Record<Tone, string> = {
  neutral: "bg-neutral-100 text-neutral-700",
  brand: "bg-brand-50 text-brand-700",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-[oklch(0.5_0.13_70)]",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
};

const dotColor: Record<Tone, string> = {
  neutral: "bg-neutral-400",
  brand: "bg-brand-500",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({ className = "", tone = "neutral", dot = false, children, ...props }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClass[tone]} ${className}`}
      {...props}
    >
      {dot && (
        <span className={`size-1.5 rounded-full ${dotColor[tone]}`} aria-hidden />
      )}
      {children}
    </span>
  );
}
