begin;

-- MCP access: why a kid can't turn the switch on (docs/mcp-access-plan.md, M9).
--
-- While a kid's switch is off, my_mcp_access() answers status 'mcp_off', so the
-- settings page couldn't tell why the kid can't turn it on. It now also returns
-- blockReason: mcp_private.kid_block_reason(caller), null for anyone who isn't
-- a kid member and for a kid who passes both rules. Everything else is as in
-- 20261023000200_create_mcp_access.sql.

create or replace function public.my_mcp_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', mcp_private.access_status(app_private.current_user_id()),
    'personalTokens', mcp_private.personal_tokens_allowed(app_private.current_user_id()),
    'blockReason', mcp_private.kid_block_reason(app_private.current_user_id())
  )
$$;

revoke all on function public.my_mcp_access() from public, anon;
grant execute on function public.my_mcp_access() to authenticated;

comment on function public.my_mcp_access() is
  'The caller''s MCP access as {status, personalTokens, blockReason}: status is ok, mcp_off, not_permitted or email_required; personalTokens is false for kids; blockReason is why a kid can''t use MCP whatever their switch says (not_permitted or email_required), else null.';

commit;
