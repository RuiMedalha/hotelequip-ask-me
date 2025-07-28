import { ChatWidget } from "@/components/ChatWidget";

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-secondary">
      {/* Exemplo da página principal do seu site */}
      <div className="container mx-auto px-4 py-8">
        <div className="text-center space-y-6">
          <h1 className="text-4xl font-bold text-foreground">
            HotelEquip - Equipamentos para Hotéis
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Especialistas em equipamentos profissionais para hotéis, restaurantes 
            e estabelecimentos de hospitalidade. Teste o nosso chat para mais informações!
          </p>
          
          <div className="grid md:grid-cols-3 gap-6 mt-12">
            <div className="bg-card p-6 rounded-lg shadow-sm border">
              <h3 className="text-xl font-semibold mb-3">Cozinha Profissional</h3>
              <p className="text-muted-foreground">
                Equipamentos de cozinha de alta qualidade para restaurantes e hotéis.
              </p>
            </div>
            <div className="bg-card p-6 rounded-lg shadow-sm border">
              <h3 className="text-xl font-semibold mb-3">Mobiliário</h3>
              <p className="text-muted-foreground">
                Mobiliário elegante e funcional para todos os espaços do seu estabelecimento.
              </p>
            </div>
            <div className="bg-card p-6 rounded-lg shadow-sm border">
              <h3 className="text-xl font-semibold mb-3">Climatização</h3>
              <p className="text-muted-foreground">
                Sistemas de climatização eficientes para o conforto dos seus hóspedes.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Widget de Chat */}
      <ChatWidget />
    </div>
  );
};

export default Index;