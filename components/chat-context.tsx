"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface ChatContextValue {
  pageContext: string | null;
  setPageContext: (ctx: string | null) => void;
}

const ChatCtx = createContext<ChatContextValue>({
  pageContext: null,
  setPageContext: () => {},
});

export function ChatContextProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContext] = useState<string | null>(null);
  return (
    <ChatCtx.Provider value={{ pageContext, setPageContext }}>{children}</ChatCtx.Provider>
  );
}

export function useChatContext() {
  return useContext(ChatCtx);
}

// ใช้ใน Server Component pages เพื่อส่งข้อมูลหน้าให้ ChatWidget
// เช่น: <SetChatContext context={`คอนเสิร์ต: ${concert.title}...`} />
export function SetChatContext({ context }: { context: string }) {
  const { setPageContext } = useChatContext();
  useEffect(() => {
    setPageContext(context);
    return () => setPageContext(null);
  }, [context, setPageContext]);
  return null;
}
