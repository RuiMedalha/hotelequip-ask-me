import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient, getSecret, getSettings } from "../_shared/admin.ts";

// ============ AI Adapters ============

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | any;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Pesquisa produtos no catálogo WooCommerce da HotelEquip. Devolve nome, preço e link.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Termo de pesquisa" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_faq",
      description: "Pesquisa nas FAQs e sinónimos indexados no Meilisearch.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_lead",
      description: "Guarda os dados de contacto do cliente. Chama quando tiveres pelo menos nome+email ou nome+telefone.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          interest: { type: "string", description: "Resumo do interesse do cliente" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_human_handoff",
      description: "Passa a conversa para um agente humano (notifica WhatsApp e cria ticket no Chatwoot).",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          summary: { type: "string", description: "Resumo curto da conversa" },
        },
        required: ["reason"],
      },
    },
  },
];

async function executeTool(
  name: string,
  args: any,
  ctx: { conversationId: string; settings: Record<string, any> }
): Promise<string> {
  if (name === "search_products") {
    const storeUrl = ctx.settings.woo_store_url || "";
    const ck = await getSecret("woo_consumer_key");
    const cs = await getSecret("woo_consumer_secret");
    if (!storeUrl || !ck || !cs) return JSON.stringify({ error: "WooCommerce não configurado" });
    const url = `${storeUrl}/wp-json/wc/v3/products?search=${encodeURIComponent(args.query)}&per_page=5&consumer_key=${ck}&consumer_secret=${cs}`;
    const r = await fetch(url);
    if (!r.ok) return JSON.stringify({ error: `WC ${r.status}` });
    const data = await r.json();
    return JSON.stringify(
      (data || []).map((p: any) => ({
        id: p.id, name: p.name, price: p.price, permalink: p.permalink,
        short_description: (p.short_description || "").replace(/<[^>]+>/g, "").slice(0, 200),
        in_stock: p.stock_status === "instock",
      }))
    );
  }
  if (name === "search_faq") {
    const host = await getSecret("meilisearch_host");
    const key = await getSecret("meilisearch_api_key");
    if (!host || !key) return JSON.stringify({ error: "Meilisearch não configurado" });
    const results: any = {};
    for (const idx of ["faq", "produtos", "sinonimos"]) {
      try {
        const r = await fetch(`${host}/indexes/${idx}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ q: args.query, limit: 3 }),
        });
        if (r.ok) results[idx] = (await r.json()).hits;
      } catch {}
    }
    return JSON.stringify(results);
  }
  if (name === "save_lead") {
    const admin = adminClient();
    const { data: lead } = await admin
      .from("leads")
      .insert({
        conversation_id: ctx.conversationId,
        name: args.name, email: args.email, phone: args.phone, interest: args.interest,
      })
      .select()
      .single();
    if (lead) await admin.from("conversations").update({ lead_id: lead.id }).eq("id", ctx.conversationId);
    return JSON.stringify({ ok: true });
  }
  if (name === "request_human_handoff") {
    const admin = adminClient();
    await admin.from("conversations").update({ status: "handoff" }).eq("id", ctx.conversationId);
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ conversation_id: ctx.conversationId, reason: args.reason, summary: args.summary }),
      });
    } catch (e) { console.error("handoff trigger fail", e); }
    return JSON.stringify({ ok: true, message: ctx.settings.handoff_message });
  }
  return JSON.stringify({ error: "unknown tool" });
}

async function callOpenAICompatible(
  baseUrl: string, apiKey: string, model: string, messages: ChatMessage[],
  temperature: number, maxTokens: number, tools: any[]
) {
  const r = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, tools, tool_choice: "auto" }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function callAnthropic(
  apiKey: string, model: string, messages: ChatMessage[], system: string,
  temperature: number, maxTokens: number
) {
  const anthropicMsgs = messages.filter(m => m.role !== "system").map(m => {
    if (m.role === "tool") {
      return { role: "user", content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }] };
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      return {
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.tool_calls.map((tc: any) => ({ type: "tool_use", id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, system, messages: anthropicMsgs, max_tokens: maxTokens, temperature,
      tools: TOOLS.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })),
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const textBlocks = data.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const toolCalls = data.content.filter((c: any) => c.type === "tool_use").map((c: any) => ({
    id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) },
  }));
  return { choices: [{ message: { role: "assistant", content: textBlocks, tool_calls: toolCalls.length ? toolCalls : undefined }, finish_reason: data.stop_reason }] };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { messages: userMessages, visitor_id, conversation_id } = await req.json();
    if (!visitor_id) throw new Error("visitor_id required");

    const settings = await getSettings();
    const provider = settings.ai_provider || "openai";
    const baseUrl = settings.ai_base_url || "https://api.openai.com/v1";
    const model = settings.ai_model || "gpt-4o-mini";
    const temperature = Number(settings.ai_temperature ?? 0.7);
    const maxTokens = Number(settings.ai_max_tokens ?? 1024);
    const systemPrompt = settings.system_prompt || "Sê útil.";
    const apiKey = await getSecret("ai_api_key");
    if (!apiKey) throw new Error("AI API key não configurada no painel admin");

    const admin = adminClient();
    let convId = conversation_id;
    if (!convId) {
      const { data } = await admin.from("conversations").insert({ visitor_id }).select().single();
      convId = data!.id;
    }
    const lastUser = userMessages[userMessages.length - 1];
    if (lastUser?.role === "user") {
      await admin.from("messages").insert({ conversation_id: convId, role: "user", content: lastUser.content });
    }

    const conversation: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...userMessages,
    ];

    // Tool loop
    let finalText = "";
    for (let i = 0; i < 5; i++) {
      let resp;
      if (provider === "anthropic") {
        resp = await callAnthropic(apiKey, model, conversation, systemPrompt, temperature, maxTokens);
      } else {
        resp = await callOpenAICompatible(baseUrl, apiKey, model, conversation, temperature, maxTokens, TOOLS);
      }
      const msg = resp.choices[0].message;
      conversation.push(msg);
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          const args = JSON.parse(tc.function.arguments || "{}");
          const result = await executeTool(tc.function.name, args, { conversationId: convId, settings });
          conversation.push({ role: "tool", tool_call_id: tc.id, name: tc.function.name, content: result });
        }
        continue;
      }
      finalText = msg.content || "";
      break;
    }

    await admin.from("messages").insert({ conversation_id: convId, role: "assistant", content: finalText });

    return new Response(JSON.stringify({ reply: finalText, conversation_id: convId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("chat error", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
