import type { ReactNode } from "react";

// แถบตัววิ่ง marquee — render เนื้อหาซ้ำ 2 ชุดแล้วเลื่อน -50% วนลูปพอดี
// ชุดที่สองเป็นของตกแต่ง (aria-hidden) screen reader อ่านรอบเดียว
export function Marquee({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <div className="animate-marquee flex w-max">
        <div className="flex shrink-0 items-center">{children}</div>
        <div className="flex shrink-0 items-center" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}
