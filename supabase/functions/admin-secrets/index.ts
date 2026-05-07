import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient, requireAdmin } from "../_shared/admin.ts";

// Single endpoint to upsert / delete secrets (admin only)
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const supa = adminClient();
  try {
    const body = await req.json();
    if (body.action === "list") {
      const { data } = await supa.from("bot_secrets").select("key,value");
      // mask values
      const masked = (data || []).map((s: any) => ({ key: s.key, masked: s.value ? `••••${s.value.slice(-4)}` : "" }));
      return new Response(JSON.stringify(masked), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (body.action === "set") {
      await supa.from("bot_secrets").upsert({ key: body.key, value: body.value, updated_at: new Date().toISOString() });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (body.action === "delete") {
      await supa.from("bot_secrets").delete().eq("key", body.key);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response("bad action", { status: 400, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
