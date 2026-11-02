begin;

-- S13 (docs/security-plan.md, "Account deletion and data export").
--
-- 1. app_private.delete_owned_rows(p_user_id): deletes everything a user owns, in one statement
--    list, inside the caller's transaction. Internal: nobody can execute it but its owner, and only
--    the two functions below call it.
-- 2. public.delete_my_data(p_confirm): the signed-in user deletes their own data, after typing
--    "delete my account". Refused for the creator of a family, for any member of a family, and for
--    an account a family manages (a kid's), each with its own message.
-- 3. public.delete_managed_kid_data(p_member_id, p_confirm_name): a parent deletes the data of a
--    kid account made for their family, after typing the kid's name. Returns the kid's user id.
-- 4. public.export_my_data(p_section): one part of "Download my data", as a JSON array of the
--    caller's own rows.
--
-- The app deletes an account in this order (src/lib/account/deletion.ts):
--   a. checks the password and the confirmation, then calls (2) or (3): every row the user owns is
--      deleted in this one transaction, or nothing is;
--   b. removes the user's avatar files from Storage (by their folder, so a retry finds them too);
--   c. deletes the auth user with the admin API. That cascades to profiles and family_members (a
--      kid's membership), and in Supabase Auth to every session, refresh token, identity and OAuth
--      grant.
-- If (c) fails, the user is still signed in (or the kid is still in the family) with nothing left to
-- delete, and running the deletion again does (a) as a no-op and retries (b) and (c). The profile and
-- a kid's membership are left for (c) on purpose: without them a kid would drop out of Manage
-- family and the parent couldn't retry.
--
-- Rows that are not deleted:
-- * ai_usage keeps the user's rows with user_id set to null (the foreign key would do the same at
--   (c)). The family's and everyone's monthly AI budgets are sums over this ledger, so deleting the
--   rows would hand the month's spend back. The rows carry no content, only the feature, model,
--   tokens, cost and outcome.
-- * Family rows the user only created or completed (todos, calendar_events, family_invites) stay
--   with the family, with created_by, completed_by and used_by set to null; app_flags.updated_by
--   too. Again what the foreign keys would do at (c), done here so the data is gone in one step.
-- * Notifications and notices the user caused for other people belong to those people.
--
-- Missing migration: the app calls (2) or (3) first, so without this file the RPC is unknown, the
-- route answers its generic 500 and nothing is deleted.
--
-- Same conventions as S9 and S10: security definer only where needed, set search_path = '', fully
-- qualified names, the caller is app_private.current_user_id(), every raise marked for users
-- (hint = 'user'), and execute granted to authenticated only. No existing data is changed by the
-- migration itself.

-- ---------------------------------------------------------------------------
-- 1. Everything a user owns
-- ---------------------------------------------------------------------------

-- Security invoker: it is only ever run by the security definer functions below, as their owner.
-- Every public table that references auth.users is handled here (supabase/tests/account_deletion.sql
-- fails when a new one isn't), plus the merchant-correction backups, which copy expense rows.
create function app_private.delete_owned_rows(p_user_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  -- Statement imports: rows and import_expenses cascade from the batch.
  delete from public.import_batches b where b.user_id = p_user_id;

  -- Reminders before expenses: completions cascade from the reminder.
  delete from public.reminders r where r.user_id = p_user_id;

  delete from public.expenses e where e.user_id = p_user_id;
  -- The 3 October merchant correction kept copies of the rows it changed, with no foreign key.
  delete from expense_classification_private.expense_backups b
  where b.original_row ->> 'user_id' = p_user_id::text;
  -- Legacy categories, after the expenses that point at them.
  delete from public.categories c where c.user_id = p_user_id;
  delete from public.expense_tabs t where t.user_id = p_user_id;

  -- Orders and valuations cascade.
  delete from public.investment_accounts a where a.user_id = p_user_id;
  delete from public.net_worth_items i where i.user_id = p_user_id;

  delete from public.notifications n where n.user_id = p_user_id;
  delete from public.notification_settings s where s.user_id = p_user_id;
  delete from public.push_subscriptions s where s.user_id = p_user_id;
  delete from public.account_notices n where n.user_id = p_user_id;

  delete from public.mcp_tokens t where t.user_id = p_user_id;
  delete from public.calendar_feeds f where f.user_id = p_user_id;

  -- Kept for the monthly budgets, without the user.
  update public.ai_usage u set user_id = null where u.user_id = p_user_id;

  -- The family's rows stay with the family.
  update public.todos t set created_by = null where t.created_by = p_user_id;
  update public.todos t set completed_by = null where t.completed_by = p_user_id;
  update public.calendar_events e set created_by = null where e.created_by = p_user_id;
  update public.family_invites i set created_by = null where i.created_by = p_user_id;
  update public.family_invites i set used_by = null where i.used_by = p_user_id;
  update public.app_flags f set updated_by = null where f.updated_by = p_user_id;

  -- The picture's file is removed from Storage by the app; the profile row itself goes with the
  -- auth user.
  update public.profiles p set avatar_path = null where p.id = p_user_id and p.avatar_path is not null;
end;
$$;

revoke all on function app_private.delete_owned_rows(uuid) from public, anon, authenticated, service_role;

comment on function app_private.delete_owned_rows(uuid) is
  'Deletes every row the user owns (anonymising their ai_usage and their authorship of family rows). Internal: called only by delete_my_data and delete_managed_kid_data.';

-- ---------------------------------------------------------------------------
-- 2. Delete my data
-- ---------------------------------------------------------------------------

-- The signed-in user deletes everything they own. p_confirm must be "delete my account", ignoring
-- case and surrounding whitespace. Run it again and it does nothing, so the app can retry the steps
-- after it.
--
-- Security definer: the user's own rows in several tables have no delete policy for them
-- (notifications, ai_usage, the backups), and the family rows they created belong to the family.
--
-- Errors, checked in this order:
-- * 42501 with no caller.
-- * 23514 when p_confirm isn't the phrase.
-- * 55000 when the caller created a family: they delete the family first.
-- * 42501 when a family manages the account (a kid's account): a parent deletes it.
-- * 55000 when the caller is in a family: the creator removes them first.
create function public.delete_my_data(p_confirm text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  typed text := lower(regexp_replace(coalesce(p_confirm, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'));
  caller_family_id uuid;
begin
  if caller_id is null then
    raise exception 'Sign in to delete your account.'
      using errcode = '42501', hint = 'user';
  end if;

  if typed <> 'delete my account' then
    raise exception 'Type "delete my account" to confirm.'
      using errcode = '23514', hint = 'user';
  end if;

  -- Lock the caller's profile, so two deletions of the same account run one after the other.
  perform 1 from public.profiles p where p.id = caller_id for update;

  if exists (select 1 from public.families f where f.creator_id = caller_id) then
    raise exception 'You created a family, so your account can''t be deleted yet. Delete the family first, then delete your account.'
      using errcode = '55000', hint = 'user';
  end if;

  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = caller_id
  for share;

  if found then
    if exists (
      select 1 from public.profiles p
      where p.id = caller_id and p.managed_by_family = caller_family_id
    ) then
      raise exception 'A parent manages your account. Ask a parent to delete it from Manage family.'
        using errcode = '42501', hint = 'user';
    end if;

    raise exception 'You''re in a family. Ask the family''s creator to remove you, then delete your account.'
      using errcode = '55000', hint = 'user';
  end if;

  perform app_private.delete_owned_rows(caller_id);
end;
$$;

revoke all on function public.delete_my_data(text) from public, anon;
grant execute on function public.delete_my_data(text) to authenticated;

comment on function public.delete_my_data(text) is
  'The caller deletes all their own data after typing "delete my account". 23514 for a wrong phrase, 55000 for a family creator or member, 42501 for a managed kid account or no caller. Safe to run again.';

-- ---------------------------------------------------------------------------
-- 3. A parent deletes a kid account's data
-- ---------------------------------------------------------------------------

-- A parent deletes the data of a kid account that was made for their family (F13: its
-- profiles.managed_by_family is the family) and gets the kid's user id, for the app to delete the
-- auth user next. p_confirm_name must be the kid's name as Manage family shows it (the display
-- name, else the username), ignoring case and surrounding whitespace. The membership and the
-- profile stay until the auth user goes, so a failed last step can be retried from Manage family.
--
-- Errors, checked in this order:
-- * 42501 when the caller isn't a parent of a family (a kid, or no family).
-- * P0002 when the member doesn't exist or is in another family (the same error for both).
-- * 42501 when the member isn't a kid account made for this family (a parent, or a kid who joined
--   with their own account): the creator removes those instead.
-- * 23514 when p_confirm_name doesn't match.
create function public.delete_managed_kid_data(p_member_id uuid, p_confirm_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  caller_family_id uuid;
  target_user_id uuid;
  target_role text;
  target_family uuid;
  target_name text;
  typed text := regexp_replace(coalesce(p_confirm_name, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  select m.family_id into caller_family_id
  from public.family_members m
  where m.user_id = caller_id
    and m.role = 'parent';

  if not found then
    raise exception 'Only a parent can delete a kid''s account.'
      using errcode = '42501', hint = 'user';
  end if;

  -- As remove_family_member: share-lock the family, so a family deletion runs before or after this.
  perform 1 from public.families f where f.id = caller_family_id for share;

  select m.user_id, m.role into target_user_id, target_role
  from public.family_members m
  where m.id = p_member_id
    and m.family_id = caller_family_id
  for update;

  if not found then
    raise exception 'That family member wasn''t found.'
      using errcode = 'P0002', hint = 'user';
  end if;

  select p.managed_by_family, coalesce(p.display_name, p.username)
  into target_family, target_name
  from public.profiles p
  where p.id = target_user_id
  for update;

  if target_role <> 'kid' or target_family is distinct from caller_family_id then
    raise exception 'Only a kid account made for your family can be deleted here. The family''s creator can remove other members instead.'
      using errcode = '42501', hint = 'user';
  end if;

  if target_name is null or lower(typed) <> lower(target_name) then
    raise exception 'Type the kid''s name to confirm.'
      using errcode = '23514', hint = 'user';
  end if;

  perform app_private.delete_owned_rows(target_user_id);
  return target_user_id;
end;
$$;

revoke all on function public.delete_managed_kid_data(uuid, text) from public, anon;
grant execute on function public.delete_managed_kid_data(uuid, text) to authenticated;

comment on function public.delete_managed_kid_data(uuid, text) is
  'A parent deletes the data of a kid account made for their family, after typing the kid''s name, and gets its user id. 42501 for a non-parent or a member who isn''t such a kid, P0002 for an unknown member, 23514 for a wrong name.';

-- ---------------------------------------------------------------------------
-- 4. Download my data
-- ---------------------------------------------------------------------------

-- One part of the caller's data export, as a JSON array (one object per row, `[]` when there are
-- none). Only the caller's own rows, never another user's, and never a credential: no token or code
-- hashes, no push keys or endpoints. Family rows are the to-dos and events the caller created, was
-- given or attends, without other members' ids.
--
-- Security definer: some of the caller's own rows have no select policy for them
-- (notifications), and RLS would also show a parent their kids' finances, which aren't theirs to
-- export. So every query below filters on the caller explicitly.
--
-- Errors: 42501 with no caller, 22023 for an unknown section.
create function public.export_my_data(p_section text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  my_member_id uuid;
  result jsonb;
begin
  if caller_id is null then
    raise exception 'Sign in to download your data.'
      using errcode = '42501', hint = 'user';
  end if;

  select m.id into my_member_id from public.family_members m where m.user_id = caller_id;

  case p_section
    when 'profile' then
      select jsonb_agg(to_jsonb(r)) into result from (
        select p.id, p.email, p.username, p.display_name, p.full_name, p.currency,
          p.avatar_path is not null as has_picture, p.must_change_password, p.mcp_enabled,
          p.ai_enabled, p.created_at, p.updated_at
        from public.profiles p where p.id = caller_id
      ) r;
    when 'family_membership' then
      select jsonb_agg(to_jsonb(r)) into result from (
        select f.name as family_name, m.role, f.creator_id = caller_id as is_creator, m.joined_at,
          m.last_active_at, m.color, family_private.member_permissions_json(m.id) as permissions
        from public.family_members m
        join public.families f on f.id = m.family_id
        where m.user_id = caller_id
      ) r;
    when 'expenses' then
      select jsonb_agg(to_jsonb(r) order by r.expense_date, r.created_at, r.id) into result from (
        select e.id, e.expense_date, e.description, e.amount, e.category, e.subtype, e.notes,
          e.created_at, e.updated_at
        from public.expenses e where e.user_id = caller_id
      ) r;
    when 'expense_tabs' then
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) into result from (
        select t.id, t.name, t.category_keys, t.subtype_keys, t.created_at, t.updated_at
        from public.expense_tabs t where t.user_id = caller_id
      ) r;
    when 'categories' then
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) into result from (
        select c.id, c.name, c.color, c.is_archived, c.created_at, c.updated_at
        from public.categories c where c.user_id = caller_id
      ) r;
    when 'investment_accounts' then
      select jsonb_agg(to_jsonb(r) order by r.broker_id, r.id) into result from (
        select a.id, a.broker_id from public.investment_accounts a where a.user_id = caller_id
      ) r;
    when 'investment_transactions' then
      select jsonb_agg(to_jsonb(r) order by r.executed_at, r.id) into result from (
        select t.id, t.investment_account_id, t.instrument, t.currency, t.side, t.amount, t.quantity,
          t.unit_price, t.executed_at
        from public.investment_transactions t
        join public.investment_accounts a on a.id = t.investment_account_id
        where a.user_id = caller_id
      ) r;
    when 'net_worth_items' then
      select jsonb_agg(to_jsonb(r) order by r.name, r.id) into result from (
        select i.id, i.name, i.kind, i.category, i.currency, i.purchase_amount, i.archived_at
        from public.net_worth_items i where i.user_id = caller_id
      ) r;
    when 'net_worth_valuations' then
      select jsonb_agg(to_jsonb(r) order by r.valued_on, r.id) into result from (
        select v.id, v.item_id, v.value, v.valued_on
        from public.net_worth_valuations v
        join public.net_worth_items i on i.id = v.item_id
        where i.user_id = caller_id
      ) r;
    when 'reminders' then
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) into result from (
        select x.id, x.title, x.notes, x.starts_on, x.time_of_day, x.timezone, x.repeat_unit,
          x.repeat_interval, x.lead_minutes, x.notifications_muted, x.next_due_on, x.snoozed_until,
          x.expense_template, x.created_at, x.updated_at
        from public.reminders x where x.user_id = caller_id
      ) r;
    when 'reminder_completions' then
      select jsonb_agg(to_jsonb(r) order by r.occurrence_on, r.id) into result from (
        select c.id, c.reminder_id, c.occurrence_on, c.done_at, c.expense_id
        from public.reminder_completions c
        join public.reminders x on x.id = c.reminder_id
        where x.user_id = caller_id
      ) r;
    when 'notification_settings' then
      select jsonb_agg(to_jsonb(r)) into result from (
        select s.push_enabled, s.reminders_enabled, s.todos_enabled, s.calendar_enabled, s.updated_at
        from public.notification_settings s where s.user_id = caller_id
      ) r;
    when 'push_subscriptions' then
      -- The device's name and dates only: the endpoint and keys are what a push needs to reach it.
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) into result from (
        select s.id, s.user_agent, s.created_at, s.last_success_at
        from public.push_subscriptions s where s.user_id = caller_id
      ) r;
    when 'notifications' then
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) into result from (
        select n.id, n.kind, n.payload, n.status, n.send_at, n.sent_at, n.created_at
        from public.notifications n where n.user_id = caller_id
      ) r;
    when 'account_notices' then
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) into result from (
        select n.id, n.kind, n.family_name, n.created_at, n.seen_at
        from public.account_notices n where n.user_id = caller_id
      ) r;
    when 'mcp_tokens' then
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) into result from (
        select t.id, t.name, t.prefix, t.created_at, t.regenerated_at, t.last_used_at, t.expires_at,
          t.revoked_at
        from public.mcp_tokens t where t.user_id = caller_id
      ) r;
    when 'calendar_feeds' then
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) into result from (
        select f.id, f.created_at, f.last_fetched_at, f.revoked_at
        from public.calendar_feeds f where f.user_id = caller_id
      ) r;
    when 'import_batches' then
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) into result from (
        select b.id, b.status, b.source_kind, b.parser_id, b.currency, b.period_start, b.period_end,
          b.row_count, b.skipped_credits, b.created_at, b.expires_at, b.confirmed_at,
          b.confirmed_count, b.undone_at
        from public.import_batches b where b.user_id = caller_id
      ) r;
    when 'import_rows' then
      select jsonb_agg(to_jsonb(r) order by r.batch_id, r.position) into result from (
        select x.id, x.batch_id, x.position, x.expense_date, x.description, x.amount, x.currency,
          x.category, x.subtype, x.rule_matched, x.notes, x.category_source
        from public.import_rows x
        join public.import_batches b on b.id = x.batch_id
        where b.user_id = caller_id
      ) r;
    when 'import_expenses' then
      select jsonb_agg(to_jsonb(r) order by r.batch_id, r.expense_id) into result from (
        select x.batch_id, x.expense_id
        from public.import_expenses x
        join public.import_batches b on b.id = x.batch_id
        where b.user_id = caller_id
      ) r;
    when 'ai_usage' then
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) into result from (
        select u.id, u.feature, u.provider, u.model, u.input_tokens, u.output_tokens,
          u.cached_input_tokens, u.cost_micros, u.outcome, u.created_at
        from public.ai_usage u where u.user_id = caller_id
      ) r;
    when 'todos' then
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) into result from (
        select t.id, t.title, t.notes, t.status, t.due_date, t.created_at, t.updated_at,
          t.completed_at,
          t.created_by is not distinct from caller_id as created_by_me,
          my_member_id is not null and t.assignee_member_id is not distinct from my_member_id as assigned_to_me,
          t.completed_by is not distinct from caller_id as completed_by_me
        from public.todos t
        where t.created_by = caller_id
          or t.completed_by = caller_id
          or (my_member_id is not null and t.assignee_member_id = my_member_id)
      ) r;
    when 'calendar_events' then
      select jsonb_agg(to_jsonb(r) order by r.starts_at, r.id) into result from (
        select e.id, e.title, e.notes, e.location, e.all_day, e.starts_at, e.ends_at, e.timezone,
          e.series_repeat, e.created_at, e.updated_at,
          e.created_by is not distinct from caller_id as created_by_me,
          exists (
            select 1 from public.calendar_event_attendees a
            where a.event_id = e.id and a.member_id = my_member_id
          ) as attending
        from public.calendar_events e
        where e.created_by = caller_id
          or exists (
            select 1 from public.calendar_event_attendees a
            where a.event_id = e.id and a.member_id = my_member_id
          )
      ) r;
    else
      raise exception 'That part of your data doesn''t exist.'
        using errcode = '22023', hint = 'user';
  end case;

  return coalesce(result, '[]'::jsonb);
end;
$$;

revoke all on function public.export_my_data(text) from public, anon;
grant execute on function public.export_my_data(text) to authenticated;

comment on function public.export_my_data(text) is
  'One section of the caller''s data export as a JSON array of their own rows (no credentials). 22023 for an unknown section, 42501 with no caller.';

commit;
