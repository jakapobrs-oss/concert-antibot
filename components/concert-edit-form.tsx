"use client";

// ฟอร์มแก้ไขคอนเสิร์ต (แอดมิน) — rev 41: error/คำเตือนโชว์บนหน้าเดิมผ่าน useActionState ไม่เด้งไปหน้า error
//   ค่าเริ่มต้นส่งมาจาก server component เป็นสตริง datetime-local ตามเวลาไทยแล้ว (lib/local-datetime toThaiDateTimeLocal)
import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ExternalLink, Trash2, TriangleAlert } from "lucide-react";
import {
  updateConcertAction,
  deleteConcertAction,
  type ConcertEditState,
  type ConcertDeleteState,
} from "@/app/actions/concert";
import { CONCERT_STATUSES, CONCERT_STATUS_LABEL, MAX_TICKETS_PER_USER_LIMIT } from "@/lib/concert-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface ConcertEditInitial {
  title: string;
  description: string;
  venue: string;
  eventAt: string; // "YYYY-MM-DDTHH:mm" เวลาไทย
  saleStartAt: string;
  saleEndAt: string;
  maxTicketsPerUser: number;
  coverImageUrl: string;
  slug: string;
  status: string;
}

interface Props {
  concertId: string;
  initial: ConcertEditInitial;
  orderCount: number; // คำสั่งซื้อทั้งหมด (ทุกสถานะ) — ตัวตัดสินว่าลบได้ไหม
  paidOrderCount: number; // จ่ายแล้ว — ตัวเตือนตอนแก้วัน/สถานที่
  deleteBlockedReason: string | null; // null = ลบได้
}

// select ให้หน้าตาเดียวกับ Input (ยังไม่มี primitive Select ใน components/ui)
const SELECT_CLASS =
  "h-11 w-full rounded-lg border border-fg/15 bg-ink-950/60 px-3.5 text-sm text-fg outline-none transition-colors " +
  "hover:border-fg/30 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";

export function ConcertEditForm({ concertId, initial, orderCount, paidOrderCount, deleteBlockedReason }: Props) {
  const [state, formAction, isPending] = useActionState<ConcertEditState, FormData>(
    updateConcertAction.bind(null, concertId),
    null
  );
  const [deleteState, deleteAction, isDeleting] = useActionState<ConcertDeleteState, FormData>(
    deleteConcertAction.bind(null, concertId),
    null
  );
  // ลบ = 2 ขั้น (กดครั้งแรกโชว์กล่องยืนยัน) — แบบเดียวกับยกเลิกคำสั่งซื้อ (#102) ไม่ใช้ window.confirm
  const [confirmDelete, setConfirmDelete] = useState(false);

  const errorField = state && !state.ok ? state.field : undefined;
  const currentSlug = state?.ok ? state.slug : initial.slug;

  return (
    <div className="space-y-8">
      <form action={formAction} className="space-y-4">
        {state && !state.ok && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger/10 p-3 text-sm text-danger"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{state.error}</span>
          </div>
        )}
        {state?.ok && (
          <div
            role="status"
            className="space-y-1.5 rounded-lg border border-success/25 bg-success/10 p-3 text-sm text-success"
          >
            <p className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" />
              {state.message}
            </p>
            {state.warnings.map((w) => (
              <p key={w} className="flex items-start gap-2 text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>{w}</span>
              </p>
            ))}
          </div>
        )}

        {paidOrderCount > 0 && (
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              มีผู้ซื้อจ่ายเงินแล้ว {paidOrderCount} รายการ — ถ้าเปลี่ยนวันเวลาแสดงหรือสถานที่ ต้องแจ้งผู้ซื้อเอง
              (ระบบไม่ส่งอีเมลอัตโนมัติ)
            </span>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="title">ชื่อคอนเสิร์ต</Label>
          <Input id="title" name="title" required defaultValue={initial.title} error={errorField === "title"} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">รายละเอียด</Label>
          <Textarea
            id="description"
            name="description"
            required
            rows={4}
            defaultValue={initial.description}
            error={errorField === "description"}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="venue">สถานที่</Label>
          <Input id="venue" name="venue" required defaultValue={initial.venue} error={errorField === "venue"} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="eventAt">วันเวลาแสดง (เวลาไทย)</Label>
          <Input
            id="eventAt"
            name="eventAt"
            type="datetime-local"
            required
            defaultValue={initial.eventAt}
            error={errorField === "eventAt"}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="saleStartAt">เริ่มขาย</Label>
            <Input
              id="saleStartAt"
              name="saleStartAt"
              type="datetime-local"
              required
              defaultValue={initial.saleStartAt}
              error={errorField === "saleStartAt"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="saleEndAt">ปิดขาย (ไม่เกินเวลาแสดง)</Label>
            <Input
              id="saleEndAt"
              name="saleEndAt"
              type="datetime-local"
              required
              defaultValue={initial.saleEndAt}
              error={errorField === "saleEndAt"}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="maxTicketsPerUser">จำกัดตั๋วต่อบัญชี</Label>
            <Input
              id="maxTicketsPerUser"
              name="maxTicketsPerUser"
              type="number"
              min={1}
              max={MAX_TICKETS_PER_USER_LIMIT}
              required
              defaultValue={initial.maxTicketsPerUser}
              error={errorField === "maxTicketsPerUser"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">สถานะ</Label>
            <select id="status" name="status" defaultValue={initial.status} className={SELECT_CLASS}>
              {CONCERT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CONCERT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <p className="text-xs text-fg-faint">
              หน้าเว็บจะเทียบกับความจริงอีกชั้น (ไม่มีโซน/ยังไม่ถึงเวลา/งานจบ) — ตั้ง &quot;กำลังขาย&quot; แล้วผู้ชมอาจยังเห็นเป็นอย่างอื่น
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="slug">ลิงก์ (slug) — /concerts/…</Label>
          <Input
            id="slug"
            name="slug"
            defaultValue={initial.slug}
            placeholder="a-z 0-9 และขีด เช่น bts-bangkok-2026"
            error={errorField === "slug"}
          />
          <p className="text-xs text-fg-faint">
            เปลี่ยนแล้วลิงก์เดิมที่แชร์ไปจะใช้ไม่ได้ · เว้นว่าง = คงเดิม
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="coverImageUrl">ลิงก์รูปโปสเตอร์ (ไม่บังคับ)</Label>
          {/* type="text" ไม่ใช่ "url" — เบราว์เซอร์จะปฏิเสธ path ในเว็บ (/posters/…) ก่อนถึง server และฟ้องเป็นอังกฤษ
              "Please enter a URL." จนบันทึกอะไรไม่ได้ทั้งฟอร์ม (user-test 2026-08-28 BUG-1) · กติกาจริงอยู่ที่ lib/concert-form */}
          <Input
            id="coverImageUrl"
            name="coverImageUrl"
            type="text"
            inputMode="url"
            defaultValue={initial.coverImageUrl}
            placeholder="https://…/poster.jpg หรือ /posters/poster.jpg"
            error={errorField === "coverImageUrl"}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" size="lg" loading={isPending}>
            {isPending ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}
          </Button>
          <Link
            href={`/concerts/${currentSlug}`}
            className="inline-flex items-center gap-1.5 text-sm text-brand-300 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            ดูหน้าเว็บ <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </form>

      {/* โซนอันตราย — ลบได้เฉพาะคอนที่ยังไม่มีคำสั่งซื้อ */}
      <section className="rounded-xl border border-danger/25 bg-danger/5 p-4">
        <h2 className="font-display text-sm font-semibold text-danger">ลบคอนเสิร์ต</h2>
        {deleteBlockedReason ? (
          <p className="mt-1 text-sm text-fg-dim">{deleteBlockedReason}</p>
        ) : (
          <form action={deleteAction} className="mt-2 space-y-3">
            <p className="text-sm text-fg-dim">
              ลบแล้วโซน/ที่นั่ง/รอบกดบัตร/คิวของคอนเสิร์ตนี้จะหายทั้งหมด กู้คืนไม่ได้
              {orderCount === 0 ? " (ยังไม่มีคำสั่งซื้อ จึงลบได้)" : ""}
            </p>
            {deleteState && !deleteState.ok && (
              <p role="alert" className="flex items-start gap-2 text-sm text-danger">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{deleteState.error}</span>
              </p>
            )}
            {confirmDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="danger" size="sm" loading={isDeleting} leftIcon={<Trash2 className="size-4" />}>
                  {isDeleting ? "กำลังลบ…" : `ยืนยันลบ "${initial.title}"`}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={isDeleting}>
                  ยกเลิก
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDelete(true)} leftIcon={<Trash2 className="size-4" />}>
                ลบคอนเสิร์ตนี้…
              </Button>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
