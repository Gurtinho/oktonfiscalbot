CREATE UNIQUE INDEX IF NOT EXISTS emissions_org_idempotency_uidx
  ON public.emissions (organization_id, idempotency_key);