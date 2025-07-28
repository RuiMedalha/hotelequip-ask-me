export const TypingIndicator = () => {
  return (
    <div className="flex justify-start animate-in slide-in-from-bottom-2 duration-300">
      <div className="bg-chat-bubble-bot text-foreground max-w-[80%] rounded-2xl px-4 py-3 mr-12 border border-border shadow-bubble">
        <div className="flex items-center space-x-1">
          <span className="text-sm text-muted-foreground">HotelEquip está digitando</span>
          <div className="flex space-x-1 ml-2">
            <div className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]"></div>
            <div className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]"></div>
            <div className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce"></div>
          </div>
        </div>
      </div>
    </div>
  );
};