"use client";

// แผงจัดการรอบขาย + โค้ดสิทธิ์ ในหน้า /admin/concerts/[id] (Phase 2.1, docs/21)
// ตั้งรอบตามลำดับจริง: แฟนคลับ → พาร์ทเนอร์ → สมาชิก → ทั่วไป (รอบก่อนจบตรงเวลาที่รอบถัดไปเริ่ม)
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, KeyRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  createSaleRound,
  createStandardRounds,
  deleteSaleRound,
  createAccessCode,
  deleteAccessCode,
} from "@/app/actions/admin-sale-round";

type Audience = "FANCLUB" | "PARTNER" | "MEMBER_ONLY" | "PUBLIC";

export type AdminRoundView = {
  id: string;
  name: string;
  audience: Audience;
  startAt: string;
  endAt: string;
  requiresPreRegistration: boolean;
  preRegisterStartAt: string | null;
  preRegisterEndAt: string | null;
  maxTicketsPerUser: number | null;
  seatQuota: number | null;
  preRegistrationCount: number;
  orderCount: number;
  codes: { id: string; code: string; label: string | null; maxUses: number | null; usedCount: number }[];
};

const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "FANCLUB", label: "1 · แฟนคลับ (สมาชิกพรีเมียม)" },
  { value: "PARTNER", label: "2 · พาร์ทเนอร์ (ใช้โค้ดสิทธิ์)" },
  { value: "MEMBER_ONLY", label: "3 · สมาชิก" },
  { value: "PUBLIC", label: "4 · ทั่วไป" },
];

const AUDIENCE_TONE: Record<Audience, "spot" | "warning" | "brand" | "neutral"> = {
  FANCLUB: "spot",
  PARTNER: "warning",
  MEMBER_ONLY: "brand",
  PUBLIC: "neutral",
};

const dt = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

// input[type=datetime-local] ต้องการรูปแบบ "YYYY-MM-DDTHH:mm" ตามเวลาเครื่อง
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type SaleWindowView = { saleStartAt: string; saleEndAt: string };

export function AdminSaleRounds({
  concertId,
  rounds,
  saleWindow,
  windowWarning,
}: {
  concertId: string;
  rounds: AdminRoundView[];
  // ช่วงขายของคอนเสิร์ต — พรีเซ็ตใช้เป็น "รอบทั่วไป" และโชว์พรีวิวให้แอดมินเห็นก่อนกด
  saleWindow: SaleWindowView;
  // รอบที่ยื่นออกนอกช่วงขาย (คำนวณฝั่ง server ด้วย roundsOutsideSaleWindow) — null = ไม่มี
  windowWarning: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const now = new Date();
  const [form, setForm] = useState({
    name: "รอบสมาชิก",
    audience: "MEMBER_ONLY" as Audience,
    startAt: toLocalInput(new Date(now.getTime() + 60 * 60 * 1000)),
    endAt: toLocalInput(new Date(now.getTime() + 2 * 60 * 60 * 1000)),
    requiresPreRegistration: false,
    preRegisterStartAt: "",
    preRegisterEndAt: "",
    maxTicketsPerUser: "",
    seatQuota: "",
  });

  async function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(true);
    setMsg(null);
    const res = await fn();
    setMsg({ ok: res.ok, text: res.ok ? (res.message ?? "สำเร็จ") : (res.error ?? "ไม่สำเร็จ") });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await run(() =>
      createSaleRound({
        concertId,
        name: form.name,
        audience: form.audience,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        requiresPreRegistration: form.requiresPreRegistration,
        preRegisterStartAt: form.preRegisterStartAt
          ? new Date(form.preRegisterStartAt).toISOString()
          : undefined,
        preRegisterEndAt: form.preRegisterEndAt
          ? new Date(form.preRegisterEndAt).toISOString()
          : undefined,
        maxTicketsPerUser: form.maxTicketsPerUser ? Number(form.maxTicketsPerUser) : null,
        seatQuota: form.seatQuota ? Number(form.seatQuota) : null,
      })
    );
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold text-fg">รอบกดบัตร</h2>
          <p className="text-xs text-fg-faint">
            ไม่ตั้งรอบเลย = ขายแบบเดิม (ทุกคนกดได้ตลอดช่วงเปิดขาย)
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "ปิดฟอร์ม" : "+ เพิ่มรอบ"}
        </Button>
      </div>

      {/* รอบที่อยู่นอกช่วงขาย = ไม่มีใครกดถึง (หน้าเว็บโชว์ปุ่มเข้าคิวเฉพาะในช่วงขาย) — เตือนให้แก้ก่อนถึงวันจริง */}
      {windowWarning && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          {windowWarning}
        </p>
      )}

      {/* ทางลัดที่ผู้จัดใช้จริงเกือบทุกงาน: สมาชิกกดก่อน N วัน แล้วต่อด้วยรอบทั่วไป */}
      {rounds.length === 0 && (
        <StandardRoundsForm concertId={concertId} busy={busy} run={run} saleWindow={saleWindow} />
      )}

      {open && (
        <form
          onSubmit={handleCreate}
          className="mb-4 space-y-3 rounded-xl border border-fg/10 bg-ink-850 p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-fg-dim">ชื่อรอบ</span>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                maxLength={100}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-fg-dim">กลุ่มผู้มีสิทธิ์</span>
              <select
                value={form.audience}
                onChange={(e) => setForm({ ...form, audience: e.target.value as Audience })}
                className="h-11 w-full rounded-lg border border-fg/15 bg-ink-950/60 px-3 text-sm text-fg
                  outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              >
                {AUDIENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-fg-dim">เริ่มรอบ</span>
              <Input
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-fg-dim">จบรอบ</span>
              <Input
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-fg-dim">จำกัดตั๋ว/คน (เว้นว่าง = ใช้ค่าคอนเสิร์ต)</span>
              <Input
                type="number"
                min={1}
                max={20}
                value={form.maxTicketsPerUser}
                onChange={(e) => setForm({ ...form, maxTicketsPerUser: e.target.value })}
                placeholder="เช่น 2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-fg-dim">โควต้าที่นั่งของรอบ (เว้นว่าง = ไม่จำกัด)</span>
              <Input
                type="number"
                min={1}
                value={form.seatQuota}
                onChange={(e) => setForm({ ...form, seatQuota: e.target.value })}
                placeholder="เช่น 50"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-fg-dim">
            <input
              type="checkbox"
              checked={form.requiresPreRegistration}
              onChange={(e) => setForm({ ...form, requiresPreRegistration: e.target.checked })}
              className="size-4 accent-brand-500"
            />
            ต้องลงทะเบียนล่วงหน้าก่อนถึงจะกดรอบนี้ได้
          </label>

          {form.requiresPreRegistration && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-fg-dim">เปิดลงทะเบียน</span>
                <Input
                  type="datetime-local"
                  value={form.preRegisterStartAt}
                  onChange={(e) => setForm({ ...form, preRegisterStartAt: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-fg-dim">ปิดลงทะเบียน (เว้นว่าง = ปิดตอนรอบเริ่ม)</span>
                <Input
                  type="datetime-local"
                  value={form.preRegisterEndAt}
                  onChange={(e) => setForm({ ...form, preRegisterEndAt: e.target.value })}
                />
              </label>
            </div>
          )}

          <Button type="submit" size="sm" loading={busy} leftIcon={<Plus className="size-4" />}>
            สร้างรอบ
          </Button>
        </form>
      )}

      {msg && (
        <p role="status" className={`mb-3 text-sm ${msg.ok ? "text-success" : "text-danger"}`}>
          {msg.text}
        </p>
      )}

      {rounds.length === 0 ? (
        <p className="rounded-xl border border-dashed border-fg/15 bg-ink-900/60 p-5 text-center text-sm text-fg-faint">
          ยังไม่มีรอบขาย — คอนเสิร์ตนี้ขายแบบเดิม
        </p>
      ) : (
        <ol className="space-y-2">
          {rounds.map((r) => (
            <li key={r.id} className="rounded-xl border border-fg/10 bg-ink-850 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={AUDIENCE_TONE[r.audience]}>{r.name}</Badge>
                  <span className="text-xs text-fg-faint">
                    {dt.format(new Date(r.startAt))} – {dt.format(new Date(r.endAt))}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => deleteSaleRound({ saleRoundId: r.id }))}
                  className="inline-flex items-center gap-1 rounded-md border border-danger/40 bg-danger/10 px-2 py-1
                    text-xs font-medium text-danger hover:bg-danger/20 disabled:opacity-50"
                >
                  <Trash2 className="size-3" /> ลบ
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-fg-faint">
                {r.maxTicketsPerUser !== null && (
                  <span className="rounded-md bg-fg/10 px-2 py-0.5">
                    จำกัด {r.maxTicketsPerUser} ใบ/คน
                  </span>
                )}
                {r.seatQuota !== null && (
                  <span className="rounded-md bg-fg/10 px-2 py-0.5">โควต้า {r.seatQuota} ที่นั่ง</span>
                )}
                {r.requiresPreRegistration && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-brand-500/15 px-2 py-0.5 text-brand-300">
                    <Users className="size-3" /> ลงทะเบียนล่วงหน้าแล้ว {r.preRegistrationCount} คน
                  </span>
                )}
                <span className="rounded-md bg-fg/10 px-2 py-0.5">คำสั่งซื้อ {r.orderCount}</span>
              </div>

              {r.audience === "PARTNER" && (
                <AccessCodes roundId={r.id} codes={r.codes} busy={busy} run={run} />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AccessCodes({
  roundId,
  codes,
  busy,
  run,
}: {
  roundId: string;
  codes: AdminRoundView["codes"];
  busy: boolean;
  run: (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("");

  return (
    <div className="mt-3 rounded-lg border border-fg/10 bg-ink-900/60 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg-dim">
        <KeyRound className="size-3.5 text-brand-300" /> โค้ดสิทธิ์ของรอบนี้
      </p>

      {codes.length > 0 && (
        <ul className="mb-2 space-y-1">
          {codes.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-fg-dim">
                <code className="rounded bg-fg/10 px-1.5 py-0.5 font-mono">{c.code}</code>
                {c.label ? ` · ${c.label}` : ""} · ใช้ไป {c.usedCount}
                {c.maxUses !== null ? `/${c.maxUses}` : " (ไม่จำกัด)"}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => deleteAccessCode({ accessCodeId: c.id }))}
                className="text-danger hover:underline disabled:opacity-50"
              >
                ลบ
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await run(() =>
            createAccessCode({
              saleRoundId: roundId,
              code,
              label: label || undefined,
              maxUses: maxUses ? Number(maxUses) : null,
            })
          );
          setCode("");
          setLabel("");
          setMaxUses("");
        }}
        className="flex flex-wrap gap-2"
      >
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="โค้ด เช่น MASTERCARD2026"
          className="min-w-40 flex-1 uppercase"
          required
          minLength={4}
          maxLength={64}
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="ป้ายกำกับ (ไม่บังคับ)"
          className="min-w-32 flex-1"
          maxLength={100}
        />
        <Input
          type="number"
          min={1}
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          placeholder="จำนวนสิทธิ์"
          className="w-28"
        />
        <Button type="submit" size="sm" variant="outline" loading={busy}>
          เพิ่มโค้ด
        </Button>
      </form>
    </div>
  );
}

// ตั้งรอบมาตรฐาน 2 รอบในคลิกเดียว — รอบสมาชิกก่อน N วัน แล้วต่อรอบทั่วไปทันที
function StandardRoundsForm({
  concertId,
  busy,
  run,
  saleWindow,
}: {
  concertId: string;
  busy: boolean;
  run: (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => Promise<void>;
  saleWindow: SaleWindowView;
}) {
  const [leadDays, setLeadDays] = useState(3);
  const [memberMax, setMemberMax] = useState("");
  const [memberQuota, setMemberQuota] = useState("");

  // ช่วงขายเดิมของคอนเสิร์ต = รอบทั่วไป · รอบสมาชิก = ก่อนหน้านั้น N วัน (server คำนวณซ้ำด้วย planStandardRounds)
  const saleStart = new Date(saleWindow.saleStartAt);
  const saleEnd = new Date(saleWindow.saleEndAt);
  const memberStart = new Date(saleStart.getTime() - leadDays * 24 * 60 * 60 * 1000);
  // ถึงเวลาเริ่มขายไปแล้ว → รอบสมาชิกที่ "มาก่อน" จะอยู่ในอดีตทั้งรอบ — บอกให้เลื่อนก่อน ไม่ให้กดเปล่า ๆ
  const saleAlreadyStarted = saleStart.getTime() <= Date.now();

  return (
    <div className="mb-4 rounded-xl border border-brand-500/25 bg-brand-500/5 p-4">
      <p className="font-display text-sm font-semibold text-fg">ตั้งรอบมาตรฐาน (สมาชิกกดก่อน)</p>
      <p className="mb-3 text-xs text-fg-faint">
        ใช้ช่วงขายที่ตั้งไว้เป็น &ldquo;รอบทั่วไป&rdquo; แล้วเปิดรอบสมาชิกก่อนหน้านั้น —
        ขายไม่หมดในรอบสมาชิก ที่นั่งที่เหลือขายต่อรอบทั่วไปเอง · หมดตั้งแต่รอบสมาชิก ระบบประกาศบัตรหมดและรอบทั่วไปไม่เปิด
      </p>

      {/* พรีวิวไทม์ไลน์ให้เห็นก่อนกด — แอดมินไม่ต้องคำนวณเวลาต่อกันเอง */}
      <dl className="mb-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-fg-faint">รอบสมาชิก</dt>
        <dd className="text-fg">
          {dt.format(memberStart)} – {dt.format(saleStart)}
        </dd>
        <dt className="text-fg-faint">รอบทั่วไป</dt>
        <dd className="text-fg">
          {dt.format(saleStart)} – {dt.format(saleEnd)}{" "}
          <span className="text-xs text-fg-faint">(= ช่วงขายเดิม)</span>
        </dd>
      </dl>

      {saleAlreadyStarted ? (
        <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          คอนเสิร์ตนี้ถึงเวลาเริ่มขายแล้ว ({dt.format(saleStart)}) — รอบสมาชิกต้องมาก่อนช่วงขาย
          ให้เลื่อน &ldquo;เริ่มขาย&rdquo; ในหน้าแก้ไขคอนเสิร์ตไปเป็นอนาคตก่อน หรือเพิ่มรอบเองด้วย &ldquo;+ เพิ่มรอบ&rdquo;
        </p>
      ) : (
        <p className="mb-3 text-xs text-fg-faint">
          ระบบจะเลื่อน &ldquo;เริ่มขาย&rdquo; ของคอนเสิร์ตมาเป็น {dt.format(memberStart)} ให้ ปุ่มเข้าคิวจึงโผล่ตั้งแต่รอบสมาชิก
          (คนที่ไม่ใช่สมาชิกจะเห็นว่ารอบทั่วไปเริ่มเมื่อไร)
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-fg-dim">สมาชิกกดก่อนรอบทั่วไป</span>
          <select
            value={leadDays}
            onChange={(e) => setLeadDays(Number(e.target.value))}
            className="h-11 rounded-lg border border-fg/15 bg-ink-950/60 px-3 text-sm text-fg
              outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          >
            {[1, 2, 3, 7].map((d) => (
              <option key={d} value={d}>
                {d} วัน
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-fg-dim">จำกัดตั๋วรอบสมาชิก</span>
          <Input
            type="number"
            min={1}
            max={20}
            value={memberMax}
            onChange={(e) => setMemberMax(e.target.value)}
            placeholder="เว้นว่าง = ใช้ค่าคอนเสิร์ต"
            className="w-44"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-fg-dim">โควต้าที่นั่งรอบสมาชิก</span>
          <Input
            type="number"
            min={1}
            value={memberQuota}
            onChange={(e) => setMemberQuota(e.target.value)}
            placeholder="เว้นว่าง = ไม่จำกัด"
            className="w-44"
          />
        </label>
        <Button
          size="sm"
          loading={busy}
          disabled={saleAlreadyStarted}
          onClick={() =>
            run(() =>
              createStandardRounds({
                concertId,
                leadDays,
                memberMaxTickets: memberMax ? Number(memberMax) : null,
                memberSeatQuota: memberQuota ? Number(memberQuota) : null,
              })
            )
          }
        >
          ตั้งรอบให้เลย
        </Button>
      </div>
    </div>
  );
}
