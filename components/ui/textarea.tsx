import { forwardRef, type TextareaHTMLAttributes } from "react";

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

// textarea โทนเดียวกับ Input — ใช้ในฟอร์ม admin (รายละเอียดคอนเสิร์ต)
export const Textarea = forwardRef<HTMLTextAreaElement, Props>(
  ({ className = "", error = false, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={error || undefined}
      className={`w-full rounded-lg border bg-ink-950/60 px-3.5 py-2.5 text-sm text-fg
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
Textarea.displayName = "Textarea";
