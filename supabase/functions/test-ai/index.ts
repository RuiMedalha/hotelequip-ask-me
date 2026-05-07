import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/admin.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const { provider, base_url, model, api_key } = await req.json();
    if (provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
      });
      return new Response(JSON.stringify({ ok: r.ok, status: r.status, body: await r.text() }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const r = await fetch(`${base_url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${api_key}` },
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
    });
    return new Response(JSON.stringify({ ok: r.ok, status: r.status, body: (await r.text()).slice(0, 500) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
