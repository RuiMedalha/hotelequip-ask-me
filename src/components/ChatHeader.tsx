import { MessageCircle, Globe, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatHeaderProps {
  ttsSupported?: boolean;
  ttsEnabled?: boolean;
  speaking?: boolean;
  onToggleTts?: () => void;
}

export const ChatHeader = ({ ttsSupported, ttsEnabled, speaking, onToggleTts }: ChatHeaderProps) => {
  return (
    <div className="flex items-center gap-3 p-4 bg-gradient-primary text-chat-primary-foreground shadow-chat">
      <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
        <MessageCircle className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <h2 className="font-semibold text-lg">HotelEquip Assistant</h2>
        <p className="text-sm text-chat-primary-foreground/80 flex items-center gap-1">
          <Globe className="h-3 w-3" />
          hotelequip.pt - Equipamentos Hoteleiros
        </p>
      </div>
      {ttsSupported && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggleTts}
          aria-label={ttsEnabled ? "Desactivar voz do assistente" : "Activar voz do assistente"}
          className={`text-chat-primary-foreground hover:bg-white/20 ${speaking ? "animate-pulse ring-2 ring-white/60" : ""}`}
        >
          {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
      )}
      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
    </div>
  );
};
