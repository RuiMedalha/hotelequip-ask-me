import { useState } from "react";
import { MessageCircle, X, Minimize2 } from "lucide-react";
import { Chatbot } from "./Chatbot";
import { Button } from "@/components/ui/button";

export const ChatWidget = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const toggleChat = () => {
    if (isOpen && !isMinimized) {
      setIsMinimized(true);
    } else {
      setIsOpen(!isOpen);
      setIsMinimized(false);
    }
  };

  const closeChat = () => {
    setIsOpen(false);
    setIsMinimized(false);
  };

  return (
    <>
      {/* Chat Window */}
      {isOpen && (
        <div className={`fixed bottom-20 right-4 z-50 transition-all duration-300 ${
          isMinimized ? 'scale-0 opacity-0' : 'scale-100 opacity-100'
        }`}>
          <div className="bg-background border border-border rounded-lg shadow-2xl w-96 h-[600px] flex flex-col overflow-hidden">
            {/* Header do Widget */}
            <div className="bg-chat-primary text-chat-primary-foreground p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                <div>
                  <h3 className="font-semibold">HotelEquip Chat</h3>
                  <p className="text-xs opacity-90">Equipamentos para hotéis</p>
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsMinimized(true)}
                  className="h-8 w-8 p-0 hover:bg-white/20"
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closeChat}
                  className="h-8 w-8 p-0 hover:bg-white/20"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            {/* Chatbot Content */}
            <div className="flex-1 overflow-hidden">
              <Chatbot />
            </div>
          </div>
        </div>
      )}

      {/* Floating Button */}
      <Button
        onClick={toggleChat}
        className="fixed bottom-4 right-4 z-50 h-14 w-14 rounded-full bg-chat-primary hover:bg-chat-primary/90 text-chat-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110"
        size="icon"
      >
        {isOpen && !isMinimized ? (
          <X className="h-6 w-6" />
        ) : (
          <MessageCircle className="h-6 w-6" />
        )}
      </Button>

      {/* Notification Badge (opcional) */}
      {!isOpen && (
        <div className="fixed bottom-16 right-2 z-40 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium animate-pulse">
          !
        </div>
      )}
    </>
  );
};