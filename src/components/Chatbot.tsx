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
  | { type: "quick_replies"; message: string; options: { label: string; value: string }[] }
  | { type: "whatsapp_handoff"; link: string };

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

const WhatsAppHandoffCard = ({ link }: { link: string }) => (
  <div className="rounded-lg border bg-[#25D366]/10 border-[#25D366]/40 p-4 space-y-3">
    <p className="text-sm font-medium">📱 A nossa equipa já foi notificada.</p>
    <p className="text-sm text-muted-foreground">Clica para continuar a conversa por WhatsApp:</p>
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#25D366] text-white font-medium hover:bg-[#1ebe57] transition-colors no-underline shadow-sm"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
        <path d="M20.52 3.48A11.86 11.86 0 0 0 12.04 0C5.5 0 .2 5.3.2 11.84c0 2.09.55 4.13 1.59 5.93L0 24l6.4-1.68a11.83 11.83 0 0 0 5.64 1.44h.01c6.54 0 11.84-5.3 11.84-11.84 0-3.16-1.23-6.13-3.37-8.44ZM12.05 21.5h-.01a9.6 9.6 0 0 1-4.9-1.34l-.35-.21-3.8 1 1.02-3.7-.23-.38a9.6 9.6 0 0 1-1.47-5.05c0-5.31 4.32-9.63 9.64-9.63 2.57 0 4.99 1 6.81 2.82a9.56 9.56 0 0 1 2.82 6.82c0 5.31-4.32 9.67-9.53 9.67Zm5.55-7.22c-.3-.15-1.8-.89-2.08-.99-.28-.1-.48-.15-.69.15-.2.3-.79.99-.97 1.19-.18.2-.36.22-.66.07-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.5-1.78-1.68-2.08-.18-.3-.02-.46.13-.61.13-.13.3-.36.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.07-.15-.69-1.66-.94-2.27-.25-.6-.5-.52-.69-.53l-.59-.01c-.2 0-.53.07-.81.38-.28.3-1.06 1.04-1.06 2.54s1.09 2.95 1.24 3.15c.15.2 2.15 3.28 5.21 4.6.73.31 1.3.5 1.74.64.73.23 1.4.2 1.92.12.59-.09 1.8-.74 2.06-1.45.25-.71.25-1.31.18-1.45-.07-.13-.27-.2-.57-.35Z"/>
      </svg>
      Abrir WhatsApp →
    </a>
    <p className="text-xs text-muted-foreground">A equipa responde em breve.</p>
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
  const [chatwootLive, setChatwootLive] = useState(false);
  const [showIntentMenu, setShowIntentMenu] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const ttsUnlockedRef = useRef(false);
  const isIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);

  const unlockTts = () => {
    if (ttsUnlockedRef.current || !ttsSupported) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      u.onend = () => { ttsUnlockedRef.current = true; };
      window.speechSynthesis.speak(u);
    } catch { /* noop */ }
  };

  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("he_tts_enabled") === "1";
  });
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("he_tts_enabled", ttsEnabled ? "1" : "0");
    }
    if (!ttsEnabled && ttsSupported) {
      try { window.speechSynthesis.cancel(); } catch { /* noop */ }
      setSpeaking(false);
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

  const buildUtterance = (text: string) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-PT";
    const v = pickPtVoice();
    if (v) u.voice = v;
    u.onstart = () => setSpeaking(true);
    u.onend = () => {
      if (!window.speechSynthesis.pending && !window.speechSynthesis.speaking) {
        setSpeaking(false);
      }
    };
    u.onerror = () => setSpeaking(false);
    return u;
  };

  // Replace current speech (used for non-stream full reply)
  const speak = (text: string) => {
    if (!ttsSupported || !ttsEnabled) return;
    if (isIOS && !ttsUnlockedRef.current) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(buildUtterance(clean));
    } catch { /* noop */ }
  };

  // Queue speech (used for streaming, sentence-by-sentence)
  const enqueueSpeech = (text: string) => {
    if (!ttsSupported || !ttsEnabled) return;
    if (isIOS && !ttsUnlockedRef.current) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    try {
      window.speechSynthesis.speak(buildUtterance(clean));
    } catch { /* noop */ }
  };

  // Barge-in: stop TTS the moment the user starts dictating
  const handleMicStart = () => {
    if (ttsSupported) {
      try { window.speechSynthesis.cancel(); } catch { /* noop */ }
      setSpeaking(false);
    }
  };

  // Pre-load voices + cleanup TTS on unmount
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => window.speechSynthesis.getVoices();
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      try {
        window.speechSynthesis.onvoiceschanged = null as any;
        window.speechSynthesis.cancel();
      } catch { /* noop */ }
    };
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
          .from("conversations").select("mode, chatwoot_pubsub_token").eq("id", conversationId).maybeSingle();
        if (!cancelled && (conv as any)?.mode === "human") {
          setHumanMode(true);
          setChatwootLive(!!(conv as any)?.chatwoot_pubsub_token);
        }
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
        stream: true,
      };
      if (intent) body.intent = intent;
      const r = await fetch(`${FUNCTIONS_URL}/chat`, {
        method: "POST",
        headers: { ...(await authHeaders()), Accept: "text/event-stream" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        let msg = "Erro";
        try { const j = await r.json(); msg = j.error || msg; } catch { /* noop */ }
        throw new Error(msg);
      }
      if (intent) setPendingIntent(null);

      const ctype = r.headers.get("content-type") || "";
      const isStream = ctype.includes("text/event-stream") && !!r.body;

      const baseId = Date.now().toString();
      const botMsgId = baseId + "b";

      if (isStream) {
        // Create empty bot message we'll progressively fill
        setMessages(p => [...p, { id: botMsgId, text: "", isUser: false, timestamp: new Date() }]);
        setIsTyping(false);

        const reader = r.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        let spokenUpTo = 0; // index up to which we've already spoken
        let finalPayload: any = null;

        const flushSentences = (final = false) => {
          if (!ttsEnabled || !ttsSupported) return;
          const pending = fullText.slice(spokenUpTo);
          if (!pending) return;
          // Find last sentence terminator
          const re = /[.!?…]+[\s)"']*/g;
          let lastEnd = -1;
          let m: RegExpExecArray | null;
          while ((m = re.exec(pending)) !== null) lastEnd = m.index + m[0].length;
          if (lastEnd > 0) {
            const chunk = pending.slice(0, lastEnd).trim();
            if (chunk) enqueueSpeech(chunk);
            spokenUpTo += lastEnd;
          } else if (final) {
            const chunk = pending.trim();
            if (chunk) enqueueSpeech(chunk);
            spokenUpTo = fullText.length;
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";
          for (const ev of events) {
            const line = ev.split("\n").find(l => l.startsWith("data:"));
            if (!line) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const obj = JSON.parse(payload);
              if (obj.token) {
                fullText += obj.token;
                setMessages(p => p.map(m => m.id === botMsgId ? { ...m, text: fullText } : m));
                flushSentences(false);
              }
              if (obj.done) finalPayload = obj;
              if (obj.error) throw new Error(obj.error);
            } catch (err) {
              // ignore malformed event
            }
          }
        }
        flushSentences(true);

        const reply = fullText || "(sem resposta)";
        setHistory(h => [...h, { role: "assistant", content: reply }]);

        if (finalPayload?.conversation_id) setConversationId(finalPayload.conversation_id);
        const actions: UiAction[] = Array.isArray(finalPayload?.ui_actions) ? finalPayload.ui_actions : [];
        if (actions.length) {
          setMessages(p => [
            ...p,
            ...actions.map((ui, i) => ({
              id: `${baseId}-ui-${i}`,
              text: "",
              isUser: false,
              timestamp: new Date(),
              ui,
            })),
          ]);
        }
        if (finalPayload?.mode === "human") setHumanMode(true);
        if (finalPayload?.channel === "whatsapp" && finalPayload?.whatsapp_link) {
          setMessages(p => [...p, {
            id: `${baseId}-wa`,
            text: "",
            isUser: false,
            timestamp: new Date(),
            ui: { type: "whatsapp_handoff", link: finalPayload.whatsapp_link },
          }]);
        }
      } else {
        // Fallback: classic JSON response
        const data = await r.json();
        if (data.conversation_id) setConversationId(data.conversation_id);
        const reply = data.reply as string | null;
        if (reply) {
          setHistory(h => [...h, { role: "assistant", content: reply }]);
        }
        const newMsgs: Message[] = [];
        if (reply) {
          newMsgs.push({ id: botMsgId, text: reply, isUser: false, timestamp: new Date() });
        }
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
        if (data.channel === "whatsapp" && data.whatsapp_link) {
          newMsgs.push({
            id: `${baseId}-wa`,
            text: "",
            isUser: false,
            timestamp: new Date(),
            ui: { type: "whatsapp_handoff", link: data.whatsapp_link },
          });
        }
        setMessages(p => [...p, ...newMsgs]);
        if (reply) speak(reply);
        if (data.mode === "human") setHumanMode(true);
      }
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
    unlockTts();
    setShowIntentMenu(false);
    pushUserMessage(text);
    await sendToBackend(text);
  };

  const handleIntentPick = async (label: string, value: string) => {
    unlockTts();
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
    unlockTts();
    consumeUi(id);
    pushUserMessage(value);
    await sendToBackend(value);
  };

  const handleQuickReply = async (id: string, label: string, value: string) => {
    unlockTts();
    consumeUi(id);
    pushUserMessage(label);
    await sendToBackend(value);
  };

  const hasPendingInput = messages.some(
    m => m.ui && !m.consumed && m.ui.type === "request_input"
  );

  return (
    <div className="flex flex-col h-full max-w-full bg-background">
      <ChatHeader
        ttsSupported={ttsSupported}
        ttsEnabled={ttsEnabled}
        speaking={speaking}
        onToggleTts={() => setTtsEnabled(v => !v)}
      />
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
              if (m.ui.type === "whatsapp_handoff") {
                return <WhatsAppHandoffCard key={m.id} link={m.ui.link} />;
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
      <ChatInput
        onSendMessage={handleSendMessage}
        onMicStart={handleMicStart}
        disabled={isTyping || humanMode || hasPendingInput}
        pendingInput={hasPendingInput}
      />
    </div>
  );
};
