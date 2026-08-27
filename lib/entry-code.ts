// Dynamic QR (Phase 3, docs/19) — รหัสเข้างานหมุนตามเวลา กันแชร์ภาพหน้าจอ QR
// code = HMAC_SHA256(qrSecret ของตั๋ว, window ของเวลา) — server คำนวณเท่านั้น
// ⚠️ qrSecret ห้ามส่งไป client เด็ดขาด — client ได้แค่ "code ของ window ปัจจุบัน"
import crypto from "node:crypto";

export const ENTRY_CODE_WINDOW_MS = 30_000; // QR หมุนทุก 30 วินาที
const CODE_LEN = 10;

// prefix ในเนื้อ QR — จุดสแกนใช้แยกว่าเป็น QR เข้างานของระบบนี้
export const ENTRY_QR_PREFIX = "ENT";

export function entryCodeForWindow(qrSecret: string, windowIndex: number): string {
  return crypto
    .createHmac("sha256", qrSecret)
    .update(String(windowIndex))
    .digest("hex")
    .slice(0, CODE_LEN)
    .toUpperCase();
}

// code ปัจจุบัน + เวลาที่เหลือก่อนหมุน (client ใช้ตั้งเวลา poll รอบถัดไป)
export function currentEntryCode(qrSecret: string, now = Date.now()): { code: string; msLeft: number } {
  const idx = Math.floor(now / ENTRY_CODE_WINDOW_MS);
  return {
    code: entryCodeForWindow(qrSecret, idx),
    msLeft: ENTRY_CODE_WINDOW_MS - (now % ENTRY_CODE_WINDOW_MS),
  };
}

// ชุด code ของ window ปัจจุบัน + อีก (count-1) window ถัดไป (rev 42 — หน้าตั๋วขอล่วงหน้า)
// ทำไม: หน้างานคนแน่น เน็ตมือถือมักหาย ถ้าต้องขอ code ใหม่ทุก 30 วิ QR จะตายภายใน ~1 นาที
//   → client ถือ QR ล่วงหน้า ENTRY_PREFETCH_WINDOWS ช่วง (5 นาที) แล้วหมุนเองแม้ออฟไลน์
//   ยังกันแคปหน้าจอได้เหมือนเดิม (ภาพเดียวมีแค่ code ของช่วงนั้น) — แค่หน้าต่างที่ client รู้ล่วงหน้ากว้างขึ้นเป็น 5 นาที
//   qrSecret ยังไม่ออกจาก server เหมือนเดิม
export const ENTRY_PREFETCH_WINDOWS = 10;

export function entryCodeBatch(
  qrSecret: string,
  count = ENTRY_PREFETCH_WINDOWS,
  now = Date.now(),
): { startIndex: number; msLeft: number; codes: string[] } {
  const n = Math.max(1, Math.min(count, ENTRY_PREFETCH_WINDOWS)); // เพดานแข็ง — ห้ามขอทั้งวัน
  const idx = Math.floor(now / ENTRY_CODE_WINDOW_MS);
  const codes: string[] = [];
  for (let i = 0; i < n; i++) codes.push(entryCodeForWindow(qrSecret, idx + i));
  return { startIndex: idx, msLeft: ENTRY_CODE_WINDOW_MS - (now % ENTRY_CODE_WINDOW_MS), codes };
}

// ตรวจ code ตอนสแกนเข้างาน — ยอมรับ ±1 window กัน clock skew/กดตอนรอยต่อ
// เทียบแบบ timing-safe กันเดา code จากเวลาตอบ
export function verifyEntryCode(qrSecret: string, code: string, now = Date.now()): boolean {
  if (!qrSecret || !code) return false; // ไม่มี secret/code = ตรวจไม่ได้ = ไม่ผ่าน (fail-closed)
  const normalized = code.trim().toUpperCase();
  const idx = Math.floor(now / ENTRY_CODE_WINDOW_MS);
  for (const w of [idx, idx - 1, idx + 1]) {
    const expected = Buffer.from(entryCodeForWindow(qrSecret, w));
    const given = Buffer.from(normalized);
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) return true;
  }
  return false;
}

// เนื้อหาใน QR = "ENT:<ticketId>:<code>" — จุดสแกน parse กลับด้วยตัวนี้
export function buildEntryQrText(ticketId: string, code: string): string {
  return `${ENTRY_QR_PREFIX}:${ticketId}:${code}`;
}

export function parseEntryQrText(text: string): { ticketId: string; code: string } | null {
  const parts = text.trim().split(":");
  if (parts.length !== 3 || parts[0] !== ENTRY_QR_PREFIX) return null;
  const [, ticketId, code] = parts;
  if (!/^\d+$/.test(ticketId) || code.length === 0) return null;
  return { ticketId, code };
}
