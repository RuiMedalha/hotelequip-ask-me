import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const { session, isAdmin, loading } = useAuth();

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-6 max-w-md">
          <h1 className="text-xl font-bold mb-2">Supabase não configurado</h1>
          <p className="text-sm text-muted-foreground">
            Define <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> nas variáveis de ambiente do projecto Lovable.
          </p>
        </Card>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-secondary">
        <Card className="p-6 max-w-md w-full">
          <p className="text-sm text-muted-foreground">A validar sessão…</p>
        </Card>
      </div>
    );
  }

  if (session && isAdmin) return <Navigate to="/admin" replace />;

  if (session) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-secondary">
        <Card className="p-6 max-w-md w-full space-y-3">
          <h1 className="text-xl font-bold">Sessão sem permissões</h1>
          <p className="text-sm text-muted-foreground">{session.user.email} não tem role admin.</p>
          <Button variant="outline" onClick={async () => { await supabase.auth.signOut(); }}>Logout</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-secondary">
      <Card className="p-6 max-w-md w-full">
        <h1 className="text-2xl font-bold mb-4">Admin · HotelEquip Bot</h1>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
          <div><Label>Password</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? "A entrar..." : "Entrar"}</Button>
        </form>
        <p className="text-xs text-muted-foreground mt-4">
          Cria o utilizador no Supabase Dashboard (Auth → Users) e adiciona-lhe role 'admin' em <code>user_roles</code>.
        </p>
      </Card>
    </div>
  );
}
