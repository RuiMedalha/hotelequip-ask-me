import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Send,
  Mic,
  MicOff,
  Loader2,
  Paperclip,
  ImagePlus,
  X,
} from "lucide-react";
import type { OutboundMediaPayload, PendingMediaFile } from "@/types/media";
import {
  detectMediaType,
  fileToMessageAttachment,
  formatFileSize,
  pickVoiceRecordingMimeType,
  validateFile,
} from "@/lib/fileMedia";
import { uuid } from "@/lib/uuid";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  onSendMedia?: (payload: OutboundMediaPayload) => void | Promise<void>;
  onMicStart?: () => void;
  disabled?: boolean;
  uploading?: boolean;
  pendingInput?: boolean;
}

function formatRecordingTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const ChatInput = ({
  onSendMessage,
  onSendMedia,
  onMicStart,
  disabled,
  uploading,
  pendingInput,
}: ChatInputProps) => {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<PendingMediaFile | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [voicePreview, setVoicePreview] = useState<{ file: File; url: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canRecord =
    typeof window !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== "undefined";

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (recordStreamRef.current) {
        recordStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (voicePreview?.url) URL.revokeObjectURL(voicePreview.url);
      if (pending?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(pending.previewUrl);
    };
  }, [voicePreview, pending]);

  const busy = uploading || recording;

  const clearPending = () => {
    if (pending?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  };

  const clearVoicePreview = () => {
    if (voicePreview?.url) URL.revokeObjectURL(voicePreview.url);
    setVoicePreview(null);
  };

  const addPendingFile = (file: File) => {
    const validation = validateFile(file);
    if (!validation.ok) {
      alert(validation.ok === false ? validation.error : "Ficheiro inválido.");
      return;
    }
    clearPending();
    clearVoicePreview();
    const contentType = detectMediaType(file);
    let previewUrl: string | undefined;
    if (contentType === "image" || contentType === "audio" || contentType === "video") {
      previewUrl = URL.createObjectURL(file);
    }
    setPending({ id: uuid(), file, previewUrl, contentType });
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>, imageOnly = false) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (imageOnly && detectMediaType(file) !== "image") {
      alert("Seleccione uma imagem (JPEG, PNG ou WebP).");
      return;
    }
    addPendingFile(file);
  };

  const startRecording = async () => {
    if (!canRecord || disabled || uploading) return;
    onMicStart?.();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickVoiceRecordingMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      recordChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        const blob = new Blob(recordChunksRef.current, { type: mimeType });
        const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mimeType });
        const validation = validateFile(file);
        if (!validation.ok) {
          alert(validation.ok === false ? validation.error : "Gravação inválida.");
          return;
        }
        clearPending();
        setVoicePreview({ file, url: URL.createObjectURL(file) });
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      recordStreamRef.current = stream;
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    }
    catch {
      alert("Não foi possível aceder ao microfone.");
    }
  };

  const stopRecording = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    try {
      mediaRecorderRef.current?.stop();
    }
    catch { /* noop */ }
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const toggleRecording = () => {
    if (recording) stopRecording();
    else startRecording();
  };

  const submit = async () => {
    if (disabled || uploading) return;

    const text = message.trim();
    const fileToSend = voicePreview?.file ?? pending?.file;

    if (fileToSend && onSendMedia) {
      try {
        const attachment = await fileToMessageAttachment(fileToSend);
        const contentType = attachment.type;
        await onSendMedia({
          text: text || undefined,
          content_type: contentType,
          attachments: [attachment],
        });
        setMessage("");
        clearPending();
        clearVoicePreview();
      }
      catch (e) {
        alert(e instanceof Error ? e.message : "Falha ao enviar ficheiro.");
      }
      return;
    }

    if (text) {
      onSendMessage(text);
      setMessage("");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const canSend = Boolean(message.trim() || pending || voicePreview) && !busy && !disabled;

  const placeholder = pendingInput
    ? "👆 Por favor usa o campo acima"
    : recording
      ? `🔴 A gravar ${formatRecordingTime(recordSeconds)}…`
      : uploading
        ? "⏳ A enviar…"
        : pending || voicePreview
          ? "Adicione texto opcional e envie"
          : "Digite a sua mensagem…";

  return (
    <div className="border-t border-border bg-background">
      {(pending || voicePreview) && (
        <div className="px-4 pt-3">
          <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex-1 min-w-0">
              {voicePreview && (
                <audio controls src={voicePreview.url} className="w-full max-w-sm" />
              )}
              {pending && !voicePreview && pending.contentType === "image" && pending.previewUrl && (
                <img
                  src={pending.previewUrl}
                  alt={pending.file.name}
                  className="max-h-24 rounded-md object-contain"
                />
              )}
              {pending && !voicePreview && pending.contentType === "video" && pending.previewUrl && (
                <video src={pending.previewUrl} className="max-h-24 rounded-md" controls />
              )}
              {pending && !voicePreview && pending.contentType !== "image" && pending.contentType !== "video" && (
                <p className="text-sm truncate">{pending.file.name}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {(voicePreview?.file ?? pending?.file)
                  ? formatFileSize((voicePreview?.file ?? pending!.file).size)
                  : ""}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="shrink-0"
              onClick={() => {
                clearPending();
                clearVoicePreview();
              }}
              aria-label="Remover anexo"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-2 p-4">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,video/mp4,video/webm,audio/*"
          onChange={(e) => handleFilePick(e, false)}
        />
        <input
          ref={imageInputRef}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => handleFilePick(e, true)}
        />

        <Button
          type="button"
          size="icon"
          variant="outline"
          className="rounded-full shrink-0"
          disabled={disabled || busy}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Anexar ficheiro"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="rounded-full shrink-0"
          disabled={disabled || busy}
          onClick={() => imageInputRef.current?.click()}
          aria-label="Enviar imagem"
        >
          <ImagePlus className="h-4 w-4" />
        </Button>

        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || recording || uploading}
          className="flex-1 rounded-full bg-chat-input border-border focus:ring-chat-primary focus:border-chat-primary"
        />

        {canRecord && (
          <Button
            type="button"
            size="icon"
            variant={recording ? "destructive" : "outline"}
            onClick={toggleRecording}
            disabled={disabled || uploading}
            aria-label={recording ? "Parar gravação" : "Gravar mensagem de voz"}
            className={cn("rounded-full shrink-0", recording && "animate-pulse")}
          >
            {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        )}

        <Button
          type="submit"
          size="icon"
          disabled={!canSend}
          className="rounded-full bg-chat-primary hover:bg-chat-primary/90 text-chat-primary-foreground shadow-chat shrink-0"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
};
