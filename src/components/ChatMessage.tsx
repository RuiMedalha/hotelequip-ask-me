import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

interface ChatMessageProps {
  message: string;
  isUser: boolean;
  timestamp: Date;
}

export const ChatMessage = ({ message, isUser, timestamp }: ChatMessageProps) => {
  return (
    <div
      className={cn(
        "flex w-full animate-in slide-in-from-bottom-2 duration-300",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3 shadow-bubble transition-all duration-200 hover:shadow-lg",
          isUser
            ? "bg-chat-bubble-user text-chat-primary-foreground ml-12"
            : "bg-chat-bubble-bot text-foreground mr-12 border border-border"
        )}
      >
        <div className="text-sm leading-relaxed prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-headings:my-2 prose-img:my-2 prose-img:rounded-lg prose-img:max-h-40 prose-a:text-primary">
          <ReactMarkdown
            components={{
              a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
              img: ({ node, ...props }) => <img {...props} loading="lazy" alt={props.alt || ""} />,
            }}
          >{message}</ReactMarkdown>
        </div>
        <span
          className={cn(
            "text-xs mt-1 block",
            isUser ? "text-chat-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          {timestamp.toLocaleTimeString("pt-PT", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
};