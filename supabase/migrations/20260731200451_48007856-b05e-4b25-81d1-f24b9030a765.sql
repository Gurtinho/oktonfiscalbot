ALTER TABLE public.api_connections
  ADD COLUMN IF NOT EXISTS webhook_secret_name text,
  ADD COLUMN IF NOT EXISTS webhook_signature_header text NOT NULL DEFAULT 'x-okton-signature',
  ADD COLUMN IF NOT EXISTS webhook_signature_mode text NOT NULL DEFAULT 'hmac_sha256',
  ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz;