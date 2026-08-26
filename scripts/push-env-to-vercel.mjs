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
//        --dry-run  (บอกว่าจะเรียกอะไร/ค่ายาวเท่าไร โดยไม่แตะ Vercel)
// หลังใส่ครบ: ต้อง redeploy ค่าถึงจะมีผล (`npx vercel redeploy <url ของ deploy ล่าสุด>` หรือ push commit ใหม่)
//
// วิธีเรียก vercel (สำคัญ — เคยพลาดจริง 2026-08-26):
//   เดิมใช้ spawnSync("npx", [...], { shell: true }) → บน Windows Node "ต่อ" argument ด้วยช่องว่างโดยไม่ escape
//   (DEP0190) → ค่าที่มีช่องว่าง เช่น PAYMENTS_RECEIVER_NAME="จักรภพ รามศักดิ์,Jakapob Ramsak" แตกเป็น 4 arg
//   → vercel ได้ --value แค่คำแรก + arg เกิน = error (ตัวที่ไม่มีช่องว่างผ่านหมด จึงดูเหมือนสุ่ม)
//   แก้: หาไฟล์ JS ของ vercel CLI (global npm / node_modules) แล้วเรียกผ่าน node ตรง ๆ ไม่ผ่าน shell
//   → argument ส่งเป็น Unicode ครบทุกตัว (พิสูจน์ด้วย spawn test: ไทย+ช่องว่าง+จุลภาคมาครบ)
//   ถ้าหา vercel ไม่เจอ → fallback `npx vercel` ผ่าน shell แต่ส่งค่าทาง stdin แทน --value (ค่าไม่ผ่าน command line)
//
// ความปลอดภัย: ไม่ log ค่า · ค่าว่าง = ข้าม · ไม่แตะตัวแปรที่ไม่ได้ระบุชื่อ
import { readFileSync, existsSync } from "node:fs";
import { spawnSync, execSync } from "node:child_process";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const target = opt("--target", "production");
const file = opt("--file", ".env");
const replace = argv.includes("--replace");
const dryRun = argv.includes("--dry-run");
const names = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--target" && argv[i - 1] !== "--file");

if (names.length === 0) {
  console.error(
    "ใช้: node scripts/push-env-to-vercel.mjs NAME [NAME...] [--target production] [--file .env] [--replace] [--dry-run]"
  );
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

// หาไฟล์ JS ของ vercel CLI: global npm ก่อน แล้วค่อย node_modules ของโปรเจกต์
function resolveVercelEntry() {
  const dirs = [];
  try {
    dirs.push(join(execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), "vercel"));
  } catch {
    /* ไม่มี npm global ก็ข้าม */
  }
  dirs.push(join(process.cwd(), "node_modules", "vercel"));
  for (const dir of dirs) {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const bin = JSON.parse(readFileSync(pkgPath, "utf8")).bin;
    const rel = typeof bin === "string" ? bin : bin?.vercel;
    if (rel && existsSync(join(dir, rel))) return join(dir, rel);
  }
  return null;
}
const entry = resolveVercelEntry();

// เรียก vercel: มี entry → node ตรง (ไม่ผ่าน shell) · ไม่มี → npx ผ่าน shell (args เป็น ASCII ล้วน, ค่าไปทาง stdin)
const vercel = (args, input) =>
  entry
    ? spawnSync(process.execPath, [entry, ...args], { input, encoding: "utf8" })
    : spawnSync(`npx vercel ${args.join(" ")}`, { input, shell: true, encoding: "utf8" });

// คำสั่ง add: ทางตรงส่ง --value ได้ปลอดภัย · ทาง fallback ห้ามใส่ค่าใน command line → ให้ vercel อ่าน stdin
const addEnv = (name, value) =>
  entry
    ? vercel(["env", "add", name, target, "--value", value, "--yes"])
    : vercel(["env", "add", name, target, "--yes"], value);

console.log(entry ? `vercel CLI: ${entry} (เรียกผ่าน node ตรง)` : "vercel CLI: npx vercel (fallback — ส่งค่าทาง stdin)");

let failed = 0;
for (const name of names) {
  const value = values.get(name);
  if (!value) {
    console.error(`⏭  ${name}: ไม่มีค่าใน ${file} — ข้าม`);
    failed++;
    continue;
  }
  if (dryRun) {
    console.log(`🧪 ${name}: จะส่งไป ${target} ยาว ${value.length} ตัวอักษร${/\s/.test(value) ? " (มีช่องว่าง)" : ""}`);
    continue;
  }
  let res = addEnv(name, value);
  if (res.status !== 0 && /already exist/i.test(res.stderr + res.stdout)) {
    if (!replace) {
      console.error(`✋ ${name}: มีอยู่แล้วบน Vercel (${target}) — ใส่ --replace ถ้าจะทับ`);
      failed++;
      continue;
    }
    vercel(["env", "rm", name, target, "--yes"]);
    res = addEnv(name, value);
  }
  if (res.status === 0) {
    console.log(`✅ ${name} → ${target} (ยาว ${value.length} ตัวอักษร)`);
  } else {
    // พิมพ์เฉพาะ stderr ของ vercel (ไม่มีค่าเราอยู่ในนั้น)
    console.error(`❌ ${name}: ${(res.stderr || res.stdout || "").trim().split("\n").slice(-3).join(" | ")}`);
    failed++;
  }
}

if (dryRun) process.exit(0);
console.log(failed ? `\nเสร็จ — มีปัญหา ${failed} ตัว (ดูด้านบน)` : "\nเสร็จทุกตัว — อย่าลืม redeploy ให้ค่ามีผล");
process.exit(failed ? 1 : 0);
