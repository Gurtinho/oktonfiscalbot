-- ============ limpeza controlada (todas as tabelas estao vazias) ============
DROP TABLE IF EXISTS public.conversation_messages CASCADE;
DROP TABLE IF EXISTS public.emissions CASCADE;
DROP TABLE IF EXISTS public.drafts CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.okton_endpoints CASCADE;
DROP TABLE IF EXISTS public.okton_connections CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role) CASCADE;
DROP FUNCTION IF EXISTS public.can_write(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP TYPE IF EXISTS public.app_role CASCADE;

CREATE TYPE public.app_role AS ENUM ('admin','gestor','operador','auditor','suporte');

-- ============ organizations ============
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- ============ app_users ============
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  auth_user_id uuid UNIQUE,
  name text NOT NULL DEFAULT '',
  email text,
  role public.app_role NOT NULL DEFAULT 'operador',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_users_org_idx ON public.app_users(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_users TO authenticated;
GRANT ALL ON public.app_users TO service_role;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- ============ helpers (security definer, evitam recursao de RLS) ============
CREATE OR REPLACE FUNCTION public.current_org()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.app_users
  WHERE auth_user_id = auth.uid() AND status = 'active' LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_role_name()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.app_users
  WHERE auth_user_id = auth.uid() AND status = 'active' LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users
    WHERE auth_user_id = _user_id AND status = 'active' AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users
    WHERE auth_user_id = auth.uid() AND status = 'active' AND role = ANY(_roles))
$$;

-- configura fluxos/integracoes/empresas
CREATE OR REPLACE FUNCTION public.can_configure()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(ARRAY['admin','gestor']::public.app_role[])
$$;

-- opera conversas/rascunhos/emissoes
CREATE OR REPLACE FUNCTION public.can_operate()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(ARRAY['admin','gestor','operador','suporte']::public.app_role[])
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(ARRAY['admin']::public.app_role[])
$$;

REVOKE ALL ON FUNCTION public.current_org() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_role_name() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_any_role(public.app_role[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_configure() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_operate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_org() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_role_name() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(public.app_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_configure() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_operate() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

CREATE POLICY organizations_select ON public.organizations FOR SELECT TO authenticated
  USING (id = public.current_org());
CREATE POLICY organizations_update ON public.organizations FOR UPDATE TO authenticated
  USING (id = public.current_org() AND public.is_admin())
  WITH CHECK (id = public.current_org() AND public.is_admin());

CREATE POLICY app_users_select ON public.app_users FOR SELECT TO authenticated
  USING (organization_id = public.current_org());
CREATE POLICY app_users_insert ON public.app_users FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_org() AND public.is_admin());
CREATE POLICY app_users_update ON public.app_users FOR UPDATE TO authenticated
  USING (organization_id = public.current_org() AND public.is_admin())
  WITH CHECK (organization_id = public.current_org() AND public.is_admin());
CREATE POLICY app_users_delete ON public.app_users FOR DELETE TO authenticated
  USING (organization_id = public.current_org() AND public.is_admin() AND auth_user_id IS DISTINCT FROM auth.uid());

-- ============ api_connections ============
CREATE TABLE public.api_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  base_url text NOT NULL,
  environment text NOT NULL DEFAULT 'homologacao',
  authentication_type text NOT NULL DEFAULT 'bearer',
  encrypted_credentials_reference text NOT NULL DEFAULT 'OKTON_API_TOKEN',
  timeout_seconds integer NOT NULL DEFAULT 30,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_connections_org_idx ON public.api_connections(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_connections TO authenticated;
GRANT ALL ON public.api_connections TO service_role;
ALTER TABLE public.api_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_connections_select ON public.api_connections FOR SELECT TO authenticated
  USING (organization_id = public.current_org());
CREATE POLICY api_connections_write ON public.api_connections FOR ALL TO authenticated
  USING (organization_id = public.current_org() AND public.can_configure())
  WITH CHECK (organization_id = public.current_org() AND public.can_configure());

-- ============ conversations ============
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'zappfy',
  external_conversation_id text,
  phone_number text NOT NULL,
  company_cnpj text,
  okton_company_id text,
  okton_branch_id text,
  document_type public.doc_type,
  current_flow_id uuid REFERENCES public.flows(id) ON DELETE SET NULL,
  current_step_id uuid REFERENCES public.flow_steps(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  last_interaction_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX conversations_org_idx ON public.conversations(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_select ON public.conversations FOR SELECT TO authenticated
  USING (organization_id = public.current_org());
CREATE POLICY conversations_write ON public.conversations FOR ALL TO authenticated
  USING (organization_id = public.current_org() AND public.can_operate())
  WITH CHECK (organization_id = public.current_org() AND public.can_operate());

-- ============ messages ============
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction text NOT NULL,
  message_type text NOT NULL DEFAULT 'text',
  content text,
  external_message_id text,
  processing_status text NOT NULL DEFAULT 'pending',
  received_at timestamptz,
  sent_at timestamptz
);
CREATE INDEX messages_conversation_idx ON public.messages(conversation_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND c.organization_id = public.current_org()));
CREATE POLICY messages_write ON public.messages FOR ALL TO authenticated
  USING (public.can_operate() AND EXISTS (SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND c.organization_id = public.current_org()))
  WITH CHECK (public.can_operate() AND EXISTS (SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND c.organization_id = public.current_org()));

-- ============ drafts ============
CREATE TABLE public.drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  okton_draft_id text,
  document_type public.doc_type NOT NULL,
  status public.draft_status NOT NULL DEFAULT 'collecting',
  current_data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL DEFAULT encode(extensions.gen_random_bytes(16),'hex'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drafts_org_idx ON public.drafts(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drafts TO authenticated;
GRANT ALL ON public.drafts TO service_role;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY drafts_select ON public.drafts FOR SELECT TO authenticated
  USING (organization_id = public.current_org());
CREATE POLICY drafts_write ON public.drafts FOR ALL TO authenticated
  USING (organization_id = public.current_org() AND public.can_operate())
  WITH CHECK (organization_id = public.current_org() AND public.can_operate());

-- ============ emissions (recriada com organizacao) ============
CREATE TABLE public.emissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  draft_id uuid REFERENCES public.drafts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  document_type public.doc_type NOT NULL,
  idempotency_key text NOT NULL,
  status public.emission_status NOT NULL DEFAULT 'pending',
  okton_document_id text,
  access_key text,
  protocol text,
  xml_url text,
  pdf_url text,
  rejection jsonb,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX emissions_org_idx ON public.emissions(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emissions TO authenticated;
GRANT ALL ON public.emissions TO service_role;
ALTER TABLE public.emissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY emissions_select ON public.emissions FOR SELECT TO authenticated
  USING (organization_id = public.current_org());
CREATE POLICY emissions_write ON public.emissions FOR ALL TO authenticated
  USING (organization_id = public.current_org() AND public.can_operate())
  WITH CHECK (organization_id = public.current_org() AND public.can_operate());

-- ============ webhook_events ============
CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'zappfy',
  event_type text,
  external_event_id text,
  headers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_status text NOT NULL DEFAULT 'pending',
  processing_attempts integer NOT NULL DEFAULT 0,
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX webhook_events_org_idx ON public.webhook_events(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_events TO authenticated;
GRANT ALL ON public.webhook_events TO service_role;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_events_select ON public.webhook_events FOR SELECT TO authenticated
  USING (organization_id = public.current_org());
CREATE POLICY webhook_events_write ON public.webhook_events FOR ALL TO authenticated
  USING (organization_id = public.current_org() AND public.can_operate())
  WITH CHECK (organization_id = public.current_org() AND public.can_operate());

-- ============ integration_logs ============
CREATE TABLE public.integration_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  service text NOT NULL,
  endpoint text,
  method text,
  request_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status_code integer,
  duration_ms integer,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_logs_org_idx ON public.integration_logs(organization_id);
GRANT SELECT ON public.integration_logs TO authenticated;
GRANT ALL ON public.integration_logs TO service_role;
ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_logs_select ON public.integration_logs FOR SELECT TO authenticated
  USING (organization_id = public.current_org());

-- ============ audit_logs ============
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  app_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  old_data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_idx ON public.audit_logs(organization_id);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_select ON public.audit_logs FOR SELECT TO authenticated
  USING (organization_id = public.current_org());

-- ============ tabelas existentes ganham organizacao ============
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_channels ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS companies_select ON public.companies;
DROP POLICY IF EXISTS companies_insert ON public.companies;
DROP POLICY IF EXISTS companies_update ON public.companies;
DROP POLICY IF EXISTS companies_delete ON public.companies;
CREATE POLICY companies_select ON public.companies FOR SELECT TO authenticated
  USING (organization_id = public.current_org());
CREATE POLICY companies_write ON public.companies FOR ALL TO authenticated
  USING (organization_id = public.current_org() AND public.can_configure())
  WITH CHECK (organization_id = public.current_org() AND public.can_configure());

DROP POLICY IF EXISTS flows_select ON public.flows;
DROP POLICY IF EXISTS flows_insert ON public.flows;
DROP POLICY IF EXISTS flows_update ON public.flows;
DROP POLICY IF EXISTS flows_delete ON public.flows;
CREATE POLICY flows_select ON public.flows FOR SELECT TO authenticated
  USING (organization_id = public.current_org());
CREATE POLICY flows_write ON public.flows FOR ALL TO authenticated
  USING (organization_id = public.current_org() AND public.can_configure())
  WITH CHECK (organization_id = public.current_org() AND public.can_configure());

DROP POLICY IF EXISTS flow_steps_select ON public.flow_steps;
DROP POLICY IF EXISTS flow_steps_insert ON public.flow_steps;
DROP POLICY IF EXISTS flow_steps_update ON public.flow_steps;
DROP POLICY IF EXISTS flow_steps_delete ON public.flow_steps;
CREATE POLICY flow_steps_select ON public.flow_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.flows f WHERE f.id = flow_id AND f.organization_id = public.current_org()));
CREATE POLICY flow_steps_write ON public.flow_steps FOR ALL TO authenticated
  USING (public.can_configure() AND EXISTS (SELECT 1 FROM public.flows f WHERE f.id = flow_id AND f.organization_id = public.current_org()))
  WITH CHECK (public.can_configure() AND EXISTS (SELECT 1 FROM public.flows f WHERE f.id = flow_id AND f.organization_id = public.current_org()));

DROP POLICY IF EXISTS whatsapp_channels_select ON public.whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_channels_insert ON public.whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_channels_update ON public.whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_channels_delete ON public.whatsapp_channels;
CREATE POLICY whatsapp_channels_select ON public.whatsapp_channels FOR SELECT TO authenticated
  USING (organization_id = public.current_org());
CREATE POLICY whatsapp_channels_write ON public.whatsapp_channels FOR ALL TO authenticated
  USING (organization_id = public.current_org() AND public.can_configure())
  WITH CHECK (organization_id = public.current_org() AND public.can_configure());

-- ============ triggers de updated_at ============
CREATE TRIGGER organizations_touch BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER app_users_touch BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER api_connections_touch BEFORE UPDATE ON public.api_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER drafts_touch BEFORE UPDATE ON public.drafts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER emissions_touch BEFORE UPDATE ON public.emissions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ provisionamento no cadastro ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid;
  v_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''))
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;

  IF v_org IS NULL THEN
    INSERT INTO public.organizations (name) VALUES ('Organização principal') RETURNING id INTO v_org;
    v_role := 'admin';
  ELSE
    v_role := 'operador';
  END IF;

  INSERT INTO public.app_users (organization_id, auth_user_id, name, email, role)
  VALUES (v_org, NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email, v_role)
  ON CONFLICT (auth_user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();