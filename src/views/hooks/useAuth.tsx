import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "gestor" | "operador" | "auditor" | "suporte";

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  operador: "Operador",
  auditor: "Auditor",
  suporte: "Suporte",
};

export type AppUser = {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  role: AppRole;
  status: string;
};

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAppUser = (authUserId: string) => {
      supabase
        .from("app_users")
        .select("id,organization_id,name,email,role,status")
        .eq("auth_user_id", authUserId)
        .maybeSingle()
        .then(({ data }) => setAppUser((data as AppUser | null) ?? null));
    };

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
      if (nextSession?.user) {
        const id = nextSession.user.id;
        setTimeout(() => loadAppUser(id), 0);
      } else {
        setAppUser(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
      if (data.session?.user) loadAppUser(data.session.user.id);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ETAPA 20 — expiração de sessão por inatividade (30 minutos).
  useEffect(() => {
    if (!session) return;
    const LIMIT_MS = 30 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void supabase.auth.signOut();
      }, LIMIT_MS);
    };
    const events: Array<keyof WindowEventMap> = ["click", "keydown", "mousemove", "scroll"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [session]);

  const role = appUser?.role ?? null;
  const active = appUser?.status === "active";
  const is = (...roles: AppRole[]) => !!role && active && roles.includes(role);

  return {
    session,
    user,
    appUser,
    role,
    roleLabel: role ? ROLE_LABEL[role] : null,
    organizationId: appUser?.organization_id ?? null,
    loading,
    isAdmin: is("admin"),
    /** configura fluxos, integrações e empresas */
    canConfigure: is("admin", "gestor"),
    /** acompanha conversas, rascunhos e emissões */
    canOperate: is("admin", "gestor", "operador", "suporte"),
    /** consulta logs, webhooks e históricos */
    canAudit: is("admin", "gestor", "operador", "auditor", "suporte"),
    signOut: () => supabase.auth.signOut(),
  };
}
