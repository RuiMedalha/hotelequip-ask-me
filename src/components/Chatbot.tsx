import { useState, useEffect, useRef } from "react";
import { ChatHeader } from "./ChatHeader";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

// Função para consultar o Meilisearch via Supabase Edge Function
const queryMeilisearch = async (query: string): Promise<string> => {
  try {
    const { data, error } = await supabase.functions.invoke('meilisearch-query', {
      body: { query }
    });

    if (error) {
      console.error('Erro na consulta Meilisearch:', error);
      return "Desculpe, ocorreu um erro ao processar a sua pergunta. Pode tentar reformular?";
    }

    return data.response || "Não consegui encontrar uma resposta específica para a sua pergunta.";
  } catch (error) {
    console.error('Erro na comunicação com Meilisearch:', error);
    return "Desculpe, não consegui processar a sua pergunta neste momento. Pode tentar novamente?";
  }
};

export const Chatbot = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Mensagem de boas-vindas
    const welcomeMessage: Message = {
      id: "welcome",
      text: "Olá! Bem-vindo à HotelEquip! 👋\n\nSomos especialistas em equipamentos para hotéis e restaurantes. Como posso ajudá-lo hoje?",
      isUser: false,
      timestamp: new Date(),
    };
    setMessages([welcomeMessage]);
  }, []);

  useEffect(() => {
    // Auto scroll to bottom
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [messages, isTyping]);

  const handleSendMessage = async (messageText: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      text: messageText,
      isUser: true,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);

    // Consultar Meilisearch para resposta inteligente
    try {
      const responseText = await queryMeilisearch(messageText);
      
      // Simular delay realista para digitação
      setTimeout(() => {
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: responseText,
          isUser: false,
          timestamp: new Date(),
        };

        setMessages(prev => [...prev, botMessage]);
        setIsTyping(false);
      }, 1000 + Math.random() * 1000); // Delay entre 1-2s
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
      
      setTimeout(() => {
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: "Desculpe, ocorreu um erro. Pode tentar novamente ou contactar-nos diretamente através do hotelequip.pt",
          isUser: false,
          timestamp: new Date(),
        };

        setMessages(prev => [...prev, errorMessage]);
        setIsTyping(false);
      }, 1000);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto bg-background border-x border-border">
      <ChatHeader />
      
      <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message.text}
              isUser={message.isUser}
              timestamp={message.timestamp}
            />
          ))}
          {isTyping && <TypingIndicator />}
        </div>
      </ScrollArea>

      <ChatInput onSendMessage={handleSendMessage} disabled={isTyping} />
    </div>
  );
};