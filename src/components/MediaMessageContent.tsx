import { FileText, Loader2 } from "lucide-react";
import type { MessageAttachment } from "@/types/media";
import { attachmentToObjectUrl, formatFileSize } from "@/lib/fileMedia";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

interface MediaMessageContentProps {
  text?: string;
  attachments?: MessageAttachment[];
  isUser?: boolean;
  sending?: boolean;
}

function AttachmentBlock({ att, isUser }: { att: MessageAttachment; isUser?: boolean }) {
  const src = attachmentToObjectUrl(att);

  if (att.type === "image" && src) {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={src}
          alt={att.filename}
          className="rounded-lg max-h-48 max-w-full object-contain my-1"
          loading="lazy"
        />
      </a>
    );
  }

  if (att.type === "audio" && src) {
    return (
      <audio controls preload="metadata" className="w-full max-w-xs my-1" src={src}>
        <track kind="captions" />
      </audio>
    );
  }

  if (att.type === "video" && src) {
    return (
      <video controls preload="metadata" className="rounded-lg max-h-48 max-w-full my-1" src={src}>
        <track kind="captions" />
      </video>
    );
  }

  const href = src || att.url || "#";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 my-1 text-sm no-underline",
        isUser ? "border-primary-foreground/30 bg-black/10" : "border-border bg-muted/40",
      )}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{att.filename}</span>
      <span className="text-xs opacity-70">{formatFileSize(att.size_bytes)}</span>
    </a>
  );
}

export function MediaMessageContent({
  text,
  attachments = [],
  isUser,
  sending,
}: MediaMessageContentProps) {
  const hasText = Boolean(text?.trim());

  return (
    <div className="space-y-1">
      {sending && (
        <div className="flex items-center gap-2 text-xs opacity-80">
          <Loader2 className="h-3 w-3 animate-spin" />
          A enviar…
        </div>
      )}
      {attachments.map((att, i) => (
        <AttachmentBlock key={`${att.filename}-${i}`} att={att} isUser={isUser} />
      ))}
      {hasText && (
        <div className="text-sm leading-relaxed prose prose-sm max-w-none dark:prose-invert prose-p:my-1">
          <ReactMarkdown>{text!}</ReactMarkdown>
        </div>
      )}
      {!hasText && attachments.length === 0 && !sending && (
        <span className="text-sm opacity-70">(sem conteúdo)</span>
      )}
    </div>
  );
}
