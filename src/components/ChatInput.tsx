import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Mic, MicOff, Loader2 } from "lucide-react";
import { supabase, FUNCTIONS_URL, SUPABASE_ANON_KEY } from "@/integrations/supabase/client";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  onMicStart?: () => void;
  disabled?: boolean;
  pendingInput?: boolean;
}

function getSpeechRecognition(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

function hasMediaRecorderSupport(): boolean {
  if (typeof window === "undefined") return false;
  return !!((window as any).MediaRecorder && navigator.mediaDevices?.getUserMedia);
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    apikey: SUPABASE_ANON_KEY as string,
    Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
  };
}

export const ChatInput = ({ onSendMessage, onMicStart, disabled, pendingInput }: ChatInputProps) => {
  const [message, setMessage] = useState("");
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [hasSR, setHasSR] = useState(false);
  const [hasMR, setHasMR] = useState(false);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const whisperTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setHasSR(!!getSpeechRecognition());
    setHasMR(hasMediaRecorderSupport());
  }, []);

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
      try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
      if (whisperTimeoutRef.current) clearTimeout(whisperTimeoutRef.current);
    };
  }, []);

  const micSupported = hasSR || hasMR;
  const micBusy = listening || recording || transcribing;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (whisperTimeoutRef.current) {
      clearTimeout(whisperTimeoutRef.current);
      whisperTimeoutRef.current = null;
    }
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage("");
    }
  };

  // ---- Web Speech API (Chrome/Edge/Android) ----
  const startListening = () => {
    const SR = getSpeechRecognition();
    if (!SR) return;
    onMicStart?.();
    try {
      const rec = new SR();
      rec.lang = "pt-PT";
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (event: any) => {
        let interim = "";
        let final = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += t;
          else interim += t;
        }
        const text = final || interim;
        if (text) setMessage(text);
        if (final) {
          try { recognitionRef.current?.stop(); } catch { /* noop */ }
          setTimeout(() => {
            const trimmed = final.trim();
            if (trimmed) {
              onSendMessage(trimmed);
              setMessage("");
            }
          }, 500);
        }
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => {
        setListening(false);
        recognitionRef.current = null;
      };
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const stopListening = () => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  };

  // ---- MediaRecorder + Whisper (Safari iOS / fallback) ----
  const transcribeWithWhisper = async (blob: Blob, ext: string) => {
    try {
      setTranscribing(true);
      const form = new FormData();
      form.append("audio", blob, `recording.${ext}`);
      const headers = await authHeaders();
      const r = await fetch(`${FUNCTIONS_URL}/transcribe-audio`, {
        method: "POST",
        headers,
        body: form,
      });
      const data = await r.json();
      if (data?.text) {
        const text = String(data.text).trim();
        setMessage(text);
        whisperTimeoutRef.current = setTimeout(() => {
          if (text) {
            onSendMessage(text);
            setMessage("");
          }
          whisperTimeoutRef.current = null;
        }, 500);
      } else if (data?.error) {
        console.error("Whisper error", data.error);
      }
    } catch (e) {
      console.error("Whisper transcription failed", e);
    } finally {
      setTranscribing(false);
    }
  };

  const startWhisper = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const MR: any = (window as any).MediaRecorder;
      const mimeType = MR.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MR.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "audio/ogg";
      const recorder: MediaRecorder = new MR(stream, { mimeType });
      chunksRef.current = [];
      const timeoutId = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          stopWhisper();
        }
      }, 60000);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        clearTimeout(timeoutId);
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
        await transcribeWithWhisper(blob, ext);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      onMicStart?.();
    } catch (e) {
      console.error("MediaRecorder start failed", e);
      setRecording(false);
    }
  };

  const stopWhisper = () => {
    try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const toggleMic = () => {
    if (transcribing) return;
    if (hasSR) {
      listening ? stopListening() : startListening();
    } else if (hasMR) {
      recording ? stopWhisper() : startWhisper();
    }
  };

  const placeholder = disabled
    ? "👆 Por favor usa o campo acima"
    : listening
    ? "🎤 A ouvir..."
    : recording
    ? "🔴 A gravar... (toca para parar)"
    : transcribing
    ? "⏳ A processar..."
    : "Digite a sua mensagem...";

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 p-4 bg-background border-t border-border"
    >
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={placeholder}
        disabled={disabled || transcribing}
        className="flex-1 rounded-full bg-chat-input border-border focus:ring-chat-primary focus:border-chat-primary"
      />
      {micSupported && (
        <Button
          type="button"
          size="icon"
          variant={recording || listening ? "destructive" : "outline"}
          onClick={toggleMic}
          disabled={disabled || transcribing}
          aria-label={
            transcribing ? "A processar..."
              : recording ? "A gravar... toca para parar"
              : listening ? "A ouvir..."
              : "Ditar mensagem por voz"
          }
          className={`rounded-full ${micBusy ? "animate-pulse" : ""}`}
        >
          {transcribing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : recording || listening ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </Button>
      )}
      <Button
        type="submit"
        size="icon"
        disabled={!message.trim() || disabled || transcribing}
        className="rounded-full bg-chat-primary hover:bg-chat-primary/90 text-chat-primary-foreground shadow-chat"
      >
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
};
