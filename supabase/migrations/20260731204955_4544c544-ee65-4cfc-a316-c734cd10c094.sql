-- 1) Restrict profiles reads to the owner
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- 2) Lock down maintenance / trigger SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.seed_default_flows(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_drafts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_rate_limit_hit(text, text, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- helper functions used inside RLS policies stay callable by signed-in users only
REVOKE ALL ON FUNCTION public.can_configure() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_operate() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_org() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_role_name() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_any_role(public.app_role[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;

-- 3) rate_limit_hits is server-only: make the denial explicit
REVOKE ALL ON TABLE public.rate_limit_hits FROM anon, authenticated;
GRANT ALL ON TABLE public.rate_limit_hits TO service_role;
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rate_limit_hits_no_client_access ON public.rate_limit_hits;
CREATE POLICY rate_limit_hits_no_client_access ON public.rate_limit_hits
  FOR SELECT TO authenticated
  USING (false);