begin;

-- Phase 1 (F07): create_family(p_name), for a signed-in user without a family.
--
-- It trims and checks the name, inserts the family with the caller as creator
-- and then the caller's parent membership, and returns the family id. F05's
-- deferred constraint trigger checks at commit that the creator is a parent
-- in the family, which the second insert satisfies.
--
-- Errors (messages reach the UI through translateDatabaseError, so they are
-- written for users and match familyNameSchema in src/lib/validation/family.ts):
-- * 42501 when there is no caller;
-- * 23514 when the name is blank or longer than 60 characters;
-- * 23505 when the caller is already in a family.

create function public.create_family(p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.current_user_id();
  -- Trim every kind of whitespace, as the app's schema does, not only spaces.
  -- The result also satisfies the families_name_valid check (name = btrim(name)).
  family_name text := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  new_family_id uuid;
begin
  if caller_id is null then
    raise exception 'Sign in to create a family.'
      using errcode = '42501';
  end if;

  if family_name is null or family_name = '' then
    raise exception 'Enter a family name.'
      using errcode = '23514';
  end if;

  if char_length(family_name) > 60 then
    raise exception 'Use at most 60 characters.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.family_members m
    where m.user_id = caller_id
  ) then
    raise exception 'You''re already in a family.'
      using errcode = '23505';
  end if;

  insert into public.families (name, creator_id)
  values (family_name, caller_id)
  returning id into new_family_id;

  -- Two calls at once can both pass the check above. The unique user_id on
  -- family_members then refuses the second; give it the same message.
  begin
    insert into public.family_members (family_id, user_id, role)
    values (new_family_id, caller_id, 'parent');
  exception
    when unique_violation then
      raise exception 'You''re already in a family.'
        using errcode = '23505';
  end;

  return new_family_id;
end;
$$;

revoke all on function public.create_family(text) from public, anon;
grant execute on function public.create_family(text) to authenticated;

comment on function public.create_family(text) is
  'Creates a family named p_name (trimmed, 1-60 characters) with the caller as creator and parent, and returns its id. 23505 when the caller is already in a family.';

commit;
