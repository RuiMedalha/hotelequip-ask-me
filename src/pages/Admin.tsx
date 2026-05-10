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
import { WebhooksTab } from "@/components/admin/WebhooksTab";

type Settings = Record<string, any>;

const ANTHROPIC_MODELS = ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"];
const OPENAI_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"];

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
  const [kbStats, setKbStats] = useState<{ total: number; by_type: Record<string, number> } | null>(null);
  const [kbUrl, setKbUrl] = useState("");

  const load = async () => {
    const { data } = await supabase.from("bot_settings").select("key,value");
    const out: Settings = {};
    for (const r of data || []) out[r.key] = r.value;
    setSettings(out);
    const list = await callFn("admin-secrets", { action: "list" });
    setSecrets(Array.isArray(list) ? list : []);
  };

  useEffect(() => { if (isAdmin) { load(); loadKbStats(); } }, [isAdmin]);

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
  const testChatwoot = async () => {
    const tok = prompt("Cola o Chatwoot API access token (não é guardado agora):") || "";
    if (!tok) return;
    const r = await callFn("test-chatwoot", {
      url: settings.chatwoot_url,
      account_id: settings.chatwoot_account_id,
      inbox_id: settings.chatwoot_inbox_id,
      api_token: tok,
    });
    toast({
      title: r.ok ? "Chatwoot OK ✅" : `Falhou (${r.step || "?"})`,
      description: r.ok ? r.message : JSON.stringify(r.error || r).slice(0, 250),
    });
  };


  const loadKbStats = async () => {
    try {
      const r = await callFn("ingest-knowledge", { action: "stats" });
      if (r && typeof r.total === "number") setKbStats({ total: r.total, by_type: r.by_type || {} });
    } catch {}
  };

  const ingestWoo = async () => {
    setBusy(true);
    try {
      const r = await callFn("ingest-knowledge", { action: "ingest_woo" });
      if (r?.ok) {
        toast({ title: "Produtos carregados", description: `${r.ingested ?? 0} produtos` });
        await loadKbStats();
      } else {
        toast({ title: "Falhou", description: String(r?.error || JSON.stringify(r)).slice(0, 250) });
      }
    } catch (e: any) {
      toast({ title: "Falhou", description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const ingestUrl = async () => {
    if (!kbUrl) return;
    setBusy(true);
    try {
      const r = await callFn("ingest-knowledge", { action: "ingest_url", url: kbUrl, source_type: "page" });
      if (r?.ok) {
        toast({ title: "Página carregada", description: `${r.ingested ?? 0} chunks${r.title ? ` — ${r.title}` : ""}` });
        setKbUrl("");
        await loadKbStats();
      } else {
        toast({ title: "Falhou", description: String(r?.error || JSON.stringify(r)).slice(0, 250) });
      }
    } catch (e: any) {
      toast({ title: "Falhou", description: e?.message });
    } finally {
      setBusy(false);
    }
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
          <TabsTrigger value="kb">Knowledge Base</TabsTrigger>
          <TabsTrigger value="woo">WooCommerce & Meili</TabsTrigger>
          <TabsTrigger value="handoff">Handoff</TabsTrigger>
          <TabsTrigger value="automations">Automações</TabsTrigger>
        </TabsList>

        <TabsContent value="ai">
          <Card className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Provider</Label>
                <select
                  className="w-full border rounded h-10 px-2 bg-background"
                  value={settings.ai_provider || "openai"}
                  onChange={e => {
                    const p = e.target.value;
                    set("ai_provider", p);
                    if (p === "anthropic") {
                      set("ai_base_url", "https://api.anthropic.com/v1");
                      if (!ANTHROPIC_MODELS.includes(settings.ai_model)) set("ai_model", "claude-sonnet-4-5");
                    } else {
                      set("ai_base_url", "https://api.openai.com/v1");
                      if (!OPENAI_MODELS.includes(settings.ai_model)) set("ai_model", "gpt-4o-mini");
                    }
                  }}
                >
                  <option value="openai">OpenAI / Compatível</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>
              <div><Label>Base URL</Label><Input value={settings.ai_base_url || ""} onChange={e => set("ai_base_url", e.target.value)} placeholder={(settings.ai_provider || "openai") === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"} /></div>
              <div>
                <Label>Modelo</Label>
                {(() => {
                  const provider = settings.ai_provider || "openai";
                  const list = provider === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;
                  const isCustom = settings.ai_model && !list.includes(settings.ai_model);
                  return (
                    <>
                      <select
                        className="w-full border rounded h-10 px-2 bg-background"
                        value={isCustom ? "__custom__" : (settings.ai_model || list[0])}
                        onChange={e => {
                          if (e.target.value === "__custom__") set("ai_model", "");
                          else set("ai_model", e.target.value);
                        }}
                      >
                        {list.map(m => <option key={m} value={m}>{m}</option>)}
                        <option value="__custom__">Custom…</option>
                      </select>
                      {(isCustom || !settings.ai_model) && (
                        <Input
                          className="mt-2"
                          value={settings.ai_model || ""}
                          onChange={e => set("ai_model", e.target.value)}
                          placeholder="nome do modelo custom"
                        />
                      )}
                    </>
                  );
                })()}
              </div>
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

        <TabsContent value="kb">
          <Card className="p-6 space-y-4">
            <div>
              <h3 className="font-semibold">📚 Knowledge Base</h3>
              {kbStats ? (
                <p className="text-sm text-muted-foreground">
                  {kbStats.total} itens
                  {Object.keys(kbStats.by_type).length > 0 && " — "}
                  {Object.entries(kbStats.by_type).map(([k, v]) => `${v} ${k}`).join(" · ")}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">A carregar estatísticas…</p>
              )}
            </div>

            <div className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-medium">Produtos WooCommerce</div>
                <Button size="sm" onClick={ingestWoo} disabled={busy}>
                  🔄 Carregar Produtos
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Ingere todos os produtos do WooCommerce usando as credenciais já configuradas.
              </p>
            </div>

            <div className="border rounded-lg p-4 space-y-2">
              <div className="font-medium">Páginas do Site</div>
              <div className="flex gap-2">
                <Input
                  placeholder="https://hotelequip.pt/sobre-nos"
                  value={kbUrl}
                  onChange={e => setKbUrl(e.target.value)}
                />
                <Button size="sm" onClick={ingestUrl} disabled={busy || !kbUrl}>
                  🌐 Carregar Página
                </Button>
              </div>
            </div>

            {kbStats && (
              <div className="text-xs text-muted-foreground border-t pt-3">
                Itens na base:{" "}
                {Object.entries(kbStats.by_type).map(([k, v]) => `${k} (${v})`).join(" · ") || "vazio"}
              </div>
            )}
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
            <div>
              <Label>Website Inbox Token (websiteToken do snippet)</Label>
              <Input
                value={settings.chatwoot_website_token || ""}
                onChange={e => set("chatwoot_website_token", e.target.value)}
                placeholder="ex: eMAT2hYaq7ccaSB3g3pm3nHu"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Usado quando o cliente <strong>não tem telemóvel</strong> — o chat passa para um agente humano dentro do widget, via Chatwoot Website API.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={testChatwoot}>Testar Chatwoot</Button>
            <hr />
            <h3 className="font-semibold">WhatsApp</h3>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Número (com indicativo)</Label><Input value={settings.whatsapp_number || ""} onChange={e => set("whatsapp_number", e.target.value)} placeholder="+351912345678" /></div>
              <div><Label>Modo</Label>
                <select className="w-full border rounded h-10 px-2 bg-background" value={settings.whatsapp_mode || "link"} onChange={e => set("whatsapp_mode", e.target.value)}>
                  <option value="link">Link wa.me (manual)</option>
                  <option value="meta">Meta Cloud API (oficial)</option>
                  <option value="ycloud">YCloud</option>
                  <option value="evolution">Evolution API (self-hosted)</option>
                  <option value="twilio">Twilio</option>
                </select>
              </div>
            </div>
            <div>
              <Label>Número interno da equipa (notificações)</Label>
              <Input
                value={settings.whatsapp_team_number || ""}
                onChange={e => set("whatsapp_team_number", e.target.value)}
                placeholder="+351916542271"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Número para notificações internas quando há handoff. Diferente do número público da HotelEquip.
              </p>
            </div>
            {settings.whatsapp_mode === "meta" && (
              <>
                <div><Label>Phone Number ID</Label><Input value={settings.meta_wa_phone_number_id || ""} onChange={e => set("meta_wa_phone_number_id", e.target.value)} placeholder="ex: 123456789012345" /></div>
                <div><Label>Template name (opcional, para fora da janela 24h)</Label><Input value={settings.meta_wa_template || ""} onChange={e => set("meta_wa_template", e.target.value)} placeholder="ex: handoff_notification" /></div>
                <div><Label>Template language</Label><Input value={settings.meta_wa_template_lang || "pt_PT"} onChange={e => set("meta_wa_template_lang", e.target.value)} /></div>
                <SecretField keyName="meta_wa_access_token" label="Meta WhatsApp Access Token" />
              </>
            )}
            {settings.whatsapp_mode === "ycloud" && (
              <>
                <div><Label>From (número WhatsApp registado na YCloud)</Label><Input value={settings.ycloud_from || ""} onChange={e => set("ycloud_from", e.target.value)} placeholder="+351912345678" /></div>
                <SecretField keyName="ycloud_api_key" label="YCloud API Key" />
              </>
            )}
            {settings.whatsapp_mode === "evolution" && (
              <>
                <div><Label>Base URL</Label><Input value={settings.evolution_url || ""} onChange={e => set("evolution_url", e.target.value)} placeholder="https://evolution.exemplo.com" /></div>
                <div><Label>Instance name</Label><Input value={settings.evolution_instance || ""} onChange={e => set("evolution_instance", e.target.value)} placeholder="ex: hotelequip" /></div>
                <SecretField keyName="evolution_api_key" label="Evolution API Key" />
              </>
            )}
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

        <TabsContent value="automations">
          <Card className="p-6">
            <WebhooksTab />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
