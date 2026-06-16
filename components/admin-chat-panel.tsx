"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { Bot, Send, Loader2, ChevronDown, ChevronUp } from "lucide-react";

interface Message {
  role: "user" | "model";
  text: string;
}

interface GeminiPart {
  text: string;
}

interface GeminiHistoryItem {
  role: "user" | "model";
  parts: GeminiPart[];
}

const QUICK_PROMPTS = [
  "Bot score ต่ำกว่า 0.3 หมายความว่าอะไร?",
  "อธิบาย fairness queue ให้ฟัง",
  "วิธีเพิ่ม CAPTCHA threshold",
];

export function AdminChatPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "model",
      text: "สวัสดีครับ ผมคือผู้ช่วย AI สำหรับ admin ถามได้เลยเรื่อง bot log, ยอดขาย, หรือการตั้งค่าระบบ",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, collapsed]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: "user", text: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    const history: GeminiHistoryItem[] = messages
      .slice(1)
      .map((m) => ({ role: m.role, parts: [{ text: m.text }] }));

    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim(), history }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "model", text: data.reply ?? data.error ?? "เกิดข้อผิดพลาด" },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "model", text: "ไม่สามารถเชื่อมต่อได้ กรุณาลองใหม่" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="rounded-xl border border-fg/10 bg-ink-850 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2.5 px-5 py-3.5 hover:bg-ink-800 transition-colors"
      >
        <Bot className="size-4 text-brand-400" aria-hidden />
        <span className="font-display text-sm font-semibold text-fg">ผู้ช่วย AI (Gemini)</span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-success">
          <span className="size-1.5 rounded-full bg-success animate-pulse" />
          ออนไลน์
        </span>
        {collapsed ? (
          <ChevronDown className="ml-2 size-4 text-fg-faint" />
        ) : (
          <ChevronUp className="ml-2 size-4 text-fg-faint" />
        )}
      </button>

      {!collapsed && (
        <>
          {/* Messages */}
          <div className="flex h-64 flex-col gap-3 overflow-y-auto border-t border-fg/10 p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                {m.role === "model" && (
                  <Bot className="mt-0.5 size-4 shrink-0 text-brand-400" aria-hidden />
                )}
                <p
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-brand-600 text-white"
                      : "bg-ink-800 text-fg-dim"
                  }`}
                >
                  {m.text}
                </p>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2">
                <Bot className="mt-0.5 size-4 shrink-0 text-brand-400" aria-hidden />
                <span className="rounded-xl bg-ink-800 px-3 py-2 text-sm text-fg-faint">
                  <Loader2 className="size-3.5 animate-spin inline mr-1" />
                  กำลังคิด…
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick prompts */}
          <div className="flex flex-wrap gap-1.5 border-t border-fg/10 px-4 py-2">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => send(p)}
                disabled={loading}
                className="rounded-full border border-fg/15 bg-ink-800 px-2.5 py-1 text-xs text-fg-dim hover:border-brand-500/50 hover:text-fg transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                {p}
              </button>
            ))}
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t border-fg/10 px-3 py-2.5"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ถามอะไรก็ได้เกี่ยวกับระบบ…"
              disabled={loading}
              maxLength={2000}
              className="min-w-0 flex-1 rounded-lg bg-ink-800 px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              aria-label="ส่งข้อความ"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-500 disabled:opacity-40 disabled:pointer-events-none"
            >
              <Send className="size-4" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
