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

function normalizePhone(phone?: string | null) {
  const compact = String(phone || "").replace(/[^+\d]/g, "");
  if (!compact) return null;
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.length === 9 && compact.startsWith("9")) return `+351${compact}`;
  return `+${compact}`;
}

function pickFirst(pattern: RegExp, text: string) {
  const match = text.match(pattern);
  return match?.[1]?.trim() || match?.[0]?.trim() || null;
}

function getChatwootContactId(contact: any) {
  return contact?.payload?.contact?.id || contact?.payload?.id || contact?.id || null;
}

function getChatwootContactInboxes(contact: any): any[] {
  return contact?.payload?.contact?.contact_inboxes || contact?.payload?.contact_inboxes || contact?.contact_inboxes || [];
}

async function findExistingChatwootContact(base: string, accountId: any, token: string, queries: (string | null | undefined)[], phone?: string | null, email?: string | null) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = String(email || "").toLowerCase();
  for (const query of queries.filter(Boolean)) {
    const searchRes = await fetchWithTimeout(`${base}/api/v1/accounts/${accountId}/contacts/search?q=${encodeURIComponent(String(query))}&page=1`, {
      headers: { api_access_token: token },
    });
    const data = await safeJson(searchRes);
    if (!searchRes.ok) continue;
    const contacts = Array.isArray(data?.payload) ? data.payload : [];
    const exact = contacts.find((c: any) => {
      const contactPhone = normalizePhone(c.phone_number);
      const contactEmail = String(c.email || "").toLowerCase();
      return (normalizedPhone && contactPhone === normalizedPhone) || (normalizedEmail && contactEmail === normalizedEmail);
    });
    if (exact || contacts[0]) return exact || contacts[0];
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { conversation_id, reason, summary, channel } = await req.json();
    if (!conversation_id) {
      return new Response(JSON.stringify({ error: "conversation_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const job = processHandoff(conversation_id, reason, summary, channel);
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(job);
    else job.catch((e) => console.error("handoff background fail", e));

    return new Response(JSON.stringify({ ok: true, status: "queued" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function processHandoff(conversation_id: string, reason?: string, summary?: string, channelArg?: string) {
  try {
    const admin = adminClient();
    const settings = await getSettings();

    const { data: conv } = await admin.from("conversations").select("*, leads(*)").eq("id", conversation_id).maybeSingle();
    const { data: msgs } = await admin.from("messages").select("role,content,created_at").eq("conversation_id", conversation_id).order("created_at");

    const transcript = (msgs || []).map((m: any) => `[${m.role}] ${m.content}`).join("\n");
    const lead = (conv as any)?.leads;
    const summaryText = String(summary || "");
    const inferred = {
      name: lead?.name || pickFirst(/cliente,?\s+([^,\.\n]+?)(?:,|\s+está|\s+deseja|\s+quer)/i, summaryText) || pickFirst(/\bnome:\s*([^\n]+)/i, summaryText),
      email: lead?.email || pickFirst(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, `${summaryText}\n${transcript}`),
      phone: normalizePhone(lead?.phone || pickFirst(/(?:\+|00)?\d[\d\s().-]{7,}\d/, `${summaryText}\n${transcript}`)),
      interest: lead?.interest || summaryText || reason || null,
    };
    if (conv && (!lead?.name || !lead?.email || !lead?.phone || !lead?.interest) && (inferred.name || inferred.email || inferred.phone || inferred.interest)) {
      const payload = { conversation_id, ...inferred };
      if (lead?.id) await admin.from("leads").update(payload).eq("id", lead.id);
      else {
        const { data: created } = await admin.from("leads").insert(payload).select("id").single();
        if (created?.id) await admin.from("conversations").update({ lead_id: created.id }).eq("id", conversation_id);
      }
    }
    const leadInfo = `Nome: ${inferred.name || "—"}\nEmail: ${inferred.email || "—"}\nTelefone: ${inferred.phone || "—"}\nInteresse: ${inferred.interest || "—"}`;
    const fullText = `🤖 Nova conversa para humano\n\nMotivo: ${reason}\nResumo: ${summary || "—"}\n\n${leadInfo}\n\n--- Transcrição ---\n${transcript}`;

    const result: any = {};
    const hasPhone = !!(inferred.phone && /^\+?\d{8,}$/.test(String(inferred.phone).replace(/\s/g, "")));

    // ===== Chatwoot =====
    const cwUrl = (settings.chatwoot_url || "").replace(/\/$/, "");
    const cwAcc = settings.chatwoot_account_id;
    const cwInbox = settings.chatwoot_inbox_id;
    const cwToken = await getSecret("chatwoot_api_token");
    const websiteToken = settings.chatwoot_website_token;

    // Path A: Website Public API -> a conversa aparece no Chatwoot e continua dentro do widget
    if (cwUrl && websiteToken) {
      try {
        const sourceId = `he-visitor-${conv?.visitor_id || conversation_id}`;
        const contactRes = await fetchWithTimeout(`${cwUrl}/public/api/v1/inboxes/${websiteToken}/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_id: sourceId,
            name: inferred.name || `Visitante ${conv?.visitor_id?.slice(0, 8)}`,
            email: inferred.email || undefined,
            phone_number: inferred.phone || undefined,
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

    // Path B: fallback via admin API se não houver Website token configurado
    if (!result.chatwoot?.ok && hasPhone && cwUrl && cwAcc && cwInbox && cwToken) {
      try {
        const contactPayload = {
          inbox_id: Number(cwInbox),
          name: inferred.name || `Visitante ${conv?.visitor_id?.slice(0, 8)}`,
          email: inferred.email || undefined,
          phone_number: inferred.phone,
          identifier: conv?.visitor_id,
        };
        const contactRes = await fetchWithTimeout(`${cwUrl}/api/v1/accounts/${cwAcc}/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", api_access_token: cwToken },
          body: JSON.stringify(contactPayload),
        });
        let contact = await safeJson(contactRes);
        if (!contactRes.ok) {
          const existing = await findExistingChatwootContact(cwUrl, cwAcc, cwToken, [inferred.phone, inferred.email], inferred.phone, inferred.email);
          if (!existing) throw new Error(`Chatwoot contact failed (${contactRes.status}): ${JSON.stringify(contact).slice(0, 300)}`);
          contact = { payload: { contact: existing } };
        }
        const contactId = getChatwootContactId(contact);
        let sourceId = contact.payload?.contact_inbox?.source_id || getChatwootContactInboxes(contact).find((ci: any) => String(ci.inbox?.id) === String(cwInbox))?.source_id;
        if (!sourceId && contactId) {
          const contactInboxRes = await fetchWithTimeout(`${cwUrl}/api/v1/accounts/${cwAcc}/contacts/${contactId}/contact_inboxes`, {
            method: "POST",
            headers: { "Content-Type": "application/json", api_access_token: cwToken },
            body: JSON.stringify({ inbox_id: Number(cwInbox), source_id: `he-${conversation_id}` }),
          });
          const contactInbox = await safeJson(contactInboxRes);
          if (!contactInboxRes.ok) throw new Error(`Chatwoot contact inbox failed (${contactInboxRes.status}): ${JSON.stringify(contactInbox).slice(0, 300)}`);
          sourceId = contactInbox.source_id;
        }
        if (!sourceId || !contactId) throw new Error("Chatwoot contact missing source_id/contact_id");
        const convRes = await fetchWithTimeout(`${cwUrl}/api/v1/accounts/${cwAcc}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", api_access_token: cwToken },
          body: JSON.stringify({
            source_id: String(sourceId), inbox_id: Number(cwInbox),
            contact_id: contactId,
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
        await admin.from("conversations").update({
          mode: "human",
          status: "handoff",
          chatwoot_conversation_id: cwConv.id,
          chatwoot_contact_id: contactId,
          chatwoot_source_id: String(sourceId),
        }).eq("id", conversation_id);
        result.chatwoot = { ok: true, channel: "phone-inbox", conversation_id: cwConv.id };
      } catch (e: any) { result.chatwoot = { ok: false, channel: "phone-inbox", error: e.message }; }
    }

    if (!result.chatwoot) {
      result.chatwoot = { ok: false, error: "Chatwoot not configured: missing chatwoot_url/chatwoot_website_token or admin API settings" };
    }

    // ===== WhatsApp =====
    // Determinar canal escolhido pelo cliente (com fallback à coluna conversations.channel)
    let channel = (channelArg as string) || (conv as any)?.channel || "chat";
    // Se o cliente escolheu WhatsApp mas não temos telefone válido, cair para chat (o bot deve voltar a perguntar)
    if (channel === "whatsapp" && !hasPhone) {
      channel = "chat";
      result.whatsapp_client = { ok: false, error: "missing_phone, fell back to chat" };
      await admin.from("conversations").update({ channel: "chat" }).eq("id", conversation_id);
    }

    const teamWaNumber = settings.whatsapp_number;            // número INTERNO da equipa (notificação)
    const waMode = settings.whatsapp_mode || "link";
    const msgBody = fullText.slice(0, 1500);

    // Helper: envio Meta template/text para um destinatário específico
    async function sendMeta(to: string, opts: { isClient: boolean }) {
      const token = await getSecret("meta_wa_access_token") || await getSecret("meta_wa_token");
      const phoneId = settings.meta_wa_phone_number_id;
      const template = settings.meta_wa_template;
      const lang = settings.meta_wa_template_lang || "pt_PT";
      if (!token || !phoneId) throw new Error("Meta: missing access_token or phone_number_id");
      const sanitizeWa = (s: string) => s.replace(/[\n\r\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 700);
      const bodyText = opts.isClient
        ? sanitizeWa(`Olá ${inferred.name || ""}, é a equipa HotelEquip. Recebemos o seu pedido: ${inferred.interest || reason || "—"}. Estamos a preparar resposta.`)
        : sanitizeWa(msgBody);
      const components: any[] = [{ type: "body", parameters: [{ type: "text", text: bodyText }] }];
      const cwConvId = result.chatwoot?.conversation_id;
      components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: String(cwConvId || conversation_id).slice(0, 15) }] });
      const payload: any = template
        ? { messaging_product: "whatsapp", to: to.replace(/\D/g, ""), type: "template", template: { name: template, language: { code: lang }, components } }
        : { messaging_product: "whatsapp", to: to.replace(/\D/g, ""), type: "text", text: { body: bodyText } };
      const r = await fetchWithTimeout(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(`Meta WA failed (${r.status}): ${JSON.stringify(data).slice(0, 300)}`);
      return data;
    }

    // 1) Se canal=whatsapp e há telefone do cliente válido -> envia template ao CLIENTE
    if (channel === "whatsapp" && hasPhone) {
      try {
        await sendMeta(inferred.phone!, { isClient: true });
        result.whatsapp_client = { provider: "meta", ok: true, to: inferred.phone };
      } catch (e: any) {
        console.error("meta wa to client failed", e?.message);
        result.whatsapp_client = { provider: "meta", ok: false, error: e.message };
      }
    }

    // 2) Notificação interna à equipa (mantém comportamento existente)
    if (teamWaNumber) {
      try {
        if (waMode === "meta") {
          await sendMeta(teamWaNumber, { isClient: false });
          result.whatsapp = { provider: "meta", ok: true };
        } else if (waMode === "ycloud") {
          const apiKey = await getSecret("ycloud_api_key");
          const from = settings.ycloud_from;
          if (!apiKey || !from) throw new Error("YCloud: missing api_key or from");
          const r = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages`, {
            method: "POST",
            headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: teamWaNumber, type: "text", text: { body: msgBody } }),
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
            body: JSON.stringify({ number: teamWaNumber.replace(/\D/g, ""), text: msgBody }),
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
          const body = new URLSearchParams({ To: `whatsapp:${teamWaNumber}`, From: `whatsapp:${from}`, Body: msgBody });
          const r = await fetchWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
            method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body,
          });
          const data = await safeJson(r);
          if (!r.ok) throw new Error(`Twilio failed (${r.status}): ${JSON.stringify(data).slice(0, 300)}`);
          result.whatsapp = { provider: "twilio", ok: true };
        } else {
          result.whatsapp = { provider: "link", link: `https://wa.me/${teamWaNumber.replace(/\D/g, "")}?text=${encodeURIComponent(msgBody)}` };
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
