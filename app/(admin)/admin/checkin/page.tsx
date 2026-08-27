// /admin/checkin ย้ายไป /staff/checkin แล้ว (rev 42 — เจ้าหน้าที่หน้างานเป็น role STAFF แยกจากแอดมิน)
// คงเส้นทางเดิมไว้เป็น redirect กันลิงก์เก่า/บุ๊กมาร์กของแอดมินเสีย
import { redirect } from "next/navigation";

export default function LegacyAdminCheckinPage() {
  redirect("/staff/checkin");
}
