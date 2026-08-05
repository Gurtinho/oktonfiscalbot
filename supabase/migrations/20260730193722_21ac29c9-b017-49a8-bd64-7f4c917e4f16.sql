-- ROLES
CREATE TYPE public.app_role AS ENUM ('admin','operator','viewer');
CREATE TYPE public.doc_type AS ENUM ('nfe','cte','mdfe');
CREATE TYPE public.emission_status AS ENUM ('pending','sent','authorized','rejected','error','cancelled');
CREATE TYPE public.draft_status AS ENUM ('collecting','validating','awaiting_confirmation','confirmed','discarded');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.can_write(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','operator'))
$$;

CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "user_roles_admin_manage" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- new user handler: profile + first user becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''))
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'viewer');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- COMPANIES
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj text NOT NULL UNIQUE,
  razao_social text NOT NULL,
  nome_fantasia text,
  okton_company_id text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER companies_touch BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- OKTON CONNECTIONS
CREATE TABLE public.okton_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  environment text NOT NULL DEFAULT 'homologacao',
  base_url text NOT NULL,
  auth_type text NOT NULL DEFAULT 'bearer',
  token_secret_name text NOT NULL DEFAULT 'OKTON_API_TOKEN',
  extra_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.okton_connections TO authenticated;
GRANT ALL ON public.okton_connections TO service_role;
ALTER TABLE public.okton_connections ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER okton_connections_touch BEFORE UPDATE ON public.okton_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.okton_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.okton_connections(id) ON DELETE CASCADE,
  key text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  path text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.okton_endpoints TO authenticated;
GRANT ALL ON public.okton_endpoints TO service_role;
ALTER TABLE public.okton_endpoints ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER okton_endpoints_touch BEFORE UPDATE ON public.okton_endpoints FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- WHATSAPP CHANNELS
CREATE TABLE public.whatsapp_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'zappfy',
  instance_name text NOT NULL,
  webhook_token text NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  send_url text,
  send_token_secret_name text,
  payload_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_channels TO authenticated;
GRANT ALL ON public.whatsapp_channels TO service_role;
ALTER TABLE public.whatsapp_channels ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER whatsapp_channels_touch BEFORE UPDATE ON public.whatsapp_channels FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- FLOWS
CREATE TABLE public.flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  doc_type public.doc_type NOT NULL,
  name text NOT NULL,
  trigger_keywords text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flows TO authenticated;
GRANT ALL ON public.flows TO service_role;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER flows_touch BEFORE UPDATE ON public.flows FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.flow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  order_index integer NOT NULL DEFAULT 0,
  step_key text NOT NULL,
  prompt text NOT NULL,
  field_path text NOT NULL,
  input_type text NOT NULL DEFAULT 'text',
  required boolean NOT NULL DEFAULT true,
  okton_lookup_key text,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_id, step_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_steps TO authenticated;
GRANT ALL ON public.flow_steps TO service_role;
ALTER TABLE public.flow_steps ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER flow_steps_touch BEFORE UPDATE ON public.flow_steps FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- CONVERSATIONS
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  channel_id uuid REFERENCES public.whatsapp_channels(id) ON DELETE SET NULL,
  wa_phone text NOT NULL,
  wa_name text,
  state text NOT NULL DEFAULT 'idle',
  flow_id uuid REFERENCES public.flows(id) ON DELETE SET NULL,
  current_step_id uuid REFERENCES public.flow_steps(id) ON DELETE SET NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER conversations_touch BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX conversations_phone_idx ON public.conversations (wa_phone);

CREATE TABLE public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction text NOT NULL,
  content text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.conversation_messages TO authenticated;
GRANT ALL ON public.conversation_messages TO service_role;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX conversation_messages_conv_idx ON public.conversation_messages (conversation_id, created_at);

-- DRAFTS
CREATE TABLE public.drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  doc_type public.doc_type NOT NULL,
  status public.draft_status NOT NULL DEFAULT 'collecting',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16),'hex'),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drafts TO authenticated;
GRANT ALL ON public.drafts TO service_role;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER drafts_touch BEFORE UPDATE ON public.drafts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- EMISSIONS
CREATE TABLE public.emissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid REFERENCES public.drafts(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  doc_type public.doc_type NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
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
GRANT SELECT, INSERT, UPDATE ON public.emissions TO authenticated;
GRANT ALL ON public.emissions TO service_role;
ALTER TABLE public.emissions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER emissions_touch BEFORE UPDATE ON public.emissions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- AUDIT
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  actor text,
  action text NOT NULL,
  entity text,
  entity_id text,
  level text NOT NULL DEFAULT 'info',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX audit_logs_created_idx ON public.audit_logs (created_at DESC);
CREATE POLICY "audit_select" ON public.audit_logs FOR SELECT TO authenticated USING (true);

-- generic policies for config/operational tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','okton_connections','okton_endpoints','whatsapp_channels','flows','flow_steps','conversations','drafts','emissions']
  LOOP
    EXECUTE format('CREATE POLICY "%1$s_select" ON public.%1$I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY "%1$s_insert" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()))', t);
    EXECUTE format('CREATE POLICY "%1$s_update" ON public.%1$I FOR UPDATE TO authenticated USING (public.can_write(auth.uid())) WITH CHECK (public.can_write(auth.uid()))', t);
    EXECUTE format('CREATE POLICY "%1$s_delete" ON public.%1$I FOR DELETE TO authenticated USING (public.has_role(auth.uid(),''admin''))', t);
  END LOOP;
END $$;

CREATE POLICY "conversation_messages_select" ON public.conversation_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "conversation_messages_insert" ON public.conversation_messages FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));