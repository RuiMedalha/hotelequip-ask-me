import { useState, useEffect, useRef } from "react";
import { ChatHeader } from "./ChatHeader";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase, FUNCTIONS_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from "@/integrations/supabase/client";

interface Message { id: string; text: string; isUser: boolean; timestamp: Date; }

function getVisitorId() {
  let v = localStorage.getItem("he_visitor_id");
  if (!v) { v = crypto.randomUUID(); localStorage.setItem("he_visitor_id", v); }
  return v;
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
  };
}

export const Chatbot = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(
    () => localStorage.getItem("he_conversation_id")
  );
  const [isTyping, setIsTyping] = useState(false);
  const [welcome, setWelcome] = useState("Olá! 👋 Sou o assistente da HotelEquip. Como posso ajudar?");
  const [humanMode, setHumanMode] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (conversationId) localStorage.setItem("he_conversation_id", conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (isSupabaseConfigured) {
      supabase.from("bot_settings").select("value").eq("key", "welcome_message").maybeSingle()
        .then(({ data }) => { if (data?.value) setWelcome(String(data.value)); });
    }
  }, []);

  // Restaurar conversa anterior
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
          for (const m of data) seenIdsRef.current.add(m.id);
          setMessages(data.map((m: any) => ({
            id: m.id, text: m.content, isUser: m.role === "user", timestamp: new Date(m.created_at),
          })));
          setHistory(data.map((m: any) => ({ role: m.role, content: m.content })));
        } else {
          setMessages([{ id: "welcome", text: welcome, isUser: false, timestamp: new Date() }]);
        }
        // detect human mode
        const { data: conv } = await supabase
          .from("conversations").select("mode").eq("id", conversationId).maybeSingle();
        if (!cancelled && (conv as any)?.mode === "human") setHumanMode(true);
      } else {
        setMessages([{ id: "welcome", text: welcome, isUser: false, timestamp: new Date() }]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcome]);

  useEffect(() => {
    const el = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (el) (el as HTMLElement).scrollTop = el.scrollHeight;
  }, [messages, isTyping]);

  // Polling no modo humano
  useEffect(() => {
    if (!humanMode || !conversationId) return;
    let active = true;
    const poll = async () => {
      try {
        const r = await fetch(`${FUNCTIONS_URL}/chatwoot-relay`, {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ conversation_id: conversationId, action: "poll" }),
        });
        const data = await r.json();
        if (!active || !data?.new_messages?.length) return;
        setMessages(prev => {
          const add = data.new_messages
            .filter((m: any) => !seenIdsRef.current.has(`cw-${m.id}`))
            .map((m: any) => {
              seenIdsRef.current.add(`cw-${m.id}`);
              return { id: `cw-${m.id}`, text: m.content, isUser: false, timestamp: new Date(m.created_at) };
            });
          return add.length ? [...prev, ...add] : prev;
        });
      } catch (e) { console.error("poll fail", e); }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => { active = false; clearInterval(t); };
  }, [humanMode, conversationId]);

  const handleSendMessage = async (text: string) => {
    const userMsg: Message = { id: Date.now().toString(), text, isUser: true, timestamp: new Date() };
    setMessages(p => [...p, userMsg]);
    setIsTyping(true);

    try {
      if (!isSupabaseConfigured) throw new Error("Supabase não configurado.");

      if (humanMode) {
        const r = await fetch(`${FUNCTIONS_URL}/chatwoot-relay`, {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ conversation_id: conversationId, action: "send", content: text }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Erro ao enviar para agente");
        setIsTyping(false);
        return;
      }

      const newHistory = [...history, { role: "user" as const, content: text }];
      setHistory(newHistory);
      const r = await fetch(`${FUNCTIONS_URL}/chat`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ messages: newHistory, visitor_id: getVisitorId(), conversation_id: conversationId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Erro");
      if (data.conversation_id) setConversationId(data.conversation_id);
      const reply = data.reply || "(sem resposta)";
      setHistory(h => [...h, { role: "assistant", content: reply }]);
      setMessages(p => [...p, { id: Date.now().toString() + "b", text: reply, isUser: false, timestamp: new Date() }]);

      // verificar se entrou em modo humano
      const convId = data.conversation_id || conversationId;
      if (convId) {
        const { data: conv } = await supabase
          .from("conversations").select("mode").eq("id", convId).maybeSingle();
        if ((conv as any)?.mode === "human") setHumanMode(true);
      }
    } catch (e: any) {
      setMessages(p => [...p, { id: Date.now().toString() + "e", text: `⚠️ ${e.message}`, isUser: false, timestamp: new Date() }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-full bg-background">
      <ChatHeader />
      {humanMode && (
        <div className="px-4 py-2 border-b bg-muted/40 flex items-center gap-2">
          <Badge variant="default" className="bg-green-600 hover:bg-green-700">🟢 Agente humano</Badge>
          <span className="text-xs text-muted-foreground">Estás a falar com a equipa HotelEquip.</span>
        </div>
      )}
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
