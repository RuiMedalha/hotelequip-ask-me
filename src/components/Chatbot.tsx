import { useState, useEffect, useRef } from "react";
import { ChatHeader } from "./ChatHeader";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

const botResponses = [
  "Olá! Bem-vindo à HotelEquip! Como posso ajudá-lo hoje?",
  "Somos especialistas em equipamentos para hotéis, restaurantes e estabelecimentos de hospitalidade.",
  "Temos uma vasta gama de produtos: equipamentos de cozinha profissional, mobiliário, sistemas de climatização, produtos de limpeza e muito mais.",
  "Para mais informações específicas sobre nossos produtos, pode visitar o nosso site hotelequip.pt ou contactar-nos diretamente.",
  "Está interessado em algum tipo específico de equipamento? Posso fornecer-lhe mais detalhes!",
  "Os nossos produtos são de alta qualidade e adequados para estabelecimentos de todas as dimensões.",
  "Também oferecemos serviços de instalação e manutenção para garantir o melhor funcionamento dos equipamentos.",
  "Tem alguma dúvida específica sobre preços ou disponibilidade? Ficarei feliz em ajudar!"
];

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

    // Simulate bot response delay
    setTimeout(() => {
      const randomResponse = botResponses[Math.floor(Math.random() * botResponses.length)];
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: randomResponse,
        isUser: false,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, botMessage]);
      setIsTyping(false);
    }, 1500 + Math.random() * 1000); // Random delay between 1.5-2.5s
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