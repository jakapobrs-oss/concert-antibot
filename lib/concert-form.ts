// ฟอร์มคอนเสิร์ตของแอดมิน (สร้าง/แก้ไข) — กติกา validate รวมที่เดียว pure ไม่แตะ DB ให้ unit test ได้
//
// เหตุ (2026-08-27 rev 41): แอดมินแก้ชื่อ/วัน/ช่วงขาย/สถานที่ของคอนเสิร์ตไม่ได้เลย (มีแค่เปิด-ปิดขายกับผัง)
//   พิมพ์ผิดทีเดียวต้องเข้า DB — กรรมการมักลองกดตรงนี้ตอนสอบ
import { parseThaiDateTimeLocal } from "@/lib/local-datetime";

export const CONCERT_STATUSES = ["DRAFT", "SCHEDULED", "ON_SALE", "SOLD_OUT", "ENDED"] as const;
export type ConcertStatusValue = (typeof CONCERT_STATUSES)[number];

// ป้ายภาษาไทยของสถานะที่แอดมินตั้ง (ชุดเดียวกับหน้า list/detail)
export const CONCERT_STATUS_LABEL: Record<ConcertStatusValue, string> = {
  DRAFT: "ฉบับร่าง (ซ่อนจากหน้าเว็บ)",
  SCHEDULED: "ตั้งเวลา (โชว์ว่าเร็ว ๆ นี้)",
  ON_SALE: "กำลังขาย",
  SOLD_OUT: "เต็มแล้ว",
  ENDED: "จบงาน (ซ่อนจากหน้าเว็บ)",
};

// slug = ส่วนท้าย URL /concerts/<slug> — ASCII เท่านั้น (ดู lib/slug.ts)
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 100;
export const MAX_TICKETS_PER_USER_LIMIT = 20;
const TITLE_MAX = 255;
const VENUE_MAX = 255;
const COVER_URL_MAX = 500;

export interface ConcertFormData {
  title: string;
  description: string;
  venue: string;
  eventAt: Date;
  saleStartAt: Date;
  saleEndAt: Date;
  maxTicketsPerUser: number;
  coverImageUrl: string | null;
  slug?: string; // เฉพาะฟอร์มแก้ไข — ว่าง = ไม่เปลี่ยน
  status?: ConcertStatusValue; // เฉพาะฟอร์มแก้ไข
}

export type ConcertFormResult =
  | { ok: true; data: ConcertFormData }
  | { ok: false; error: string; field?: string };

type RawForm = Record<string, FormDataEntryValue | string | null | undefined>;

function field(raw: RawForm, key: string): string {
  const v = raw[key];
  return typeof v === "string" ? v.trim() : "";
}

function fail(error: string, field?: string): ConcertFormResult {
  return { ok: false, error, field };
}

export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase();
}

// ตรวจฟอร์มทั้งใบ → ข้อมูลพร้อมเขียน DB หรือ error ข้อแรกที่เจอ (พร้อมชื่อฟิลด์ให้ไฮไลต์)
export function parseConcertForm(
  raw: RawForm,
  opts: { withSlug?: boolean; withStatus?: boolean } = {}
): ConcertFormResult {
  const title = field(raw, "title");
  if (!title) return fail("กรุณากรอกชื่อคอนเสิร์ต", "title");
  if (title.length > TITLE_MAX) return fail(`ชื่อคอนเสิร์ตยาวเกิน ${TITLE_MAX} ตัวอักษร`, "title");

  const description = field(raw, "description");
  if (!description) return fail("กรุณากรอกรายละเอียด", "description");

  const venue = field(raw, "venue");
  if (!venue) return fail("กรุณากรอกสถานที่", "venue");
  if (venue.length > VENUE_MAX) return fail(`สถานที่ยาวเกิน ${VENUE_MAX} ตัวอักษร`, "venue");

  // datetime-local จากฟอร์มไม่มี timezone → ตีความเป็นเวลาไทยเสมอ (server บน Vercel เป็น UTC) — rev 29
  const eventAt = parseThaiDateTimeLocal(field(raw, "eventAt"));
  if (!eventAt) return fail("วันเวลาแสดงไม่ถูกต้อง", "eventAt");
  const saleStartAt = parseThaiDateTimeLocal(field(raw, "saleStartAt"));
  if (!saleStartAt) return fail("เวลาเริ่มขายไม่ถูกต้อง", "saleStartAt");
  const saleEndAt = parseThaiDateTimeLocal(field(raw, "saleEndAt"));
  if (!saleEndAt) return fail("เวลาปิดขายไม่ถูกต้อง", "saleEndAt");
  if (saleEndAt.getTime() <= saleStartAt.getTime()) {
    return fail("เวลาปิดขายต้องอยู่หลังเวลาเริ่มขาย", "saleEndAt");
  }
  // ขายบัตรหลังงานเริ่มไม่ได้ — เดิมฟอร์มยอมให้ตั้ง ทำให้คอนที่งานจบแล้วยังขึ้น "กำลังขาย" (คอนพี่เจี๊ยบ 27 ส.ค.)
  if (saleEndAt.getTime() > eventAt.getTime()) {
    return fail("เวลาปิดขายต้องไม่เกินเวลาแสดง (ขายบัตรหลังงานเริ่มไม่ได้)", "saleEndAt");
  }

  const maxTicketsPerUser = Number(field(raw, "maxTicketsPerUser"));
  if (
    !Number.isInteger(maxTicketsPerUser) ||
    maxTicketsPerUser < 1 ||
    maxTicketsPerUser > MAX_TICKETS_PER_USER_LIMIT
  ) {
    return fail(`จำกัดตั๋วต่อบัญชีต้องเป็นจำนวนเต็ม 1–${MAX_TICKETS_PER_USER_LIMIT}`, "maxTicketsPerUser");
  }

  // โปสเตอร์: ลิงก์ http(s) · หรือ path ในเว็บที่ขึ้นต้นด้วย "/" (เช่น /posters/x.svg ที่ seed ไว้) · หรือเว้นว่าง
  //   user-test 2026-08-28 (BUG-1): เดิมรับแค่ http(s) แต่คอนที่ seed มีค่า /posters/… → แก้ช่องไหนก็บันทึกไม่ได้ทั้งฟอร์ม
  //   "//host/x" (protocol-relative) ไม่รับ — เป็นลิงก์ออกนอกเว็บที่ดูเหมือน path ในเว็บ
  const coverRaw = field(raw, "coverImageUrl");
  if (coverRaw.length > COVER_URL_MAX) return fail(`ลิงก์รูปโปสเตอร์ยาวเกิน ${COVER_URL_MAX} ตัวอักษร`, "coverImageUrl");
  if (coverRaw && !/^(https?:\/\/\S+|\/(?!\/)\S+)$/i.test(coverRaw)) {
    return fail("ลิงก์รูปโปสเตอร์ต้องขึ้นต้นด้วย http:// https:// หรือ / (ไฟล์ในเว็บ) — หรือเว้นว่าง", "coverImageUrl");
  }

  const data: ConcertFormData = {
    title,
    description,
    venue,
    eventAt,
    saleStartAt,
    saleEndAt,
    maxTicketsPerUser,
    coverImageUrl: coverRaw || null,
  };

  if (opts.withSlug) {
    const slug = normalizeSlug(field(raw, "slug"));
    if (slug) {
      if (slug.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(slug)) {
        return fail("slug ใช้ได้เฉพาะ a-z 0-9 และขีด (-) คั่นคำ เช่น bts-bangkok-2026", "slug");
      }
      data.slug = slug;
    }
  }

  if (opts.withStatus) {
    const status = field(raw, "status");
    if (!(CONCERT_STATUSES as readonly string[]).includes(status)) return fail("สถานะไม่ถูกต้อง", "status");
    data.status = status as ConcertStatusValue;
  }

  return { ok: true, data };
}

// ลบได้เฉพาะคอนเสิร์ตที่ยังไม่มีคำสั่งซื้อผูกอยู่ — Order ไม่ cascade (เก็บประวัติเงิน) ส่วนโซน/ที่นั่ง/รอบ/คิว cascade ตาม FK
export function canDeleteConcert(input: { orderCount: number }): { ok: true } | { ok: false; reason: string } {
  if (input.orderCount > 0) {
    return {
      ok: false,
      reason: `มีคำสั่งซื้อผูกอยู่ ${input.orderCount} รายการ ลบไม่ได้ — ตั้งสถานะ "จบงาน" หรือ "ฉบับร่าง" เพื่อซ่อนจากหน้าเว็บแทน`,
    };
  }
  return { ok: true };
}

// สิ่งที่เปลี่ยนแล้วกระทบคนที่ซื้อไปแล้ว (ระบบไม่ส่งอีเมลแจ้งอัตโนมัติ — แอดมินต้องแจ้งเอง)
export function changesAffectingBuyers(
  before: { eventAt: Date; venue: string },
  after: { eventAt: Date; venue: string }
): string[] {
  const changed: string[] = [];
  if (before.eventAt.getTime() !== after.eventAt.getTime()) changed.push("วันเวลาแสดง");
  if (before.venue !== after.venue) changed.push("สถานที่");
  return changed;
}
