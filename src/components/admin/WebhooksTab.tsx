import { useEffect, useState } from "react";
import { supabase, FUNCTIONS_URL } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

type WebhookConfig = {
  id: string;
  name: string;
  description: string | null;
  event: string;
  url: string | null;
  method: string | null;
  is_active: boolean;
  mautic_segment_id: string | null;
  notes: string | null;
  last_triggered_at: string | null;
  last_status: number | null;
};

const EVENTS = [
  "newsletter_subscribe",
  "lead_created",
  "lead_updated",
  "handoff_requested",
  "handoff_whatsapp",
  "handoff_chat",
  "conversation_started",
  "product_interest",
];

const EVENT_COLORS: Record<string, string> = {
  newsletter_subscribe: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  lead_created: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30",
  lead_updated: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  handoff_requested: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  handoff_whatsapp: "bg-[#25D366]/15 text-[#1a8a45] dark:text-[#25D366] border-[#25D366]/30",
  handoff_chat: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
  conversation_started: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  product_interest: "bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30",
};

async function callFn(path: string, body: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(`${FUNCTIONS_URL}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  return r.json();
}

export function WebhooksTab() {
  const { toast } = useToast();
  const [hooks, setHooks] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ name: "", event: EVENTS[0], url: "", notes: "" });
  const [urls, setUrls] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("webhook_configs")
      .select("*")
      .order("event");
    if (error) {
      toast({ title: "Erro a carregar webhooks", description: error.message });
    } else {
      const list = (data || []) as WebhookConfig[];
      setHooks(list);
      setUrls(Object.fromEntries(list.map(h => [h.id, h.url || ""])));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveUrl = async (h: WebhookConfig) => {
    const newUrl = urls[h.id] ?? "";
    const { error } = await supabase
      .from("webhook_configs")
      .update({ url: newUrl || null })
      .eq("id", h.id);
    toast({ title: error ? "Erro" : "URL guardado", description: error?.message });
    if (!error) load();
  };

  const toggleActive = async (h: WebhookConfig, value: boolean) => {
    const { error } = await supabase
      .from("webhook_configs")
      .update({ is_active: value })
      .eq("id", h.id);
    if (error) toast({ title: "Erro", description: error.message });
    else load();
  };

  const testHook = async (h: WebhookConfig) => {
    const r = await callFn("trigger-webhook", {
      event: h.event,
      payload: { name: "Teste", email: "teste@hotelequip.pt", source: "admin_test", test: true },
    });
    toast({
      title: r?.ok ? "Disparado ✅" : "Falhou",
      description: String(r?.status ?? r?.error ?? JSON.stringify(r)).slice(0, 250),
    });
    load();
  };

  const createHook = async () => {
    if (!draft.name.trim()) {
      toast({ title: "Nome obrigatório" });
      return;
    }
    const { error } = await supabase.from("webhook_configs").insert({
      name: draft.name.trim(),
      event: draft.event,
      url: draft.url.trim() || null,
      notes: draft.notes.trim() || null,
      method: "POST",
      is_active: true,
    });
    if (error) {
      toast({ title: "Erro", description: error.message });
      return;
    }
    setDraft({ name: "", event: EVENTS[0], url: "", notes: "" });
    setShowNew(false);
    load();
  };

  const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleString("pt-PT") : "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">🔌 Webhooks & Automações</h3>
          <p className="text-sm text-muted-foreground">
            Dispara webhooks externos (Mautic, n8n, Zapier…) em eventos do chatbot.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNew(s => !s)}>
          {showNew ? "Cancelar" : "+ Novo Webhook"}
        </Button>
      </div>

      {showNew && (
        <Card className="p-4 space-y-3 border-primary/40">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nome</Label>
              <Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="ex: Mautic — nova lead" />
            </div>
            <div>
              <Label>Evento</Label>
              <select
                className="w-full border rounded h-10 px-2 bg-background"
                value={draft.event}
                onChange={e => setDraft(d => ({ ...d, event: e.target.value }))}
              >
                {EVENTS.map(ev => <option key={ev} value={ev}>{ev}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label>URL</Label>
            <Input value={draft.url} onChange={e => setDraft(d => ({ ...d, url: e.target.value }))} placeholder="https://…" />
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea rows={2} value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
          </div>
          <Button onClick={createHook}>Criar</Button>
        </Card>
      )}

      {loading && <p className="text-sm text-muted-foreground">A carregar…</p>}

      {!loading && hooks.length === 0 && (
        <p className="text-sm text-muted-foreground">Sem webhooks configurados.</p>
      )}

      {hooks.map(h => (
        <Card key={h.id} className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{h.name}</span>
                <Badge variant="outline" className={EVENT_COLORS[h.event] || ""}>{h.event}</Badge>
              </div>
              {h.description && <p className="text-xs text-muted-foreground mt-1">{h.description}</p>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{h.is_active ? "Activo" : "Inactivo"}</span>
              <Switch checked={h.is_active} onCheckedChange={(v) => toggleActive(h, v)} />
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              value={urls[h.id] ?? ""}
              onChange={e => setUrls(u => ({ ...u, [h.id]: e.target.value }))}
              placeholder="https://… (URL do webhook)"
            />
            <Button size="sm" onClick={() => saveUrl(h)}>Guardar</Button>
            <Button size="sm" variant="outline" onClick={() => testHook(h)}>🧪 Testar</Button>
          </div>

          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
            <span>Último disparo: <strong>{fmtDate(h.last_triggered_at)}</strong></span>
            <span>
              Último status:{" "}
              <strong className={
                h.last_status == null ? "" :
                h.last_status >= 200 && h.last_status < 300 ? "text-green-600" :
                "text-destructive"
              }>
                {h.last_status ?? "—"}
              </strong>
            </span>
            {h.notes && <span>Notas: {h.notes}</span>}
          </div>
        </Card>
      ))}
    </div>
  );
}
