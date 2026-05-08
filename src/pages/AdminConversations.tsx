import { useEffect, useMemo, useState } from "react";
import { supabase, FUNCTIONS_URL, SUPABASE_ANON_KEY } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export default function AdminConversations() {
  const { session, isAdmin, loading } = useAuth();
  const [conversations, setConversations] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [waNumber, setWaNumber] = useState<string>("");

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("conversations").select("*").order("created_at", { ascending: false }).limit(50).then(({ data }) => setConversations(data || []));
    supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(50).then(({ data }) => setLeads(data || []));
    supabase.from("bot_settings").select("value").eq("key", "whatsapp_number").maybeSingle().then(({ data }) => setWaNumber((data?.value as string) || ""));
  }, [isAdmin]);

  useEffect(() => {
    if (!selected) return;
    supabase.from("messages").select("*").eq("conversation_id", selected).order("created_at").then(({ data }) => setMessages(data || []));
  }, [selected]);

  const leadByConv = useMemo(() => {
    const m: Record<string, any> = {};
    for (const l of leads) if (l.conversation_id) m[l.conversation_id] = l;
    return m;
  }, [leads]);

  const buildWaLink = (convId: string) => {
    const lead = leadByConv[convId];
    const conv = conversations.find(c => c.id === convId);
    const lastMsgs = selected === convId
      ? messages.slice(-6).map(m => `${m.role === "user" ? "Cliente" : "Bot"}: ${m.content}`).join("\n")
      : "";
    const lines = [
      "Nova conversa HotelEquip Chatbot",
      lead?.name ? `Nome: ${lead.name}` : null,
      lead?.email ? `Email: ${lead.email}` : null,
      lead?.phone ? `Telefone: ${lead.phone}` : null,
      lead?.interest ? `Interesse: ${lead.interest}` : null,
      conv ? `Conversa ID: ${conv.id}` : null,
      lastMsgs ? `\nÚltimas mensagens:\n${lastMsgs}` : null,
    ].filter(Boolean).join("\n");
    const num = waNumber.replace(/[^\d]/g, "");
    return `https://wa.me/${num}?text=${encodeURIComponent(lines)}`;
  };

  if (loading) return <div className="p-8">A carregar…</div>;
  if (!session) return <Navigate to="/admin/login" replace />;
  if (!isAdmin) return <div className="p-8">Sem permissões.</div>;

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Conversas & Leads</h1>
        <Button variant="outline" asChild><Link to="/admin">← Configurações</Link></Button>
      </div>
      {!waNumber && (
        <div className="mb-4 text-sm p-3 rounded border bg-muted/40">
          Define o <strong>WhatsApp number</strong> em <Link to="/admin" className="underline">/admin → Handoff</Link> para activar o botão "Notificar via WhatsApp".
        </div>
      )}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <h2 className="font-semibold mb-2">Leads ({leads.length})</h2>
          <div className="space-y-2 max-h-96 overflow-auto">
            {leads.map(l => (
              <div key={l.id} className="text-sm border-b pb-2">
                <div className="font-medium">{l.name || "—"}</div>
                <div className="text-muted-foreground">{l.email} · {l.phone}</div>
                <div className="text-xs">{l.interest}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold mb-2">Conversas</h2>
          <div className="space-y-1 max-h-96 overflow-auto">
            {conversations.map(c => (
              <div key={c.id} className={`rounded ${selected === c.id ? "bg-muted" : ""}`}>
                <button onClick={() => setSelected(c.id)} className="w-full text-left text-sm p-2 hover:bg-muted rounded">
                  <div>{leadByConv[c.id]?.name || `${c.visitor_id.slice(0, 12)}…`}</div>
                  <div className="text-xs text-muted-foreground">{c.status} · {new Date(c.created_at).toLocaleString("pt-PT")}</div>
                </button>
                {waNumber && (
                  <div className="px-2 pb-2">
                    <a
                      href={buildWaLink(c.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700"
                    >
                      Notificar via WhatsApp
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold mb-2">Mensagens</h2>
          <div className="space-y-2 max-h-96 overflow-auto text-sm">
            {messages.map(m => (
              <div key={m.id}><span className="font-medium">[{m.role}]</span> {m.content}</div>
            ))}
            {!selected && <p className="text-muted-foreground text-xs">Selecciona uma conversa.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
