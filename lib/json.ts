// BigInt → string serializer สำหรับ JSON.stringify
// Prisma ใช้ BigInt PK แต่ JSON ไม่รองรับ → ต้อง convert ทุกครั้งก่อนส่ง client
export function serializeBigInt<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}
