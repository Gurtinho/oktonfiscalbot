
DO $$ BEGIN
  CREATE TYPE public.flow_step_type AS ENUM (
    'message','collect_value','select_option','identify_company','select_branch',
    'select_document','load_required_fields','select_input_mode','collect_dynamic_fields',
    'validate_field','show_summary','request_confirmation','send_emission','wait_status',
    'send_files','transfer_to_human','finish'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_current_flow_id_fkey;
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_current_step_id_fkey;
DROP TABLE IF EXISTS public.flow_steps CASCADE;
DROP TABLE IF EXISTS public.flows CASCADE;

CREATE TABLE public.flow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  name text NOT NULL,
  document_type public.doc_type NOT NULL,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  initial_step_id uuid,
  trigger_keywords text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.flow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES public.flow_definitions(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  step_type public.flow_step_type NOT NULL,
  message_template text NOT NULL DEFAULT '',
  field_key text,
  "order" integer NOT NULL DEFAULT 1,
  next_step_id uuid REFERENCES public.flow_steps(id) ON DELETE SET NULL,
  error_step_id uuid REFERENCES public.flow_steps(id) ON DELETE SET NULL,
  configuration_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_id, key)
);

ALTER TABLE public.flow_definitions
  ADD CONSTRAINT flow_definitions_initial_step_fkey
  FOREIGN KEY (initial_step_id) REFERENCES public.flow_steps(id) ON DELETE SET NULL;

CREATE INDEX idx_flow_steps_flow ON public.flow_steps(flow_id, "order");
CREATE INDEX idx_flow_definitions_org ON public.flow_definitions(organization_id, document_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_definitions TO authenticated;
GRANT ALL ON public.flow_definitions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_steps TO authenticated;
GRANT ALL ON public.flow_steps TO service_role;

ALTER TABLE public.flow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flow_definitions_select_org" ON public.flow_definitions
  FOR SELECT TO authenticated USING (organization_id = public.current_org());
CREATE POLICY "flow_definitions_write_config" ON public.flow_definitions
  FOR ALL TO authenticated
  USING (organization_id = public.current_org() AND public.can_configure())
  WITH CHECK (organization_id = public.current_org() AND public.can_configure());

CREATE POLICY "flow_steps_select_org" ON public.flow_steps
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.flow_definitions f
    WHERE f.id = flow_steps.flow_id AND f.organization_id = public.current_org()));
CREATE POLICY "flow_steps_write_config" ON public.flow_steps
  FOR ALL TO authenticated
  USING (public.can_configure() AND EXISTS (
    SELECT 1 FROM public.flow_definitions f
    WHERE f.id = flow_steps.flow_id AND f.organization_id = public.current_org()))
  WITH CHECK (public.can_configure() AND EXISTS (
    SELECT 1 FROM public.flow_definitions f
    WHERE f.id = flow_steps.flow_id AND f.organization_id = public.current_org()));

CREATE TRIGGER trg_flow_definitions_updated BEFORE UPDATE ON public.flow_definitions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_flow_steps_updated BEFORE UPDATE ON public.flow_steps
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_current_flow_id_fkey
  FOREIGN KEY (current_flow_id) REFERENCES public.flow_definitions(id) ON DELETE SET NULL;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_current_step_id_fkey
  FOREIGN KEY (current_step_id) REFERENCES public.flow_steps(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.seed_default_flows(_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.doc_type;
  v_flow uuid;
  v_prev uuid;
  v_first uuid;
  v_id uuid;
  v_label text;
  rec record;
BEGIN
  FOREACH d IN ARRAY ARRAY['nfe','cte','mdfe']::public.doc_type[] LOOP
    IF EXISTS (SELECT 1 FROM public.flow_definitions WHERE organization_id = _org AND document_type = d) THEN
      CONTINUE;
    END IF;
    v_label := upper(replace(d::text, 'nfe', 'NF-e'));
    v_label := CASE d WHEN 'nfe' THEN 'NF-e' WHEN 'cte' THEN 'CT-e' ELSE 'MDF-e' END;

    INSERT INTO public.flow_definitions (organization_id, name, document_type, trigger_keywords)
    VALUES (_org, 'Emissão de ' || v_label, d, ARRAY[lower(d::text)])
    RETURNING id INTO v_flow;

    v_prev := NULL; v_first := NULL;
    FOR rec IN
      SELECT * FROM (VALUES
        (1,'boas_vindas','Boas-vindas','message','Olá! Vou te ajudar a emitir uma ' || v_label || '.',NULL),
        (2,'identificar_empresa','Identificar empresa','identify_company','Informe o CNPJ da empresa emitente.','cnpj'),
        (3,'selecionar_filial','Selecionar filial','select_branch','Escolha a filial responsável pela emissão.','branch_id'),
        (4,'selecionar_documento','Selecionar documento','select_document','Confirme o documento a emitir: ' || v_label || '.','document_type'),
        (5,'carregar_campos','Carregar campos obrigatórios','load_required_fields','Buscando os campos exigidos pela Okton...',NULL),
        (6,'modo_preenchimento','Modo de preenchimento','select_input_mode','Deseja preencher passo a passo ou enviar tudo de uma vez?','input_mode'),
        (7,'coletar_campos','Coletar campos','collect_dynamic_fields','Vamos preencher os campos necessários.',NULL),
        (8,'validar_campo','Validar campo','validate_field','Validando o valor informado...',NULL),
        (9,'resumo','Resumo','show_summary','Confira o resumo dos dados informados.',NULL),
        (10,'confirmacao','Confirmação','request_confirmation','Posso enviar para emissão? Responda SIM ou NAO.',NULL),
        (11,'emitir','Enviar emissão','send_emission','Enviando o documento para a Okton...',NULL),
        (12,'aguardar_status','Aguardar status','wait_status','Aguardando o retorno da autorização...',NULL),
        (13,'enviar_arquivos','Enviar arquivos','send_files','Segue o documento autorizado.',NULL),
        (14,'finalizar','Finalizar','finish','Atendimento finalizado. Obrigado!',NULL),
        (15,'atendimento_humano','Transferir para humano','transfer_to_human','Vou te transferir para um atendente humano.',NULL)
      ) AS t(ord, k, nm, st, msg, fk)
      ORDER BY 1
    LOOP
      INSERT INTO public.flow_steps (flow_id, key, name, step_type, message_template, field_key, "order")
      VALUES (v_flow, rec.k, rec.nm, rec.st::public.flow_step_type, rec.msg, rec.fk, rec.ord)
      RETURNING id INTO v_id;
      IF v_first IS NULL THEN v_first := v_id; END IF;
      IF v_prev IS NOT NULL THEN
        UPDATE public.flow_steps SET next_step_id = v_id WHERE id = v_prev;
      END IF;
      v_prev := v_id;
    END LOOP;

    UPDATE public.flow_definitions SET initial_step_id = v_first WHERE id = v_flow;
    UPDATE public.flow_steps s SET error_step_id = (
      SELECT id FROM public.flow_steps WHERE flow_id = v_flow AND key = 'atendimento_humano')
      WHERE s.flow_id = v_flow AND s.key IN ('identificar_empresa','validar_campo','emitir','aguardar_status');
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    PERFORM public.seed_default_flows(v_org);
  ELSE
    v_role := 'operador';
  END IF;

  INSERT INTO public.app_users (organization_id, auth_user_id, name, email, role)
  VALUES (v_org, NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email, v_role)
  ON CONFLICT (auth_user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DO $$ DECLARE o record; BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_flows(o.id);
  END LOOP;
END $$;
