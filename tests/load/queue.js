// k6 Load Test — Virtual Waiting Room (Phase 9)
// รัน: k6 run tests/load/queue.js
// ติดตั้ง k6: https://k6.io/docs/get-started/installation/ (choco install k6 บน Windows)
//
// จำลองคนแห่เข้าคิวพร้อมกัน → วัดว่าระบบรับโหลดได้ + latency ยอมรับได้
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

// custom metrics สำหรับ thesis
const joinLatency = new Trend("queue_join_latency");
const joinSuccess = new Rate("queue_join_success");

export const options = {
  scenarios: {
    // ramp-up: เพิ่มคนเรื่อย ๆ จำลองคนแห่เข้าตอนเปิดขาย
    rush: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 100 }, // ค่อย ๆ เพิ่มเป็น 100 คน
        { duration: "20s", target: 500 }, // พุ่งเป็น 500 คนพร้อมกัน
        { duration: "10s", target: 0 }, // ลดลง
      ],
    },
  },
  thresholds: {
    // เกณฑ์ผ่าน (สำหรับ thesis): p95 latency < 2s, success > 95%
    queue_join_latency: ["p(95)<2000"],
    queue_join_success: ["rate>0.95"],
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const CONCERT_ID = __ENV.CONCERT_ID || "1";

export default function () {
  // จำลอง browser จริง (มี UA + headers + fingerprint + turnstile)
  const headers = {
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    Accept: "text/html",
    "Accept-Language": "th-TH",
  };
  const body = JSON.stringify({
    concertId: CONCERT_ID,
    fingerprintHash: `load-${__VU}-${__ITER}`,
    turnstileToken: "load-test-dummy",
  });

  // 1. เข้าคิว
  const res = http.post(`${BASE}/api/queue/join`, body, { headers });
  joinLatency.add(res.timings.duration);
  joinSuccess.add(res.status === 200);

  const ok = check(res, {
    "join สำเร็จ (200)": (r) => r.status === 200,
    "ได้ token": (r) => r.json("token") !== undefined,
  });

  // 2. ถ้าได้ token → poll สถานะ 1 ครั้ง
  if (ok && res.status === 200) {
    const token = res.json("token");
    sleep(1);
    const statusRes = http.get(`${BASE}/api/queue/status?token=${token}`);
    check(statusRes, {
      "status ตอบกลับ (200)": (r) => r.status === 200,
    });
  }

  sleep(Math.random() * 2); // คนจริงไม่ยิงรัว
}
