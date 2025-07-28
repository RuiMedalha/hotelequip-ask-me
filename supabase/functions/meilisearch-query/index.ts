import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const MEILISEARCH_HOST = Deno.env.get("MEILISEARCH_HOST");
const MEILISEARCH_API_KEY = Deno.env.get("MEILISEARCH_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SearchRequest {
  query: string;
}

interface MeilisearchResponse {
  hits: Array<{
    id: string;
    title?: string;
    content?: string;
    category?: string;
    price?: string;
    description?: string;
    [key: string]: any;
  }>;
  processingTimeMs: number;
  query: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query }: SearchRequest = await req.json();

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Query is required" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Pesquisar em múltiplos índices
    const searchPromises = [
      searchIndex("faq", query),
      searchIndex("produtos", query),
      searchIndex("sinonimos", query)
    ];

    const results = await Promise.all(searchPromises);
    const [faqResults, produtoResults, sinonimoResults] = results;

    // Combinar e priorizar resultados
    const combinedResults = {
      faq: faqResults.hits,
      produtos: produtoResults.hits,
      sinonimos: sinonimoResults.hits,
      query: query
    };

    // Gerar resposta contextual
    const response = generateContextualResponse(combinedResults, query);

    return new Response(
      JSON.stringify({ 
        response,
        searchResults: combinedResults,
        processingTime: Math.max(
          faqResults.processingTimeMs,
          produtoResults.processingTimeMs,
          sinonimoResults.processingTimeMs
        )
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    console.error("Error in meilisearch-query:", error);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error",
        response: "Desculpe, ocorreu um erro ao processar a sua pergunta. Pode tentar reformular?" 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});

async function searchIndex(indexName: string, query: string): Promise<MeilisearchResponse> {
  const response = await fetch(`${MEILISEARCH_HOST}/indexes/${indexName}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${MEILISEARCH_API_KEY}`,
    },
    body: JSON.stringify({
      q: query,
      limit: 5,
      attributesToHighlight: ["*"],
    }),
  });

  if (!response.ok) {
    throw new Error(`Meilisearch error: ${response.status}`);
  }

  return await response.json();
}

function generateContextualResponse(results: any, query: string): string {
  const { faq, produtos, sinonimos } = results;

  // Priorizar FAQ se houver resultados relevantes
  if (faq.length > 0) {
    const bestFaq = faq[0];
    return `${bestFaq.content || bestFaq.description || bestFaq.title}

${produtos.length > 0 ? `\n\n**Produtos relacionados:**\n${produtos.slice(0, 2).map((p: any) => `• ${p.title}${p.price ? ` - ${p.price}` : ''}`).join('\n')}` : ''}

Posso ajudar com mais alguma coisa sobre equipamentos para hotéis?`;
  }

  // Se não há FAQ, focar em produtos
  if (produtos.length > 0) {
    const productList = produtos.slice(0, 3).map((p: any) => 
      `• **${p.title}**${p.price ? ` - ${p.price}` : ''}${p.description ? `\n  ${p.description.substring(0, 100)}...` : ''}`
    ).join('\n\n');

    return `Encontrei estes produtos relacionados com "${query}":\n\n${productList}

Gostaria de mais informações sobre algum destes equipamentos?`;
  }

  // Se há sinônimos, usar para sugerir termos relacionados
  if (sinonimos.length > 0) {
    const synonyms = sinonimos.map((s: any) => s.title || s.content).join(', ');
    return `Não encontrei resultados diretos para "${query}", mas talvez esteja à procura de: ${synonyms}

Pode reformular a sua pergunta ou contactar-nos diretamente através do hotelequip.pt para mais informações específicas.`;
  }

  // Resposta padrão quando não há resultados
  return `Não encontrei informações específicas sobre "${query}" na nossa base de dados. 

Somos especialistas em equipamentos para hotéis e restaurantes. Para consultas específicas, pode:
• Visitar o nosso site hotelequip.pt
• Contactar-nos diretamente para um orçamento personalizado
• Reformular a sua pergunta com outros termos

Como posso ajudar de outra forma?`;
}