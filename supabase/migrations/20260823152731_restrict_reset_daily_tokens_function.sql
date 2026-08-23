-- The function is invoked by pg_cron as its owner. It does not need to be an
-- anonymous or signed-in RPC endpoint.
revoke all on function public.reset_daily_tokens() from public, anon, authenticated;
