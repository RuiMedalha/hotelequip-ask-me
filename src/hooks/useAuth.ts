import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [roleLoading, setRoleLoading] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setAuthReady(true);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!session) { setIsAdmin(false); setRoleLoading(false); return; }

    let active = true;
    setRoleLoading(true);
    supabase.from("user_roles").select("role").eq("user_id", session.user.id).then(({ data }) => {
      if (!active) return;
      setIsAdmin(!!data?.some((r: any) => r.role === "admin"));
      setRoleLoading(false);
    });

    return () => { active = false; };
  }, [authReady, session]);

  return { session, isAdmin, loading: !authReady || roleLoading };
}
