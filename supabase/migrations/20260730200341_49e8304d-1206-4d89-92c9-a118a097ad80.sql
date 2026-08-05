CREATE TABLE public.api_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.api_connections(id) ON DELETE CASCADE,
  key text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  path text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_endpoints TO authenticated;
GRANT ALL ON public.api_endpoints TO service_role;
ALTER TABLE public.api_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_endpoints_select ON public.api_endpoints FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.api_connections c
    WHERE c.id = connection_id AND c.organization_id = public.current_org()));
CREATE POLICY api_endpoints_write ON public.api_endpoints FOR ALL TO authenticated
  USING (public.can_configure() AND EXISTS (SELECT 1 FROM public.api_connections c
    WHERE c.id = connection_id AND c.organization_id = public.current_org()))
  WITH CHECK (public.can_configure() AND EXISTS (SELECT 1 FROM public.api_connections c
    WHERE c.id = connection_id AND c.organization_id = public.current_org()));

CREATE TRIGGER api_endpoints_touch BEFORE UPDATE ON public.api_endpoints
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

REVOKE EXECUTE ON FUNCTION public.current_org() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_role_name() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(public.app_role[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_configure() FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_operate() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM anon, PUBLIC;