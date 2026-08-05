REVOKE ALL ON FUNCTION public.register_rate_limit_hit(text, text, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_drafts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_rate_limit_hit(text, text, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_drafts() TO service_role;