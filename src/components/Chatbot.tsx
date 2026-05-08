import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { ChatHeader } from "./ChatHeader";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase, FUNCTIONS_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from "@/integrations/supabase/client";

interface Message { id: string; text: string; isUser: boolean; timestamp: Date; }

function getVisitorId() {
  let v = localStorage.getItem("he_visitor_id");
  if (!v) { v = crypto.randomUUID(); localStorage.setItem("he_visitor_id", v); }
  return v;
}

export const Chatbot = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(
    () => localStorage.getItem("he_conversation_id")
  );
  const [isTyping, setIsTyping] = useState(false);
  const [welcome, setWelcome] = useState("Olá! 👋 Sou o assistente da HotelEquip. Como posso ajudar?");
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conversationId) localStorage.setItem("he_conversation_id", conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (isSupabaseConfigured) {
      supabase.from("bot_settings").select("value").eq("key", "welcome_message").maybeSingle()
        .then(({ data }) => { if (data?.value) setWelcome(String(data.value)); });
    }
  }, []);

  // Restaurar conversa anterior se existir, senão mostrar welcome
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isSupabaseConfigured && conversationId) {
        const { data } = await supabase
          .from("messages")
          .select("id,role,content,created_at")
          .eq("conversation_id", conversationId)
          .order("created_at");
        if (cancelled) return;
        if (data && data.length > 0) {
          setMessages(data.map((m: any) => ({
            id: m.id,
            text: m.content,
            isUser: m.role === "user",
            timestamp: new Date(m.created_at),
          })));
          setHistory(data.map((m: any) => ({ role: m.role, content: m.content })));
          return;
        }
      }
      setMessages([{ id: "welcome", text: welcome, isUser: false, timestamp: new Date() }]);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcome]);

  useEffect(() => {
    const el = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (el) (el as HTMLElement).scrollTop = el.scrollHeight;
  }, [messages, isTyping]);

  const handleSendMessage = async (text: string) => {
    const userMsg: Message = { id: Date.now().toString(), text, isUser: true, timestamp: new Date() };
    setMessages(p => [...p, userMsg]);
    const newHistory = [...history, { role: "user" as const, content: text }];
    setHistory(newHistory);
    setIsTyping(true);

    try {
      if (!isSupabaseConfigured) throw new Error("Supabase não configurado. Vai a /admin/login para ligar.");
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${FUNCTIONS_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ messages: newHistory, visitor_id: getVisitorId(), conversation_id: conversationId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Erro");
      if (data.conversation_id) setConversationId(data.conversation_id);
      const reply = data.reply || "(sem resposta)";
      setHistory(h => [...h, { role: "assistant", content: reply }]);
      setMessages(p => [...p, { id: Date.now().toString() + "b", text: reply, isUser: false, timestamp: new Date() }]);
    } catch (e: any) {
      setMessages(p => [...p, { id: Date.now().toString() + "e", text: `⚠️ ${e.message}`, isUser: false, timestamp: new Date() }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-full bg-background">
      <ChatHeader />
      <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map(m => (
            <ChatMessage key={m.id} message={m.text} isUser={m.isUser} timestamp={m.timestamp} />
          ))}
          {isTyping && <TypingIndicator />}
        </div>
      </ScrollArea>
      <ChatInput onSendMessage={handleSendMessage} disabled={isTyping} />
    </div>
  );
};
