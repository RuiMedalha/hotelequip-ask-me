import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Mic, MicOff } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  onMicStart?: () => void;
  disabled?: boolean;
}

function getSpeechRecognition(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export const ChatInput = ({ onSendMessage, onMicStart, disabled }: ChatInputProps) => {
  const [message, setMessage] = useState("");
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SR = getSpeechRecognition();
    setSupported(!!SR);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage("");
    }
  };

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
      let finalText = "";
      rec.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += t;
          else interim += t;
        }
        setMessage((prev) => (finalText || interim ? (finalText || interim) : prev));
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

  const toggleMic = () => (listening ? stopListening() : startListening());

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 p-4 bg-background border-t border-border"
    >
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={listening ? "🎤 A ouvir..." : "Digite sua mensagem..."}
        disabled={disabled}
        className="flex-1 rounded-full bg-chat-input border-border focus:ring-chat-primary focus:border-chat-primary"
      />
      {supported && (
        <Button
          type="button"
          size="icon"
          variant={listening ? "destructive" : "outline"}
          onClick={toggleMic}
          disabled={disabled}
          aria-label={listening ? "A ouvir..." : "Ditar mensagem por voz"}
          className={`rounded-full ${listening ? "animate-pulse" : ""}`}
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
      )}
      <Button
        type="submit"
        size="icon"
        disabled={!message.trim() || disabled}
        className="rounded-full bg-chat-primary hover:bg-chat-primary/90 text-chat-primary-foreground shadow-chat"
      >
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
};
