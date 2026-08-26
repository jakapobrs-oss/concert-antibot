#!/usr/bin/env node
// ============================================================
// ก๊อปค่า env จากไฟล์ .env ในเครื่อง → Vercel (production) โดย "ไม่พิมพ์ค่า" ออกจอเลย
// ============================================================
// ใช้เมื่อ: prod ยังขาด env ที่มีอยู่แล้วในเครื่อง (เช่น PROMPTPAY_ID, EASYSLIP_API_KEY, RESEND_API_KEY)
//   การพิมพ์ค่าลงแชต/เทอร์มินัลเอง = ค่าไปนอนใน transcript → สคริปต์นี้อ่านจากไฟล์แล้วส่งให้
//   `vercel env add` ตรง ๆ (vercel พิมพ์แค่ชื่อตัวแปร ไม่พิมพ์ค่า)
//
// รัน:   node scripts/push-env-to-vercel.mjs PROMPTPAY_ID EASYSLIP_API_KEY [...]
// flags: --target production|preview|development (default production) · --file <path> (default .env)
//        --replace  (ถ้ามีอยู่แล้วบน Vercel ให้ลบแล้วใส่ใหม่ — ค่าเริ่มต้นคือหยุดและบอก)
// หลังใส่ครบ: ต้อง redeploy ค่าถึงจะมีผล (`npx vercel redeploy <url ของ deploy ล่าสุด>`)
//
// ความปลอดภัย: ไม่ log ค่า · ค่าว่าง = ข้าม · ไม่แตะตัวแปรที่ไม่ได้ระบุชื่อ
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const target = opt("--target", "production");
const file = opt("--file", ".env");
const replace = argv.includes("--replace");
const names = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--target" && argv[i - 1] !== "--file");

if (names.length === 0) {
  console.error("ใช้: node scripts/push-env-to-vercel.mjs NAME [NAME...] [--target production] [--file .env] [--replace]");
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`ไม่พบไฟล์ ${file}`);
  process.exit(2);
}

// อ่าน KEY=VALUE แบบง่าย: ตัด CR, ข้าม comment, ถอดเครื่องหมายคำพูดครอบค่า (ไม่รองรับ multiline)
const values = new Map();
for (const rawLine of readFileSync(file, "utf8").split("\n")) {
  const line = rawLine.replace(/\r$/, "");
  const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  values.set(m[1], v);
}

// vercel ผ่าน npx — บน Windows ต้องเรียก npx.cmd ผ่าน shell
const vercel = (args, input) =>
  spawnSync("npx", ["vercel", ...args], { stdio: ["pipe", "pipe", "pipe"], input, shell: true, encoding: "utf8" });

let failed = 0;
for (const name of names) {
  const value = values.get(name);
  if (!value) {
    console.error(`⏭  ${name}: ไม่มีค่าใน ${file} — ข้าม`);
    failed++;
    continue;
  }
  // ส่งค่าผ่าน --value (ไม่ผ่าน stdin) ตามที่ใช้ได้จริงกับ CRON_SECRET เมื่อ 2026-08-26
  let res = vercel(["env", "add", name, target, "--value", value, "--yes"]);
  if (res.status !== 0 && /already exist/i.test(res.stderr + res.stdout)) {
    if (!replace) {
      console.error(`✋ ${name}: มีอยู่แล้วบน Vercel (${target}) — ใส่ --replace ถ้าจะทับ`);
      failed++;
      continue;
    }
    vercel(["env", "rm", name, target, "--yes"]);
    res = vercel(["env", "add", name, target, "--value", value, "--yes"]);
  }
  if (res.status === 0) {
    console.log(`✅ ${name} → ${target} (ยาว ${value.length} ตัวอักษร)`);
  } else {
    // พิมพ์เฉพาะ stderr ของ vercel (ไม่มีค่าเราอยู่ในนั้น)
    console.error(`❌ ${name}: ${(res.stderr || res.stdout).trim().split("\n").slice(-3).join(" | ")}`);
    failed++;
  }
}

console.log(failed ? `\nเสร็จ — มีปัญหา ${failed} ตัว (ดูด้านบน)` : "\nเสร็จทุกตัว — อย่าลืม redeploy ให้ค่ามีผล");
process.exit(failed ? 1 : 0);
