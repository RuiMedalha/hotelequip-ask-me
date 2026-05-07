import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/admin.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const { store_url, consumer_key, consumer_secret } = await req.json();
    const url = `${store_url.replace(/\/$/, "")}/wp-json/wc/v3/products?per_page=3&consumer_key=${consumer_key}&consumer_secret=${consumer_secret}`;
    const r = await fetch(url);
    const data = r.ok ? await r.json() : await r.text();
    return new Response(JSON.stringify({ ok: r.ok, status: r.status, sample: r.ok ? (data as any[]).map((p: any) => ({ id: p.id, name: p.name, price: p.price })) : data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
