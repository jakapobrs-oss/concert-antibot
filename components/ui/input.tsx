import { forwardRef, type InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  // มี error → ขอบแดง + focus ring แดง สื่อสถานะผิดพลาด
  error?: boolean;
}

// ช่องกรอกโทนเวทีมืด — พื้นจมลงจาก surface เล็กน้อย ขอบจาง โฟกัสแล้วติดไฟแดง
export const Input = forwardRef<HTMLInputElement, Props>(
  ({ className = "", error = false, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={error || undefined}
      className={`h-11 w-full rounded-lg border bg-ink-950/60 px-3.5 text-sm text-fg
        outline-none transition-colors duration-150 placeholder:text-fg-faint
        disabled:bg-ink-900 disabled:text-fg-faint
        ${
          error
            ? "border-danger/60 focus:border-danger focus:ring-2 focus:ring-danger/30"
            : "border-fg/15 hover:border-fg/30 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        } ${className}`}
      {...props}
    />
  )
);
Input.displayName = "Input";
