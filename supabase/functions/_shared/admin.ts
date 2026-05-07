import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
}

export async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } }
  );
  const token = auth.replace("Bearer ", "");
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) return new Response("Unauthorized", { status: 401 });
  const admin = adminClient();
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", data.user.id);
  if (!roles?.some((r: any) => r.role === "admin")) return new Response("Forbidden", { status: 403 });
  return { userId: data.user.id };
}

export async function getSettings(): Promise<Record<string, any>> {
  const admin = adminClient();
  const { data } = await admin.from("bot_settings").select("key,value");
  const out: Record<string, any> = {};
  for (const row of data ?? []) out[row.key] = row.value;
  return out;
}

export async function getSecret(key: string): Promise<string | null> {
  const admin = adminClient();
  const { data } = await admin.from("bot_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
