// NextAuth v5 route handler — App Router style
// export GET/POST จาก handlers ที่ NextAuth() ส่งกลับมา
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
