import { useEffect, useState } from "react";
import { supabase, FUNCTIONS_URL } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

type Settings = Record<string, any>;

async function callFn(path: string, body: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(`${FUNCTIONS_URL}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  return r.json();
}

export default function Admin() {
  const { session, isAdmin, loading } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings>({});
  const [secrets, setSecrets] = useState<{ key: string; masked: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("bot_settings").select("key,value");
    const out: Settings = {};
    for (const r of data || []) out[r.key] = r.value;
    setSettings(out);
    const list = await callFn("admin-secrets", { action: "list" });
    setSecrets(Array.isArray(list) ? list : []);
  };

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (loading) return <div className="p-8">A carregar…</div>;
  if (!session) return <Navigate to="/admin/login" replace />;
  if (!isAdmin) return <div className="p-8">Sem permissões de admin.</div>;

  const set = (k: string, v: any) => setSettings(s => ({ ...s, [k]: v }));

  const saveSettings = async () => {
    setBusy(true);
    const rows = Object.entries(settings).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
    const { error } = await supabase.from("bot_settings").upsert(rows);
    setBusy(false);
    toast({ title: error ? "Erro" : "Guardado", description: error?.message });
  };

  const setSecret = async (key: string, value: string) => {
    if (!value) return;
    await callFn("admin-secrets", { action: "set", key, value });
    toast({ title: "Secret guardada" });
    await load();
  };

  const testAi = async () => {
    const r = await callFn("test-ai", {
      provider: settings.ai_provider, base_url: settings.ai_base_url,
      model: settings.ai_model, api_key: prompt("Cola a API key para testar (não é guardada agora):") || "",
    });
    toast({ title: r.ok ? "Ligação OK" : "Falhou", description: String(r.body || r.error || r.status).slice(0, 200) });
  };
  const testWoo = async () => {
    const ck = prompt("Consumer key:") || "";
    const cs = prompt("Consumer secret:") || "";
    const r = await callFn("test-woocommerce", { store_url: settings.woo_store_url, consumer_key: ck, consumer_secret: cs });
    toast({ title: r.ok ? "WC OK" : "WC falhou", description: JSON.stringify(r.sample || r).slice(0, 200) });
  };

  const SecretField = ({ keyName, label, placeholder }: { keyName: string; label: string; placeholder?: string }) => {
    const [v, setV] = useState("");
    const existing = secrets.find(s => s.key === keyName);
    return (
      <div className="space-y-1">
        <Label>{label} {existing && <span className="text-xs text-muted-foreground">(actual: {existing.masked})</span>}</Label>
        <div className="flex gap-2">
          <Input type="password" placeholder={placeholder || "nova key"} value={v} onChange={e => setV(e.target.value)} />
          <Button size="sm" onClick={() => { setSecret(keyName, v); setV(""); }}>Guardar</Button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Admin · Chatbot HotelEquip</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link to="/admin/conversations">Conversas & Leads</Link></Button>
          <Button variant="ghost" onClick={() => supabase.auth.signOut()}>Sair</Button>
        </div>
      </div>

      <Tabs defaultValue="ai">
        <TabsList>
          <TabsTrigger value="ai">AI Provider</TabsTrigger>
          <TabsTrigger value="prompts">Prompts</TabsTrigger>
          <TabsTrigger value="woo">WooCommerce & Meili</TabsTrigger>
          <TabsTrigger value="handoff">Handoff</TabsTrigger>
        </TabsList>

        <TabsContent value="ai">
          <Card className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Provider</Label>
                <select className="w-full border rounded h-10 px-2 bg-background" value={settings.ai_provider || "openai"} onChange={e => set("ai_provider", e.target.value)}>
                  <option value="openai">OpenAI / Compatível</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>
              <div><Label>Base URL</Label><Input value={settings.ai_base_url || ""} onChange={e => set("ai_base_url", e.target.value)} placeholder="https://api.openai.com/v1" /></div>
              <div><Label>Modelo</Label><Input value={settings.ai_model || ""} onChange={e => set("ai_model", e.target.value)} placeholder="gpt-4o-mini" /></div>
              <div><Label>Temperature</Label><Input type="number" step="0.1" value={settings.ai_temperature ?? 0.7} onChange={e => set("ai_temperature", Number(e.target.value))} /></div>
              <div><Label>Max tokens</Label><Input type="number" value={settings.ai_max_tokens ?? 1024} onChange={e => set("ai_max_tokens", Number(e.target.value))} /></div>
            </div>
            <SecretField keyName="ai_api_key" label="API Key" placeholder="sk-…" />
            <div className="flex gap-2">
              <Button onClick={saveSettings} disabled={busy}>Guardar</Button>
              <Button variant="outline" onClick={testAi}>Testar ligação</Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="prompts">
          <Card className="p-6 space-y-4">
            <div><Label>System prompt</Label><Textarea rows={8} value={settings.system_prompt || ""} onChange={e => set("system_prompt", e.target.value)} /></div>
            <div><Label>Mensagem de boas-vindas</Label><Textarea rows={2} value={settings.welcome_message || ""} onChange={e => set("welcome_message", e.target.value)} /></div>
            <div><Label>Mensagem de handoff</Label><Textarea rows={2} value={settings.handoff_message || ""} onChange={e => set("handoff_message", e.target.value)} /></div>
            <div><Label>Palavras-gatilho (separadas por vírgula)</Label>
              <Input value={(settings.handoff_keywords || []).join(", ")} onChange={e => set("handoff_keywords", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} />
            </div>
            <Button onClick={saveSettings} disabled={busy}>Guardar</Button>
          </Card>
        </TabsContent>

        <TabsContent value="woo">
          <Card className="p-6 space-y-4">
            <div><Label>Store URL</Label><Input value={settings.woo_store_url || ""} onChange={e => set("woo_store_url", e.target.value)} placeholder="https://hotelequip.pt" /></div>
            <SecretField keyName="woo_consumer_key" label="WooCommerce Consumer Key" />
            <SecretField keyName="woo_consumer_secret" label="WooCommerce Consumer Secret" />
            <hr />
            <h3 className="font-semibold">Meilisearch</h3>
            <SecretField keyName="meilisearch_host" label="Meilisearch Host (URL)" />
            <SecretField keyName="meilisearch_api_key" label="Meilisearch API Key" />
            <div className="flex gap-2">
              <Button onClick={saveSettings} disabled={busy}>Guardar</Button>
              <Button variant="outline" onClick={testWoo}>Testar WooCommerce</Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="handoff">
          <Card className="p-6 space-y-4">
            <h3 className="font-semibold">Chatwoot self-hosted</h3>
            <div><Label>URL</Label><Input value={settings.chatwoot_url || ""} onChange={e => set("chatwoot_url", e.target.value)} placeholder="https://chat.exemplo.com" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Account ID</Label><Input value={settings.chatwoot_account_id || ""} onChange={e => set("chatwoot_account_id", e.target.value)} /></div>
              <div><Label>Inbox ID</Label><Input value={settings.chatwoot_inbox_id || ""} onChange={e => set("chatwoot_inbox_id", e.target.value)} /></div>
            </div>
            <SecretField keyName="chatwoot_api_token" label="Chatwoot API Access Token" />
            <hr />
            <h3 className="font-semibold">WhatsApp</h3>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Número (com indicativo)</Label><Input value={settings.whatsapp_number || ""} onChange={e => set("whatsapp_number", e.target.value)} placeholder="+351912345678" /></div>
              <div><Label>Modo</Label>
                <select className="w-full border rounded h-10 px-2 bg-background" value={settings.whatsapp_mode || "link"} onChange={e => set("whatsapp_mode", e.target.value)}>
                  <option value="link">Link wa.me (notificação)</option>
                  <option value="twilio">Twilio API (envio automático)</option>
                </select>
              </div>
            </div>
            {settings.whatsapp_mode === "twilio" && (
              <>
                <SecretField keyName="twilio_account_sid" label="Twilio Account SID" />
                <SecretField keyName="twilio_auth_token" label="Twilio Auth Token" />
                <SecretField keyName="twilio_whatsapp_from" label="Twilio WhatsApp From (ex: +14155238886)" />
              </>
            )}
            <Button onClick={saveSettings} disabled={busy}>Guardar</Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
