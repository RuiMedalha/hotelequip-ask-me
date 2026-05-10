import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient, getSettings } from "../_shared/admin.ts";

async function safeJson(res: Response) {
  const t = await res.text();
  try { return t ? JSON.parse(t) : {}; } catch { return { raw: t }; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { conversation_id, action, content } = await req.json();
    if (!conversation_id || !action) throw new Error("conversation_id and action required");

    const admin = adminClient();
    const settings = await getSettings();
    const cwUrl = (settings.chatwoot_url || "").replace(/\/$/, "");
    const websiteToken = settings.chatwoot_website_token;

    const { data: conv } = await admin
      .from("conversations")
      .select("id, mode, chatwoot_conversation_id, chatwoot_source_id, chatwoot_pubsub_token, chatwoot_last_message_id")
      .eq("id", conversation_id)
      .maybeSingle();

    if (action === "status") {
      return new Response(JSON.stringify({ ok: true, mode: (conv as any)?.mode || "bot" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!cwUrl || !websiteToken) throw new Error("Chatwoot website token not configured");
    if (!conv?.chatwoot_conversation_id || !conv?.chatwoot_source_id) {
      throw new Error("Conversa ainda não tem ligação Chatwoot (handoff não executado)");
    }

    const base = `${cwUrl}/public/api/v1/inboxes/${websiteToken}/contacts/${conv.chatwoot_source_id}/conversations/${conv.chatwoot_conversation_id}`;

    if (action === "send") {
      if (!content) throw new Error("content required");
      const r = await fetch(`${base}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(`Chatwoot send failed (${r.status}): ${JSON.stringify(data).slice(0, 300)}`);
      // mirror visitor message into our messages table
      await admin.from("messages").insert({ conversation_id, role: "user", content });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "poll") {
      // If we don't have a pubsub_token, the conversation was created via admin API and the public endpoint will 404.
      if (!conv.chatwoot_pubsub_token) {
        return new Response(JSON.stringify({ ok: true, fallback: true, reason: "no_pubsub_token", new_messages: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const r = await fetch(`${base}/messages`, { headers: { "Content-Type": "application/json" } });
      const data = await safeJson(r);
      if (!r.ok) {
        // Conversation likely created via private API (no public pubsub link) — degrade gracefully
        console.warn(`Chatwoot poll ${r.status}:`, JSON.stringify(data).slice(0, 200));
        return new Response(JSON.stringify({
          ok: false,
          fallback: true,
          status: r.status,
          new_messages: [],
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const messages: any[] = Array.isArray(data) ? data : (data.payload || data.data || []);
      // Chatwoot message_type: 0 = incoming (visitor), 1 = outgoing (agent), 2 = activity, 3 = template
      const lastSeen = Number(conv.chatwoot_last_message_id || 0);
      const newOutgoing = messages
        .filter((m) => Number(m.id) > lastSeen && (m.message_type === 1 || m.message_type === "outgoing") && !m.private && m.content)
        .sort((a, b) => Number(a.id) - Number(b.id));

      if (newOutgoing.length) {
        const maxId = Math.max(...messages.map((m) => Number(m.id) || 0));
        await admin.from("conversations").update({ chatwoot_last_message_id: maxId }).eq("id", conversation_id);
        for (const m of newOutgoing) {
          await admin.from("messages").insert({ conversation_id, role: "assistant", content: m.content });
        }
      }
      return new Response(JSON.stringify({
        ok: true,
        new_messages: newOutgoing.map((m) => ({ id: m.id, content: m.content, created_at: m.created_at })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`unknown action: ${action}`);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
