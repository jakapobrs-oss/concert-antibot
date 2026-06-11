// THB formatter — ใช้ทุกที่ที่แสดงเงิน
export function formatTHB(amount: number | string | { toString(): string }): string {
  const n = typeof amount === "number" ? amount : Number(amount.toString());
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

// แสดงวันที่แบบไทย
export function formatThaiDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(d);
}

// แยกวันที่เป็นชิ้น (วัน/เดือนย่อ) — ใช้กับป้ายวันที่บนการ์ดคอนเสิร์ต
export function formatThaiDateParts(date: Date | string): { day: string; month: string } {
  const d = typeof date === "string" ? new Date(date) : date;
  return {
    day: new Intl.DateTimeFormat("th-TH", { day: "numeric", timeZone: "Asia/Bangkok" }).format(d),
    month: new Intl.DateTimeFormat("th-TH", { month: "short", timeZone: "Asia/Bangkok" }).format(d),
  };
}
