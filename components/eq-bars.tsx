// แท่ง equalizer เด้งตามจังหวะ — สัญลักษณ์ "กำลังขาย / กำลังเล่น" ของทั้งเว็บ
// ใช้ currentColor → คุมสีจาก parent ได้เลย (เช่น text-brand-400)
// ความสูงฐานต่างกันทุกแท่ง → ตอน prefers-reduced-motion animation หยุด ก็ยังอ่านเป็น eq
const BARS = [
  { height: "55%", delay: "-0.9s" },
  { height: "100%", delay: "-0.55s" },
  { height: "40%", delay: "-0.25s" },
  { height: "78%", delay: "0s" },
];

export function EqBars({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex h-3 items-end gap-[2.5px] ${className}`} aria-hidden>
      {BARS.map((b, i) => (
        <span
          key={i}
          className="animate-eq w-[2.5px] rounded-full bg-current"
          style={{ height: b.height, animationDelay: b.delay }}
        />
      ))}
    </span>
  );
}
