"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { MessageCircle, X, Send, Bot, Loader2 } from "lucide-react";

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

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "model", text: "สวัสดีครับ! มีอะไรให้ช่วยเรื่องการจองบัตรคอนเสิร์ตไหม?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // แปลง history เป็น format ที่ Gemini API ต้องการ (ไม่รวม welcome message แรก)
    const history: GeminiHistoryItem[] = messages
      .slice(1)
      .map((m) => ({ role: m.role, parts: [{ text: m.text }] }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
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

  return (
    <>
      {/* Bubble toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "ปิดแชท" : "เปิดแชทกับผู้ช่วย"}
        className="fixed bottom-6 right-6 z-50 flex size-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-glow-brand transition-transform duration-200 hover:bg-brand-500 active:scale-95"
      >
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex w-80 flex-col overflow-hidden rounded-2xl border border-fg/10 bg-ink-850 shadow-lg sm:w-96">
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-fg/10 bg-ink-900 px-4 py-3">
            <Bot className="size-5 text-brand-400" aria-hidden />
            <span className="font-display text-sm font-semibold text-fg">ผู้ช่วย AI</span>
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-success">
              <span className="size-1.5 rounded-full bg-success animate-pulse" />
              ออนไลน์
            </span>
          </div>

          {/* Messages */}
          <div className="flex h-72 flex-col gap-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                {m.role === "model" && (
                  <Bot className="mt-0.5 size-4 shrink-0 text-brand-400" aria-hidden />
                )}
                <p
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
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
                  กำลังพิมพ์…
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={handleSend}
            className="flex items-center gap-2 border-t border-fg/10 bg-ink-900 px-3 py-2.5"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="พิมพ์ข้อความ…"
              disabled={loading}
              maxLength={500}
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
        </div>
      )}
    </>
  );
}
