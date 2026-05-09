import { useState, useEffect, useRef } from "react";
import { ChatHeader } from "./ChatHeader";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, FUNCTIONS_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from "@/integrations/supabase/client";

type UiAction =
  | { type: "request_input"; input_type: "email" | "phone"; message: string }
  | { type: "quick_replies"; message: string; options: { label: string; value: string }[] };

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  ui?: UiAction;
  consumed?: boolean;
}

const INTENT_OPTIONS: { label: string; value: string }[] = [
  { label: "🛒 Produtos & Preços", value: "produtos" },
  { label: "🔧 Questões Técnicas", value: "tecnico" },
  { label: "🏪 Informações da Loja", value: "loja" },
  { label: "📦 Encomenda / Entrega", value: "entrega" },
  { label: "✍️ Outro assunto...", value: "outro" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function isValidPtPhone(raw: string): boolean {
  const digits = raw.replace(/\s|-/g, "");
  // +351 9XXXXXXXX or international like +44...
  if (/^\+351\d{9}$/.test(digits)) return true;
  if (/^\+\d{8,15}$/.test(digits)) return true;
  return false;
}

const EmailCard = ({ message, onSubmit }: { message: string; onSubmit: (v: string) => void }) => {
  const [v, setV] = useState("");
  const valid = EMAIL_RE.test(v.trim());
  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <p className="text-sm">{message}</p>
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="nome@empresa.pt"
          value={v}
          onChange={(e) => setV(e.target.value)}
          maxLength={255}
        />
        <Button size="sm" disabled={!valid} onClick={() => onSubmit(v.trim())}>
          Confirmar
        </Button>
      </div>
    </div>
  );
};

const PhoneCard = ({ message, onSubmit }: { message: string; onSubmit: (v: string) => void }) => {
  const [prefix, setPrefix] = useState("+351");
  const [num, setNum] = useState("");
  const full = `${prefix}${num.replace(/\s|-/g, "")}`;
  const valid = isValidPtPhone(full);
  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <p className="text-sm">{message}</p>
      <div className="flex gap-2">
        <Input
          className="w-20"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          maxLength={5}
        />
        <Input
          inputMode="tel"
          placeholder="912 345 678"
          value={num}
          onChange={(e) => setNum(e.target.value.replace(/[^\d\s-]/g, ""))}
          maxLength={20}
        />
        <Button size="sm" disabled={!valid} onClick={() => onSubmit(full)}>
          Confirmar
        </Button>
      </div>
    </div>
  );
};

const QuickReplies = ({
  message,
  options,
  onPick,
}: {
  message: string;
  options: { label: string; value: string }[];
  onPick: (label: string, value: string) => void;
}) => (
  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
    <p className="text-sm">{message}</p>
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button key={o.value} size="sm" variant="outline" onClick={() => onPick(o.label, o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  </div>
);

export const Chatbot = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(
    () => localStorage.getItem("he_conversation_id")
  );
  const [isTyping, setIsTyping] = useState(false);
  const [welcome, setWelcome] = useState("Olá! 👋 Sou o assistente da HotelEquip. Como posso ajudar?");
  const [humanMode, setHumanMode] = useState(false);
  const [showIntentMenu, setShowIntentMenu] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("he_tts_enabled") === "1";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("he_tts_enabled", ttsEnabled ? "1" : "0");
    }
    if (!ttsEnabled && ttsSupported) {
      try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    }
  }, [ttsEnabled, ttsSupported]);

  const pickPtVoice = (): SpeechSynthesisVoice | null => {
    if (!ttsSupported) return null;
    const voices = window.speechSynthesis.getVoices();
    const pt = voices.filter(v => v.lang?.toLowerCase().startsWith("pt"));
    if (pt.length === 0) return null;
    const female = pt.find(v => /female|mulher|joana|luciana|catarina|ines/i.test(v.name));
    const ptPt = pt.find(v => v.lang?.toLowerCase() === "pt-pt");
    return female || ptPt || pt[0];
  };

  const cleanForSpeech = (s: string) =>
    s.replace(/!\[.*?\]\(.*?\)/g, "")
     .replace(/\[(.*?)\]\(.*?\)/g, "$1")
     .replace(/[#*`]/g, "")
     .replace(/:[a-z_]+:/g, "")
     .trim();

  const speak = (text: string) => {
    if (!ttsSupported || !ttsEnabled) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = "pt-PT";
      const v = pickPtVoice();
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch { /* noop */ }
  };

  // Pre-load voices (some browsers populate async)
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => window.speechSynthesis.getVoices();
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { try { window.speechSynthesis.onvoiceschanged = null as any; } catch { /* noop */ } };
  }, [ttsSupported]);

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
          setShowIntentMenu(false);
        } else {
          setMessages([{ id: "welcome", text: welcome, isUser: false, timestamp: new Date() }]);
          setShowIntentMenu(true);
        }
        const { data: conv } = await supabase
          .from("conversations").select("mode").eq("id", conversationId).maybeSingle();
        if (!cancelled && (conv as any)?.mode === "human") setHumanMode(true);
      } else {
        setMessages([{ id: "welcome", text: welcome, isUser: false, timestamp: new Date() }]);
        setShowIntentMenu(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcome]);

  useEffect(() => {
    const el = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (el) (el as HTMLElement).scrollTop = el.scrollHeight;
  }, [messages, isTyping, showIntentMenu]);

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

  const sendToBackend = async (text: string, intentOverride?: string) => {
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
        return;
      }

      const newHistory = [...history, { role: "user" as const, content: text }];
      setHistory(newHistory);
      const intent = intentOverride ?? pendingIntent;
      const body: any = {
        messages: newHistory,
        visitor_id: getVisitorId(),
        conversation_id: conversationId,
      };
      if (intent) body.intent = intent;
      const r = await fetch(`${FUNCTIONS_URL}/chat`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Erro");
      if (intent) setPendingIntent(null);
      if (data.conversation_id) setConversationId(data.conversation_id);
      const reply = data.reply || "(sem resposta)";
      setHistory(h => [...h, { role: "assistant", content: reply }]);

      const baseId = Date.now().toString();
      const newMsgs: Message[] = [
        { id: baseId + "b", text: reply, isUser: false, timestamp: new Date() },
      ];
      const actions: UiAction[] = Array.isArray(data.ui_actions) ? data.ui_actions : [];
      actions.forEach((ui, i) => {
        newMsgs.push({
          id: `${baseId}-ui-${i}`,
          text: "",
          isUser: false,
          timestamp: new Date(),
          ui,
        });
      });
      setMessages(p => [...p, ...newMsgs]);
      speak(reply);
      if (data.mode === "human") setHumanMode(true);
    } catch (e: any) {
      setMessages(p => [...p, {
        id: Date.now().toString() + "e",
        text: `⚠️ ${e.message}`,
        isUser: false,
        timestamp: new Date(),
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const pushUserMessage = (text: string) => {
    setMessages(p => [...p, {
      id: Date.now().toString(),
      text,
      isUser: true,
      timestamp: new Date(),
    }]);
  };

  const handleSendMessage = async (text: string) => {
    setShowIntentMenu(false);
    pushUserMessage(text);
    await sendToBackend(text);
  };

  const handleIntentPick = async (label: string, value: string) => {
    setShowIntentMenu(false);
    setPendingIntent(value);
    if (value === "outro") {
      // só fecha o menu, deixa o utilizador escrever
      return;
    }
    pushUserMessage(label);
    await sendToBackend(label, value);
  };

  const consumeUi = (id: string) => {
    setMessages(p => p.map(m => m.id === id ? { ...m, consumed: true } : m));
  };

  const handleUiSubmit = async (id: string, value: string) => {
    consumeUi(id);
    pushUserMessage(value);
    await sendToBackend(value);
  };

  const handleQuickReply = async (id: string, label: string, value: string) => {
    consumeUi(id);
    pushUserMessage(label);
    await sendToBackend(value);
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
          {messages.map(m => {
            if (m.ui && !m.consumed) {
              if (m.ui.type === "request_input" && m.ui.input_type === "email") {
                return <EmailCard key={m.id} message={m.ui.message} onSubmit={(v) => handleUiSubmit(m.id, v)} />;
              }
              if (m.ui.type === "request_input" && m.ui.input_type === "phone") {
                return <PhoneCard key={m.id} message={m.ui.message} onSubmit={(v) => handleUiSubmit(m.id, v)} />;
              }
              if (m.ui.type === "quick_replies") {
                return (
                  <QuickReplies
                    key={m.id}
                    message={m.ui.message}
                    options={m.ui.options}
                    onPick={(label, value) => handleQuickReply(m.id, label, value)}
                  />
                );
              }
            }
            if (!m.text) return null;
            return <ChatMessage key={m.id} message={m.text} isUser={m.isUser} timestamp={m.timestamp} />;
          })}

          {showIntentMenu && !humanMode && (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
              <p className="text-sm font-medium">No que posso ajudar hoje?</p>
              <div className="flex flex-col gap-2">
                {INTENT_OPTIONS.map((o) => (
                  <Button
                    key={o.value}
                    variant="outline"
                    className="justify-start"
                    onClick={() => handleIntentPick(o.label, o.value)}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                💬 Para falar com alguém da equipa diz apenas <strong>humano</strong>
              </p>
            </div>
          )}

          {isTyping && <TypingIndicator />}
        </div>
      </ScrollArea>
      <ChatInput onSendMessage={handleSendMessage} disabled={isTyping} />
    </div>
  );
};
