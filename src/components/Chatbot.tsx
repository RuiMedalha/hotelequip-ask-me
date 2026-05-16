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
import { isDirectusConfigured } from "@/integrations/directus/client";
import { getConversation, getConversationMessages } from "@/integrations/directus/conversations";
import {
  ensureDirectusConversationWithMeta,
  saveUserMessage,
  saveAiMessage,
  requestHumanHandoff,
  syncCustomerDetailsFromUserMessage,
} from "@/services/directusChatBridge";
import { DIRECTUS_REOPEN_SYSTEM_MESSAGE } from "@/lib/directusConversationLifecycle";
import { isExplicitHumanRequest } from "@/lib/chatCustomerDetails";
import { uuid } from "@/lib/uuid";

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
  /** Aviso local (transição humano ↔ IA no Hub). */
  system?: boolean;
}

interface StoredMessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface ConversationRow {
  mode?: string | null;
  chatwoot_pubsub_token?: string | null;
}

interface ChatwootMessage {
  id: string | number;
  content: string;
  created_at: string;
}

interface ChatPayload {
  conversation_id?: string;
  reply?: string | null;
  ui_actions?: UiAction[];
  channel?: string;
  whatsapp_link?: string;
  mode?: string | null;
  token?: string;
  done?: boolean;
  error?: string;
}

const INTENT_OPTIONS: { label: string; value: string }[] = [
  { label: "🛒 Produtos & Preços", value: "produtos" },
  { label: "🔧 Questões Técnicas", value: "tecnico" },
  { label: "🏪 Informações da Loja", value: "loja" },
  { label: "📦 Encomenda / Entrega", value: "entrega" },
  { label: "✍️ Outro assunto...", value: "outro" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function logDirectusDev(...args: unknown[]) {
  if (import.meta.env.DEV) console.info(...args);
}

function warnDirectusDev(message: string, error?: unknown) {
  if (error !== undefined) console.warn(message, error);
  else console.warn(message);
}

function normalizeChatFingerprint(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function fingerprintSetFromRenderableAssistantBubbles(messages: Message[]) {
  const s = new Set<string>();
  for (const m of messages) {
    if (m.isUser || m.ui || m.system || !String(m.text || "").trim()) continue;
    s.add(normalizeChatFingerprint(m.text));
  }
  return s;
}

const DIRECTUS_SYSTEM_MSG_AI_REACTIVATED =
  "A IA foi reativada. O assistente volta a acompanhar a conversa.";

function directusHumanSystemMessage(assignedTo: string | null) {
  const who = assignedTo?.trim() || "Rui";
  return `A conversa foi assumida por ${who}. Está agora a falar com a equipa Hotelequip.`;
}

function parseDirectusAssignedTo(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const s = value.trim();
    return s || null;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const parts = [o.first_name, o.last_name].filter((p) => typeof p === "string" && p.trim());
    if (parts.length) return parts.join(" ").trim();
    if (typeof o.name === "string" && o.name.trim()) return o.name.trim();
    if (typeof o.display_name === "string" && o.display_name.trim()) return o.display_name.trim();
  }
  return null;
}

function parseDirectusAiEnabled(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

type DirectusConvSnapshot = {
  status: string;
  mode: string;
  assignedTo: string | null;
  aiEnabled: boolean | null;
};

function readDirectusConvSnapshot(conv: Record<string, unknown> | null): DirectusConvSnapshot {
  return {
    status: typeof conv?.status === "string" ? conv.status.toLowerCase().trim() : "",
    mode: typeof conv?.mode === "string" ? conv.mode.toLowerCase().trim() : "",
    assignedTo: parseDirectusAssignedTo(conv?.assigned_to),
    aiEnabled: parseDirectusAiEnabled(conv?.ai_enabled),
  };
}

/** Lane remota Hub: humano vs IA; `null` se conversa fechada ou estado indeterminado. */
function computeDirectusLane(snapshot: DirectusConvSnapshot): "human" | "bot" | null {
  const { status, mode, aiEnabled } = snapshot;
  if (status === "closed" || status === "resolved") return null;
  if (status === "human_active" || mode === "human" || aiEnabled === false) return "human";
  if (status === "ai_active" || mode === "bot" || aiEnabled === true) return "bot";
  return null;
}

function resolveDirectusConversationLane(
  conv: Record<string, unknown> | null,
): "human" | "bot" | "unknown" {
  const lane = computeDirectusLane(readDirectusConvSnapshot(conv));
  return lane ?? "unknown";
}

function directusInboundFromAgentPerspective(row: Record<string, unknown>) {
  const senderType = typeof row.sender_type === "string" ? row.sender_type.toLowerCase().trim() : "";
  if (senderType === "customer" || senderType === "visitor") return false;
  if (senderType === "ai" || senderType === "agent" || senderType === "human") return true;
  const role = typeof row.role === "string" ? row.role.toLowerCase().trim() : "";
  if (role === "user" || role === "visitor" || role === "customer") return false;
  return Boolean(role);
}

function directusPlainText(row: Record<string, unknown>) {
  const raw = row.content ?? row.message ?? row.body ?? row.text;
  return typeof raw === "string" ? raw : "";
}

function parseDirectusInstant(row: Record<string, unknown>) {
  const raw = row.created_at ?? row.date_created ?? row.created_on ?? row.date_updated ?? row.updated_at;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s) {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return new Date();
}

function getVisitorId() {
  let v = localStorage.getItem("he_visitor_id");
  if (!v) { v = uuid(); localStorage.setItem("he_visitor_id", v); }
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
  const [directusConversationId, setDirectusConversationId] = useState<string | null>(() =>
    (typeof localStorage !== "undefined" ? localStorage.getItem("he_directus_conversation_id") : null),
  );
  const [directusHumanLane, setDirectusHumanLane] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [welcome, setWelcome] = useState("Olá! 👋 Sou o assistente da HotelEquip. Como posso ajudar?");
  const [humanMode, setHumanMode] = useState(false);
  const [chatwootLive, setChatwootLive] = useState(false);
  const [showIntentMenu, setShowIntentMenu] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seenDirectusMessageIdsRef = useRef<Set<string>>(new Set());
  const directusConversationIdRef = useRef<string | null>(directusConversationId);
  const directusHumanLaneRef = useRef(false);
  const previousStatusRef = useRef<string | null>(null);
  const previousModeRef = useRef<string | null>(null);
  const previousAssignedToRef = useRef<string | null>(null);
  const previousAiEnabledRef = useRef<boolean | null>(null);
  const previousLaneRef = useRef<"human" | "bot" | null>(null);
  const seenSystemLaneMessagesRef = useRef<Set<string>>(new Set());
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
        window.speechSynthesis.onvoiceschanged = null;
        window.speechSynthesis.cancel();
      } catch { /* noop */ }
    };
  }, [ttsSupported]);

  useEffect(() => {
    if (conversationId) localStorage.setItem("he_conversation_id", conversationId);
  }, [conversationId]);

  useEffect(() => {
    directusConversationIdRef.current = directusConversationId;
  }, [directusConversationId]);

  useEffect(() => {
    directusHumanLaneRef.current = directusHumanLane;
  }, [directusHumanLane]);

  const appendDirectusSystemMessage = (text: string) => {
    const fp = normalizeChatFingerprint(text);
    if (seenSystemLaneMessagesRef.current.has(fp)) return;
    seenSystemLaneMessagesRef.current.add(fp);
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-${uuid()}`,
        text,
        isUser: false,
        system: true,
        timestamp: new Date(),
      },
    ]);
  };

  useEffect(() => {
    if (!isDirectusConfigured) {
      if (import.meta.env.DEV) {
        warnDirectusDev(
          "[Directus] inativo — defina VITE_DIRECTUS_URL e VITE_DIRECTUS_TOKEN em .env.local e reinicie o dev server",
        );
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { conversationId: id, reopened } = await ensureDirectusConversationWithMeta(getVisitorId());
        if (cancelled) return;
        setDirectusConversationId(id);
        localStorage.setItem("he_directus_conversation_id", id);
        directusConversationIdRef.current = id;
        logDirectusDev("[Directus] conversation ready", id, reopened ? "(reopened)" : "");
        if (reopened) appendDirectusSystemMessage(DIRECTUS_REOPEN_SYSTEM_MESSAGE);
      }
      catch (e) {
        warnDirectusDev("[Directus] conversation ready failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    previousStatusRef.current = null;
    previousModeRef.current = null;
    previousAssignedToRef.current = null;
    previousAiEnabledRef.current = null;
    previousLaneRef.current = null;
  }, [directusConversationId]);

  useEffect(() => {
    if (!isDirectusConfigured || !directusConversationId) return;
    let active = true;

    const tick = async () => {
      try {
        const cid = directusConversationId;
        const [conv, rows] = await Promise.all([
          getConversation(cid),
          getConversationMessages(cid),
        ]);
        if (!active) return;

        const snapshot = readDirectusConvSnapshot(conv);
        const lane = computeDirectusLane(snapshot);
        const hubHuman = lane === "human";
        const isClosed = snapshot.status === "closed" || snapshot.status === "resolved";

        if (isClosed) {
          directusHumanLaneRef.current = false;
          setDirectusHumanLane(false);
        }
        else {
          directusHumanLaneRef.current = hubHuman;
          setDirectusHumanLane(hubHuman);
        }

        const prevStatus = previousStatusRef.current;
        if (isClosed && prevStatus && prevStatus !== "closed" && prevStatus !== "resolved") {
          logDirectusDev("[Directus] conversation closed (hub)");
        }

        const prevLane = previousLaneRef.current;
        if (prevLane !== null && lane !== null && prevLane !== lane) {
          if (lane === "human") {
            logDirectusDev("[Directus] lane changed to human");
            appendDirectusSystemMessage(directusHumanSystemMessage(snapshot.assignedTo));
          }
          else if (lane === "bot") {
            logDirectusDev("[Directus] lane changed to ai");
            appendDirectusSystemMessage(DIRECTUS_SYSTEM_MSG_AI_REACTIVATED);
          }
        }

        previousStatusRef.current = snapshot.status || null;
        previousModeRef.current = snapshot.mode || null;
        previousAssignedToRef.current = snapshot.assignedTo;
        previousAiEnabledRef.current = snapshot.aiEnabled;
        if (lane !== null) previousLaneRef.current = lane;

        setMessages((prev) => {
          const knownFp = fingerprintSetFromRenderableAssistantBubbles(prev);
          const nextAdds: Message[] = [];

          const sortedRows = [...rows].sort(
            (a, b) => parseDirectusInstant(a).getTime() - parseDirectusInstant(b).getTime(),
          );

          for (const row of sortedRows) {
            const rawId = row.id;
            const did =
              typeof rawId === "string"
                ? rawId
                : typeof rawId === "number"
                  ? String(rawId)
                  : null;
            if (!did || !directusInboundFromAgentPerspective(row)) continue;
            const dk = `d-${did}`;
            if (seenDirectusMessageIdsRef.current.has(dk)) continue;

            const textRaw = directusPlainText(row);
            const textTrim = textRaw.trim();
            if (!textTrim) continue;

            const fp = normalizeChatFingerprint(textRaw);
            if (knownFp.has(fp)) continue;

            seenDirectusMessageIdsRef.current.add(dk);
            knownFp.add(fp);
            nextAdds.push({
              id: dk,
              text: textTrim,
              isUser: false,
              timestamp: parseDirectusInstant(row),
            });
          }
          return nextAdds.length ? [...prev, ...nextAdds] : prev;
        });
      }
      catch (e) {
        console.warn("[directus] polling", e);
      }
    };

    void tick();
    const interval = window.setInterval(tick, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [directusConversationId]);

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
          const rows = data as StoredMessageRow[];
          for (const m of rows) seenIdsRef.current.add(m.id);
          setMessages(rows.map((m) => ({
            id: m.id, text: m.content, isUser: m.role === "user", timestamp: new Date(m.created_at),
          })));
          setHistory(rows.map((m) => ({ role: m.role, content: m.content })));
          setShowIntentMenu(false);
        } else {
          setMessages([{ id: "welcome", text: welcome, isUser: false, timestamp: new Date() }]);
          setShowIntentMenu(true);
        }
        const { data: conv } = await supabase
          .from("conversations").select("mode, chatwoot_pubsub_token").eq("id", conversationId).maybeSingle();
        const row = conv as ConversationRow | null;
        if (!cancelled && row?.mode === "human") {
          setHumanMode(true);
          setChatwootLive(!!row.chatwoot_pubsub_token);
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

  useEffect(() => {
    if (!humanMode || chatwootLive || !conversationId || !isSupabaseConfigured) return;
    let active = true;
    const refresh = async () => {
      const { data } = await supabase
        .from("conversations")
        .select("chatwoot_pubsub_token")
        .eq("id", conversationId)
        .maybeSingle();
      if (active && (data as ConversationRow | null)?.chatwoot_pubsub_token) setChatwootLive(true);
    };
    refresh();
    const t = setInterval(refresh, 4000);
    return () => { active = false; clearInterval(t); };
  }, [humanMode, chatwootLive, conversationId]);

  // Polling no modo humano
  useEffect(() => {
    if (!humanMode || !chatwootLive || !conversationId) return;
    let active = true;
    const poll = async () => {
      try {
        const r = await fetch(`${FUNCTIONS_URL}/chatwoot-relay`, {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ conversation_id: conversationId, action: "poll" }),
        });
        const data = await r.json().catch(() => ({})) as { new_messages?: ChatwootMessage[] };
        if (!r.ok) return;
        if (!active || !data?.new_messages?.length) return;
        setMessages(prev => {
          const add = data.new_messages
            .filter((m) => !seenIdsRef.current.has(`cw-${m.id}`))
            .map((m) => {
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
  }, [humanMode, chatwootLive, conversationId]);

  const bindDirectusConversationId = (id: string) => {
    setDirectusConversationId(id);
    localStorage.setItem("he_directus_conversation_id", id);
    directusConversationIdRef.current = id;
    logDirectusDev("[Directus] conversation ready", id);
  };

  const ensureDirectusConversationReady = async (): Promise<string | null> => {
    if (!isDirectusConfigured) return null;
    try {
      const { conversationId: id, reopened } = await ensureDirectusConversationWithMeta(getVisitorId());
      bindDirectusConversationId(id);
      if (reopened) appendDirectusSystemMessage(DIRECTUS_REOPEN_SYSTEM_MESSAGE);
      return id;
    }
    catch (e) {
      warnDirectusDev("[Directus] conversation ready failed", e);
      return directusConversationIdRef.current;
    }
  };

  const persistOutboundUserBubble = async (displayedBubble: string) => {
    await persistDirectusUserTurn(displayedBubble);
  };

  const persistInboundAssistantBubble = async (assistantPlain: string) => {
    if (!isDirectusConfigured) return;
    const trimmed = (assistantPlain || "").trim();
    if (!trimmed || trimmed === "(sem resposta)") return;
    try {
      const conversationIdForDirectus =
        directusConversationIdRef.current ?? await ensureDirectusConversationReady();
      if (!conversationIdForDirectus) return;

      const mid = await saveAiMessage(conversationIdForDirectus, trimmed);
      if (mid) seenDirectusMessageIdsRef.current.add(`d-${mid}`);
      logDirectusDev("[Directus] ai message saved");
    }
    catch (e) {
      warnDirectusDev("[Directus] ai message save failed", e);
    }
  };

  const announceHandoffToDirectus = (channelHint?: string) => {
    if (!isDirectusConfigured) return;
    void (async () => {
      try {
        const dId = directusConversationIdRef.current ?? await ensureDirectusConversationReady();
        if (!dId) return;
        await requestHumanHandoff(dId, undefined, undefined, channelHint);
        logDirectusDev("[Directus] handoff requested");
      }
      catch (e) {
        warnDirectusDev("[Directus] handoff request failed", e);
      }
    })();
  };

  const activateExplicitHumanHandoff = (channelHint?: string) => {
    setHumanMode(true);
    directusHumanLaneRef.current = true;
    setDirectusHumanLane(true);
    announceHandoffToDirectus(channelHint);
  };

  const applyBackendHumanHandoffIfExplicit = (userText: string, payload: ChatPayload | null) => {
    if (payload?.mode !== "human") return;
    if (!isExplicitHumanRequest(userText)) {
      logDirectusDev("[Directus] ignored backend mode=human (no explicit user request)", userText);
      return;
    }
    activateExplicitHumanHandoff(
      typeof payload.channel === "string" ? payload.channel : undefined,
    );
  };

  const syncDirectusCustomerDetails = async (conversationId: string, text: string) => {
    try {
      await syncCustomerDetailsFromUserMessage(conversationId, text);
    }
    catch (e) {
      warnDirectusDev("[Directus] customer details sync failed", e);
    }
  };

  const persistDirectusUserTurn = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !isDirectusConfigured) return;

    try {
      const { conversationId: directusId, reopened } =
        await ensureDirectusConversationWithMeta(getVisitorId());
      bindDirectusConversationId(directusId);
      if (reopened) appendDirectusSystemMessage(DIRECTUS_REOPEN_SYSTEM_MESSAGE);

      const mid = await saveUserMessage(directusId, trimmed);
      if (mid) seenDirectusMessageIdsRef.current.add(`d-${mid}`);
      logDirectusDev("[Directus] user message saved");

      await syncDirectusCustomerDetails(directusId, trimmed);

      if (isExplicitHumanRequest(trimmed)) {
        activateExplicitHumanHandoff();
      }
    }
    catch (e) {
      warnDirectusDev("[Directus] user message save failed", e);
    }
  };

  const sendToBackend = async (text: string, intentOverride?: string) => {
    if (!humanMode && directusHumanLaneRef.current) {
      return;
    }
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
      const body: {
        messages: { role: "user" | "assistant"; content: string }[];
        visitor_id: string;
        conversation_id: string | null;
        stream: boolean;
        intent?: string;
      } = {
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
        let finalPayload: ChatPayload | null = null;

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
              const obj = JSON.parse(payload) as ChatPayload;
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
        await persistInboundAssistantBubble(reply);

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
        applyBackendHumanHandoffIfExplicit(text, finalPayload);
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
          await persistInboundAssistantBubble(reply);
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
        applyBackendHumanHandoffIfExplicit(text, data as ChatPayload);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setMessages(p => [...p, {
        id: Date.now().toString() + "e",
        text: `⚠️ ${message}`,
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

    await persistDirectusUserTurn(text);

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
    await persistOutboundUserBubble(label);
    await sendToBackend(label, value);
  };

  const consumeUi = (id: string) => {
    setMessages(p => p.map(m => m.id === id ? { ...m, consumed: true } : m));
  };

  const handleUiSubmit = async (id: string, value: string) => {
    unlockTts();
    consumeUi(id);
    pushUserMessage(value);
    await persistOutboundUserBubble(value);
    await sendToBackend(value);
  };

  const handleQuickReply = async (id: string, label: string, value: string) => {
    unlockTts();
    consumeUi(id);
    pushUserMessage(label);
    await persistOutboundUserBubble(label);
    await sendToBackend(value);
  };

  const hasPendingInput = messages.some(
    m => m.ui && !m.consumed && m.ui.type === "request_input"
  );

  const suppressInputLegacyHuman = humanMode && !directusHumanLane;

  return (
    <div className="flex flex-col h-full max-w-full bg-background">
      <ChatHeader
        ttsSupported={ttsSupported}
        ttsEnabled={ttsEnabled}
        speaking={speaking}
        onToggleTts={() => setTtsEnabled(v => !v)}
      />
      {(humanMode || directusHumanLane) && (
        <div className="px-4 py-2 border-b bg-muted/40 flex items-center gap-2">
          <Badge variant="default" className={directusHumanLane ? "bg-indigo-600 hover:bg-indigo-700" : "bg-green-600 hover:bg-green-700"}>
            {directusHumanLane ? "A falar com agente humano" : "🟢 Agente humano"}
          </Badge>
          {!directusHumanLane && (
            <span className="text-xs text-muted-foreground">
              Estás a falar com a equipa HotelEquip.
            </span>
          )}
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
            if (m.system && m.text) {
              return (
                <p
                  key={m.id}
                  className="text-center text-xs text-muted-foreground italic px-3 py-1"
                >
                  {m.text}
                </p>
              );
            }
            if (!m.text) return null;
            return <ChatMessage key={m.id} message={m.text} isUser={m.isUser} timestamp={m.timestamp} />;
          })}

          {showIntentMenu && !humanMode && !directusHumanLane && (
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
        disabled={isTyping || suppressInputLegacyHuman || hasPendingInput}
        pendingInput={hasPendingInput}
      />
    </div>
  );
};
