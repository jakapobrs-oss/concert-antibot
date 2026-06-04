// ปุ่มหลักของระบบ — มีครบทุก state (default/hover/active/focus/disabled/loading)
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
const variantClass: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 active:scale-[0.98]",
  secondary:
    "bg-ink-900 text-white shadow-sm hover:bg-ink-800 active:bg-ink-950 active:scale-[0.98]",
  outline:
    "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 hover:border-neutral-400 active:bg-neutral-100",
  ghost: "bg-transparent text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200",
  subtle:
    "bg-brand-50 text-brand-700 hover:bg-brand-100 active:bg-brand-200",
  danger:
    "bg-danger text-white shadow-sm hover:brightness-95 active:brightness-90 active:scale-[0.98]",
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
      className={`relative inline-flex select-none items-center justify-center font-medium
        transition-[background-color,transform,box-shadow,border-color,filter] duration-150
        disabled:opacity-55 disabled:pointer-events-none
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
