import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient, getSecret, getSettings } from "../_shared/admin.ts";

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void } | undefined;

async function safeJson(res: Response) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

function fetchWithTimeout(url: string, init: RequestInit, ms = 10000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { conversation_id, reason, summary } = await req.json();
    if (!conversation_id) {
      return new Response(JSON.stringify({ error: "conversation_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const job = processHandoff(conversation_id, reason, summary);
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(job);
    else job.catch((e) => console.error("handoff background fail", e));

    return new Response(JSON.stringify({ ok: true, status: "queued" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function processHandoff(conversation_id: string, reason?: string, summary?: string) {
  try {
    const admin = adminClient();
    const settings = await getSettings();

    const { data: conv } = await admin.from("conversations").select("*, leads(*)").eq("id", conversation_id).maybeSingle();
    const { data: msgs } = await admin.from("messages").select("role,content,created_at").eq("conversation_id", conversation_id).order("created_at");

    const transcript = (msgs || []).map((m: any) => `[${m.role}] ${m.content}`).join("\n");
    const lead = (conv as any)?.leads;
    const leadInfo = lead ? `Nome: ${lead.name || "—"}\nEmail: ${lead.email || "—"}\nTelefone: ${lead.phone || "—"}\nInteresse: ${lead.interest || "—"}` : "Sem lead capturada";
    const fullText = `🤖 Nova conversa para humano\n\nMotivo: ${reason}\nResumo: ${summary || "—"}\n\n${leadInfo}\n\n--- Transcrição ---\n${transcript}`;

    const result: any = {};
    const hasPhone = !!(lead?.phone && /^\+?\d{8,}$/.test(String(lead.phone).replace(/\s/g, "")));

    // ===== Chatwoot =====
    const cwUrl = (settings.chatwoot_url || "").replace(/\/$/, "");
    const cwAcc = settings.chatwoot_account_id;
    const cwInbox = settings.chatwoot_inbox_id;
    const cwToken = await getSecret("chatwoot_api_token");
    const websiteToken = settings.chatwoot_website_token;

    // Path A: cliente SEM telefone -> Website Public API (chat continua dentro do widget)
    if (!hasPhone && cwUrl && websiteToken) {
      try {
        const sourceId = `he-visitor-${conv?.visitor_id || conversation_id}`;
        const contactRes = await fetchWithTimeout(`${cwUrl}/public/api/v1/inboxes/${websiteToken}/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_id: sourceId,
            name: lead?.name || `Visitante ${conv?.visitor_id?.slice(0, 8)}`,
            email: lead?.email || undefined,
          }),
        });
        const contact = await safeJson(contactRes);
        if (!contactRes.ok) throw new Error(`Website contact failed (${contactRes.status}): ${JSON.stringify(contact).slice(0, 300)}`);
        const pubsubToken = contact.pubsub_token;
        const contactId = contact.id;

        const convRes = await fetchWithTimeout(`${cwUrl}/public/api/v1/inboxes/${websiteToken}/contacts/${sourceId}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const cwConv = await safeJson(convRes);
        if (!convRes.ok) throw new Error(`Website conversation failed (${convRes.status}): ${JSON.stringify(cwConv).slice(0, 300)}`);
        const cwConvId = cwConv.id;

        await fetchWithTimeout(`${cwUrl}/public/api/v1/inboxes/${websiteToken}/contacts/${sourceId}/conversations/${cwConvId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `--- Contexto da conversa com o bot ---\nMotivo: ${reason}\nResumo: ${summary || "—"}\n${leadInfo}\n\n${transcript}` }),
        });

        if (cwAcc && cwToken && cwConvId) {
          await fetchWithTimeout(`${cwUrl}/api/v1/accounts/${cwAcc}/conversations/${cwConvId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", api_access_token: cwToken },
            body: JSON.stringify({ content: fullText, message_type: "outgoing", private: true }),
          });
        }

        await admin.from("conversations").update({
          mode: "human",
          status: "handoff",
          chatwoot_conversation_id: cwConvId,
          chatwoot_contact_id: contactId,
          chatwoot_source_id: sourceId,
          chatwoot_pubsub_token: pubsubToken,
        }).eq("id", conversation_id);

        result.chatwoot = { ok: true, channel: "website", conversation_id: cwConvId };
      } catch (e: any) { result.chatwoot = { ok: false, channel: "website", error: e.message }; }
    }

    // Path B: cliente COM telefone -> contacto/conversa via admin API (+ notificação WhatsApp em baixo)
    if (hasPhone && cwUrl && cwAcc && cwInbox && cwToken) {
      try {
        const contactRes = await fetchWithTimeout(`${cwUrl}/api/v1/accounts/${cwAcc}/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", api_access_token: cwToken },
          body: JSON.stringify({
            inbox_id: Number(cwInbox),
            name: lead?.name || `Visitante ${conv?.visitor_id?.slice(0, 8)}`,
            email: lead?.email || undefined,
            phone_number: lead?.phone,
            identifier: conv?.visitor_id,
          }),
        });
        const contact = await safeJson(contactRes);
        if (!contactRes.ok) throw new Error(`Chatwoot contact failed (${contactRes.status}): ${JSON.stringify(contact).slice(0, 300)}`);
        const sourceId = contact.payload?.contact_inbox?.source_id || contact.payload?.contact?.id;
        const convRes = await fetchWithTimeout(`${cwUrl}/api/v1/accounts/${cwAcc}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", api_access_token: cwToken },
          body: JSON.stringify({
            source_id: String(sourceId), inbox_id: Number(cwInbox),
            contact_id: contact.payload?.contact?.id || contact.payload?.id,
            additional_attributes: { reason, summary },
          }),
        });
        const cwConv = await safeJson(convRes);
        if (!convRes.ok) throw new Error(`Chatwoot conversation failed (${convRes.status}): ${JSON.stringify(cwConv).slice(0, 300)}`);
        if (cwConv.id) {
          await fetchWithTimeout(`${cwUrl}/api/v1/accounts/${cwAcc}/conversations/${cwConv.id}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", api_access_token: cwToken },
            body: JSON.stringify({ content: fullText, message_type: "outgoing", private: true }),
          });
        }
        result.chatwoot = { ok: true, channel: "phone-inbox", conversation_id: cwConv.id };
      } catch (e: any) { result.chatwoot = { ok: false, channel: "phone-inbox", error: e.message }; }
    }

    // WhatsApp
    const waNumber = settings.whatsapp_number;
    const waMode = settings.whatsapp_mode || "link";
    const msgBody = fullText.slice(0, 1500);
    if (waNumber) {
      try {
        if (waMode === "meta") {
          const token = await getSecret("meta_wa_access_token");
          const phoneId = settings.meta_wa_phone_number_id;
          const template = settings.meta_wa_template;
          const lang = settings.meta_wa_template_lang || "pt_PT";
          if (!token || !phoneId) throw new Error("Meta: missing access_token or phone_number_id");
          const to = waNumber.replace(/\D/g, "");
          const sanitizeWa = (s: string) => s.replace(/[\n\r\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 700);
          const components: any[] = [
            { type: "body", parameters: [{ type: "text", text: sanitizeWa(msgBody) }] },
          ];
          const cwConvId = result.chatwoot?.conversation_id;
          // Template tem botão URL dinâmico no índice 0 — sempre obrigatório
          components.push({
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: String(cwConvId || conversation_id).slice(0, 15) }],
          });
          const payload: any = template
            ? { messaging_product: "whatsapp", to, type: "template", template: { name: template, language: { code: lang }, components } }
            : { messaging_product: "whatsapp", to, type: "text", text: { body: msgBody } };
          const r = await fetchWithTimeout(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await safeJson(r);
          if (!r.ok) throw new Error(`Meta WA failed (${r.status}): ${JSON.stringify(data).slice(0, 300)}`);
          result.whatsapp = { provider: "meta", ok: true };
        } else if (waMode === "ycloud") {
          const apiKey = await getSecret("ycloud_api_key");
          const from = settings.ycloud_from;
          if (!apiKey || !from) throw new Error("YCloud: missing api_key or from");
          const r = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages`, {
            method: "POST",
            headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: waNumber, type: "text", text: { body: msgBody } }),
          });
          const data = await safeJson(r);
          if (!r.ok) throw new Error(`YCloud failed (${r.status}): ${JSON.stringify(data).slice(0, 300)}`);
          result.whatsapp = { provider: "ycloud", ok: true };
        } else if (waMode === "evolution") {
          const apiKey = await getSecret("evolution_api_key");
          const baseUrl = (settings.evolution_url || "").replace(/\/$/, "");
          const instance = settings.evolution_instance;
          if (!apiKey || !baseUrl || !instance) throw new Error("Evolution: missing url/instance/api_key");
          const r = await fetchWithTimeout(`${baseUrl}/message/sendText/${instance}`, {
            method: "POST",
            headers: { apikey: apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ number: waNumber.replace(/\D/g, ""), text: msgBody }),
          });
          const data = await safeJson(r);
          if (!r.ok) throw new Error(`Evolution failed (${r.status}): ${JSON.stringify(data).slice(0, 300)}`);
          result.whatsapp = { provider: "evolution", ok: true };
        } else if (waMode === "twilio") {
          const sid = await getSecret("twilio_account_sid");
          const token = await getSecret("twilio_auth_token");
          const from = await getSecret("twilio_whatsapp_from");
          if (!sid || !token || !from) throw new Error("Twilio: missing credentials");
          const auth = btoa(`${sid}:${token}`);
          const body = new URLSearchParams({ To: `whatsapp:${waNumber}`, From: `whatsapp:${from}`, Body: msgBody });
          const r = await fetchWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
            method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body,
          });
          const data = await safeJson(r);
          if (!r.ok) throw new Error(`Twilio failed (${r.status}): ${JSON.stringify(data).slice(0, 300)}`);
          result.whatsapp = { provider: "twilio", ok: true };
        } else {
          result.whatsapp = { provider: "link", link: `https://wa.me/${waNumber.replace(/\D/g, "")}?text=${encodeURIComponent(msgBody)}` };
        }
      } catch (e: any) {
        console.error("whatsapp send failed", e?.message);
        result.whatsapp = { provider: waMode, ok: false, error: e.message };
      }
    }

    console.log("handoff completed", JSON.stringify(result));
  } catch (e: any) {
    console.error("handoff failed", e?.message || e);
  }
}
