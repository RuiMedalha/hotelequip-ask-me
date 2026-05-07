import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient, getSecret, getSettings } from "../_shared/admin.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { conversation_id, reason, summary } = await req.json();
    const admin = adminClient();
    const settings = await getSettings();

    const { data: conv } = await admin.from("conversations").select("*, leads(*)").eq("id", conversation_id).maybeSingle();
    const { data: msgs } = await admin.from("messages").select("role,content,created_at").eq("conversation_id", conversation_id).order("created_at");

    const transcript = (msgs || []).map((m: any) => `[${m.role}] ${m.content}`).join("\n");
    const lead = (conv as any)?.leads;
    const leadInfo = lead ? `Nome: ${lead.name || "—"}\nEmail: ${lead.email || "—"}\nTelefone: ${lead.phone || "—"}\nInteresse: ${lead.interest || "—"}` : "Sem lead capturada";
    const fullText = `🤖 Nova conversa para humano\n\nMotivo: ${reason}\nResumo: ${summary || "—"}\n\n${leadInfo}\n\n--- Transcrição ---\n${transcript}`;

    const result: any = {};

    // Chatwoot
    const cwUrl = settings.chatwoot_url;
    const cwAcc = settings.chatwoot_account_id;
    const cwInbox = settings.chatwoot_inbox_id;
    const cwToken = await getSecret("chatwoot_api_token");
    if (cwUrl && cwAcc && cwInbox && cwToken) {
      try {
        const contactRes = await fetch(`${cwUrl}/api/v1/accounts/${cwAcc}/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", api_access_token: cwToken },
          body: JSON.stringify({
            inbox_id: Number(cwInbox),
            name: lead?.name || `Visitante ${conv?.visitor_id?.slice(0, 8)}`,
            email: lead?.email, phone_number: lead?.phone,
          }),
        });
        const contact = await contactRes.json();
        const sourceId = contact.payload?.contact_inbox?.source_id || contact.payload?.contact?.id;
        const convRes = await fetch(`${cwUrl}/api/v1/accounts/${cwAcc}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", api_access_token: cwToken },
          body: JSON.stringify({
            source_id: String(sourceId), inbox_id: Number(cwInbox),
            contact_id: contact.payload?.contact?.id || contact.payload?.id,
            additional_attributes: { reason, summary },
          }),
        });
        const cwConv = await convRes.json();
        if (cwConv.id) {
          await fetch(`${cwUrl}/api/v1/accounts/${cwAcc}/conversations/${cwConv.id}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", api_access_token: cwToken },
            body: JSON.stringify({ content: fullText, message_type: "outgoing", private: true }),
          });
        }
        result.chatwoot = { ok: true, conversation_id: cwConv.id };
      } catch (e: any) { result.chatwoot = { ok: false, error: e.message }; }
    }

    // WhatsApp
    const waNumber = settings.whatsapp_number;
    const waMode = settings.whatsapp_mode || "link";
    if (waNumber) {
      if (waMode === "twilio") {
        const sid = await getSecret("twilio_account_sid");
        const token = await getSecret("twilio_auth_token");
        const from = await getSecret("twilio_whatsapp_from");
        if (sid && token && from) {
          try {
            const auth = btoa(`${sid}:${token}`);
            const body = new URLSearchParams({ To: `whatsapp:${waNumber}`, From: `whatsapp:${from}`, Body: fullText.slice(0, 1500) });
            const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
              method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body,
            });
            result.whatsapp = { ok: r.ok };
          } catch (e: any) { result.whatsapp = { ok: false, error: e.message }; }
        }
      } else {
        result.whatsapp = { link: `https://wa.me/${waNumber.replace(/\D/g, "")}?text=${encodeURIComponent(fullText.slice(0, 1500))}` };
      }
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
