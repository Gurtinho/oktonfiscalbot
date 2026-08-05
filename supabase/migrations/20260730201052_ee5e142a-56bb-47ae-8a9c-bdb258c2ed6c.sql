ALTER TABLE public.api_connections
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_interval_ms integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS token_secret_name text,
  ADD COLUMN IF NOT EXISTS client_id_secret_name text,
  ADD COLUMN IF NOT EXISTS client_secret_secret_name text,
  ADD COLUMN IF NOT EXISTS api_key_secret_name text,
  ADD COLUMN IF NOT EXISTS last_test_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_test_ok boolean,
  ADD COLUMN IF NOT EXISTS last_test_status integer,
  ADD COLUMN IF NOT EXISTS last_test_duration_ms integer,
  ADD COLUMN IF NOT EXISTS last_test_message text;

ALTER TABLE public.api_endpoints
  ADD COLUMN IF NOT EXISTS headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS request_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS response_mapping jsonb NOT NULL DEFAULT '{}'::jsonb;