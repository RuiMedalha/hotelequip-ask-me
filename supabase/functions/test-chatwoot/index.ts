import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/admin.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const { url, account_id, inbox_id, api_token } = await req.json();
    if (!url || !account_id || !inbox_id || !api_token) {
      return new Response(JSON.stringify({ ok: false, error: "Faltam campos" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const base = String(url).replace(/\/$/, "");

    // 1. Validar token: listar inboxes
    const inboxRes = await fetch(`${base}/api/v1/accounts/${account_id}/inboxes`, {
      headers: { api_access_token: api_token },
    });
    if (!inboxRes.ok) {
      return new Response(JSON.stringify({
        ok: false, step: "list_inboxes", status: inboxRes.status, error: await inboxRes.text(),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const inboxData = await inboxRes.json();
    const inboxes = inboxData.data?.payload || inboxData.payload || [];
    const found = inboxes.find((i: any) => String(i.id) === String(inbox_id));

    // 2. Criar contacto de teste
    const ts = Date.now();
    const contactRes = await fetch(`${base}/api/v1/accounts/${account_id}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", api_access_token: api_token },
      body: JSON.stringify({
        inbox_id: Number(inbox_id),
        name: `Teste HotelEquip Bot ${ts}`,
        email: `teste-${ts}@hotelequip.test`,
        phone_number: `+351900${String(ts).slice(-6)}`,
        identifier: `bot-test-${ts}`,
      }),
    });
    const contact = await contactRes.json();
    if (!contactRes.ok) {
      return new Response(JSON.stringify({
        ok: false, step: "create_contact", status: contactRes.status, error: contact,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const contactId = contact.payload?.contact?.id || contact.payload?.id;
    const sourceId = contact.payload?.contact_inbox?.source_id;

    // 3. Criar conversa de teste
    const convRes = await fetch(`${base}/api/v1/accounts/${account_id}/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", api_access_token: api_token },
      body: JSON.stringify({
        source_id: String(sourceId || contactId),
        inbox_id: Number(inbox_id),
        contact_id: contactId,
      }),
    });
    const cwConv = await convRes.json();
    if (!convRes.ok) {
      return new Response(JSON.stringify({
        ok: false, step: "create_conversation", status: convRes.status, error: cwConv,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4. Adicionar mensagem
    if (cwConv.id) {
      await fetch(`${base}/api/v1/accounts/${account_id}/conversations/${cwConv.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", api_access_token: api_token },
        body: JSON.stringify({
          content: "✅ Teste de integração HotelEquip Chatbot — funciona!",
          message_type: "outgoing",
          private: true,
        }),
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      inbox_found: !!found,
      inbox_name: found?.name,
      contact_id: contactId,
      conversation_id: cwConv.id,
      message: `Conversa de teste criada no Chatwoot (id ${cwConv.id}). Verifica no teu painel.`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
