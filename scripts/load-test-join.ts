// ============================================================
// Load Generator — /api/queue/join (peak-load / flash-crowd)
// ============================================================
// ยิง request พร้อมกันจำนวนมากเพื่อวัด latency + throughput ของ join endpoint
// ใช้ X-Forwarded-For + fingerprint ไม่ซ้ำต่อ request → เลี่ยง per-IP rate limit
// ไม่ส่ง turnstileToken → ได้ 428 (CHALLENGE) แต่ยังผ่านโค้ดเขียน BotEvent (จุดที่ #1 optimize)
//   = วัดผล non-blocking audit write ได้ตรง ๆ โดยไม่ต้องเรียก Cloudflare จริง
//
// env: TARGET (url), CONCURRENCY, TOTAL, IP_PREFIX, CONCERT_ID
const TARGET = process.env.TARGET ?? "http://localhost:3003";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 80);
const TOTAL = Number(process.env.TOTAL ?? 2000);
const IP_PREFIX = process.env.IP_PREFIX ?? "198.51.100"; // TEST-NET-2 (ใช้ทำเครื่องหมาย cleanup)
const CONCERT_ID = process.env.CONCERT_ID ?? "36";
const REQ_TIMEOUT_MS = 10_000;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function oneRequest(i: number): Promise<{ ms: number; status: number | "ERR" }> {
  // กระจาย IP ให้ครบ /16 กัน per-IP rate limit (10/min/ip)
  const ip = `${IP_PREFIX}.${(i % 254) + 1}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(`${TARGET}/api/queue/join`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": ip,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        Accept: "application/json",
        "Accept-Language": "th-TH",
      },
      body: JSON.stringify({ concertId: CONCERT_ID, fingerprintHash: `load-${i}` }),
    });
    return { ms: performance.now() - t0, status: res.status };
  } catch {
    return { ms: performance.now() - t0, status: "ERR" };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(
    `\n⚡ load test → ${TARGET} | concurrency=${CONCURRENCY} total=${TOTAL} concert=${CONCERT_ID}`
  );

  // warmup ให้ route compile (dev mode) ก่อนวัดจริง
  await oneRequest(0).catch(() => {});

  const latencies: number[] = [];
  const statusCount: Record<string, number> = {};
  let next = 0;

  const t0 = performance.now();
  // worker pool — มี CONCURRENCY ตัวดึงงานจากคิวกลางจนครบ TOTAL
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= TOTAL) return;
      const r = await oneRequest(i);
      latencies.push(r.ms);
      statusCount[String(r.status)] = (statusCount[String(r.status)] ?? 0) + 1;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const elapsedMs = performance.now() - t0;

  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((a, b) => a + b, 0);
  const result = {
    target: TARGET,
    total: TOTAL,
    concurrency: CONCURRENCY,
    throughput_rps: Math.round((TOTAL / elapsedMs) * 1000),
    elapsed_s: +(elapsedMs / 1000).toFixed(2),
    latency_ms: {
      avg: Math.round(sum / latencies.length),
      p50: Math.round(pct(latencies, 50)),
      p95: Math.round(pct(latencies, 95)),
      p99: Math.round(pct(latencies, 99)),
      max: Math.round(latencies[latencies.length - 1]),
    },
    status: statusCount,
  };
  console.log(JSON.stringify(result, null, 2));
}

main();
