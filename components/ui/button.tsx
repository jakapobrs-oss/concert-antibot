// ปุ่มหลักของระบบ (โทนเวทีมืด) — มีครบทุก state (default/hover/active/focus/disabled/loading)
// variants: primary, secondary, ghost, outline, danger, subtle
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "subtle";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

// แต่ละ variant คุม state hover/active เองให้รู้สึก "กดได้จริง"
// primary มีเงาเรืองแดงจางๆ เหมือนปุ่มรับแสงไฟเวที
const variantClass: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-glow-brand hover:bg-brand-500 active:bg-brand-700 active:scale-[0.98]",
  secondary:
    "bg-fg text-ink-950 hover:bg-fg-dim active:bg-fg-dim active:scale-[0.98]",
  outline:
    "border border-fg/20 bg-transparent text-fg hover:border-fg/40 hover:bg-fg/5 active:bg-fg/10",
  ghost: "bg-transparent text-fg-dim hover:bg-fg/10 hover:text-fg active:bg-fg/15",
  subtle:
    "bg-brand-500/15 text-brand-300 hover:bg-brand-500/25 active:bg-brand-500/30",
  danger:
    "bg-danger text-ink-950 font-semibold hover:brightness-110 active:brightness-95 active:scale-[0.98]",
};

const sizeClass: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm gap-1.5 rounded-md",
  md: "h-11 px-5 text-sm gap-2 rounded-lg",
  lg: "h-13 px-7 text-base gap-2.5 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  (
    {
      className = "",
      variant = "primary",
      size = "md",
      loading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      ...props
    },
    ref
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`relative inline-flex select-none items-center justify-center whitespace-nowrap font-display font-medium
        transition-[background-color,transform,box-shadow,border-color,filter] duration-150
        disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none
        ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {!loading && leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  )
);
Button.displayName = "Button";
