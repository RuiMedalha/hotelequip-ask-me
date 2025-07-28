import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

export const ChatInput = ({ onSendMessage, disabled }: ChatInputProps) => {
  const [message, setMessage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage("");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 p-4 bg-background border-t border-border"
    >
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Digite sua mensagem..."
        disabled={disabled}
        className="flex-1 rounded-full bg-chat-input border-border focus:ring-chat-primary focus:border-chat-primary"
      />
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