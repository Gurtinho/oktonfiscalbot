ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS base_url text,
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'homologacao',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS webhook_secret_name text,
  ADD COLUMN IF NOT EXISTS signature_header text NOT NULL DEFAULT 'x-webhook-signature',
  ADD COLUMN IF NOT EXISTS signature_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS messages_external_message_id_key
  ON public.messages (conversation_id, external_message_id)
  WHERE external_message_id IS NOT NULL;