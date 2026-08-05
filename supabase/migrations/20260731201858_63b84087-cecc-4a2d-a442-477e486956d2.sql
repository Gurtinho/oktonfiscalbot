ALTER TABLE public.integration_logs
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'producao',
  ADD COLUMN IF NOT EXISTS phone_masked text,
  ADD COLUMN IF NOT EXISTS okton_company_id text,
  ADD COLUMN IF NOT EXISTS document_type public.doc_type;

CREATE INDEX IF NOT EXISTS integration_logs_created_idx ON public.integration_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS integration_logs_service_idx ON public.integration_logs (service);
CREATE INDEX IF NOT EXISTS integration_logs_status_idx ON public.integration_logs (status_code);
CREATE INDEX IF NOT EXISTS integration_logs_request_idx ON public.integration_logs (request_id);
CREATE INDEX IF NOT EXISTS integration_logs_conversation_idx ON public.integration_logs (conversation_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON public.audit_logs (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_provider_event_uidx
  ON public.webhook_events (provider, external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope text NOT NULL,
  subject text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_hits_uidx
  ON public.rate_limit_hits (scope, subject, window_start);

GRANT ALL ON public.rate_limit_hits TO service_role;
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.register_rate_limit_hit(
  _scope text, _subject text, _window_seconds integer, _organization_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz;
  v_hits integer;
BEGIN
  v_window := to_timestamp(floor(extract(epoch FROM now()) / GREATEST(_window_seconds, 1)) * GREATEST(_window_seconds, 1));
  INSERT INTO public.rate_limit_hits (organization_id, scope, subject, window_start, hits)
  VALUES (_organization_id, _scope, _subject, v_window, 1)
  ON CONFLICT (scope, subject, window_start)
  DO UPDATE SET hits = public.rate_limit_hits.hits + 1, updated_at = now()
  RETURNING hits INTO v_hits;

  DELETE FROM public.rate_limit_hits WHERE window_start < now() - interval '1 day';
  RETURN v_hits;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_drafts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.drafts
     SET status = 'discarded', updated_at = now()
   WHERE expires_at < now()
     AND status NOT IN ('discarded', 'confirmed');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;