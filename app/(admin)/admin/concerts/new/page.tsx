// Admin — สร้างคอนเสิร์ตใหม่ (โทนเวทีมืด)
// หมายเหตุ: สร้างเป็น DRAFT ก่อน, zone/seat เพิ่มในหน้า detail (Phase 3.5)
import { Lightbulb } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createConcert } from "@/app/actions/concert";

export default function NewConcertPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>สร้างคอนเสิร์ตใหม่</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <form action={createConcert} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">ชื่อคอนเสิร์ต</Label>
                <Input id="title" name="title" required placeholder="เช่น BTS World Tour Bangkok 2026" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">รายละเอียด</Label>
                <Textarea
                  id="description"
                  name="description"
                  required
                  rows={4}
                  placeholder="รายละเอียดคอนเสิร์ต..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="venue">สถานที่</Label>
                <Input id="venue" name="venue" required placeholder="เช่น ราชมังคลากีฬาสถาน" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="eventAt">วันแสดง</Label>
                <Input id="eventAt" name="eventAt" type="datetime-local" required />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="saleStartAt">เริ่มขาย</Label>
                  <Input id="saleStartAt" name="saleStartAt" type="datetime-local" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="saleEndAt">ปิดขาย</Label>
                  <Input id="saleEndAt" name="saleEndAt" type="datetime-local" required />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxTicketsPerUser">จำกัดตั๋วต่อบัญชี</Label>
                <Input
                  id="maxTicketsPerUser"
                  name="maxTicketsPerUser"
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={4}
                  required
                />
              </div>

              <div className="flex items-start gap-2.5 rounded-lg border border-info/25 bg-info/10 p-3 text-sm text-info">
                <Lightbulb className="mt-0.5 size-4 shrink-0" />
                <span>
                  สร้างเป็น <strong>DRAFT</strong> ก่อน — เพิ่มโซน/ที่นั่งแล้วค่อยกด &quot;เปิดขาย&quot;
                  (ระบบจัดการโซน/ที่นั่งจะเพิ่มใน Phase 3.5)
                </span>
              </div>

              <Button type="submit" className="w-full">สร้างคอนเสิร์ต</Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
