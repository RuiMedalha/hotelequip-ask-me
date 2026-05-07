import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AdminConversations() {
  const { session, isAdmin, loading } = useAuth();
  const [conversations, setConversations] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("conversations").select("*").order("created_at", { ascending: false }).limit(50).then(({ data }) => setConversations(data || []));
    supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(50).then(({ data }) => setLeads(data || []));
  }, [isAdmin]);

  useEffect(() => {
    if (!selected) return;
    supabase.from("messages").select("*").eq("conversation_id", selected).order("created_at").then(({ data }) => setMessages(data || []));
  }, [selected]);

  if (loading) return <div className="p-8">A carregar…</div>;
  if (!session) return <Navigate to="/admin/login" replace />;
  if (!isAdmin) return <div className="p-8">Sem permissões.</div>;

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Conversas & Leads</h1>
        <Button variant="outline" asChild><Link to="/admin">← Configurações</Link></Button>
      </div>
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
              <button key={c.id} onClick={() => setSelected(c.id)} className={`w-full text-left text-sm p-2 rounded hover:bg-muted ${selected === c.id ? "bg-muted" : ""}`}>
                <div>{c.visitor_id.slice(0, 12)}…</div>
                <div className="text-xs text-muted-foreground">{c.status} · {new Date(c.created_at).toLocaleString("pt-PT")}</div>
              </button>
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
