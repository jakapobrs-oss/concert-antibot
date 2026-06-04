import { forwardRef, type InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  // มี error → ขอบแดง + focus ring แดง สื่อสถานะผิดพลาด
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ className = "", error = false, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={error || undefined}
      className={`w-full h-11 px-3.5 rounded-lg border bg-white text-sm text-neutral-900
        placeholder:text-neutral-400 outline-none transition-colors duration-150
        disabled:bg-neutral-50 disabled:text-neutral-500
        ${
          error
            ? "border-danger focus:border-danger focus:ring-2 focus:ring-danger/25"
            : "border-neutral-300 hover:border-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
        } ${className}`}
      {...props}
    />
  )
);
Input.displayName = "Input";
