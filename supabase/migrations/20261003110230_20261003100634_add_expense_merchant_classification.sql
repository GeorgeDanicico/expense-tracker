begin;

-- Keep this schema out of the Supabase exposed-schema list. Pure helpers need
-- USAGE for invoker triggers; no ledger/backup data is granted to API roles.
create schema if not exists expense_classification_private;
revoke all on schema expense_classification_private from public, anon, authenticated, service_role;
grant usage on schema expense_classification_private to authenticated, service_role;

create function expense_classification_private.normalize_merchant(value text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select lower(btrim(regexp_replace(coalesce(value, ''), '[[:space:]]+', ' ', 'g')));
$$;

-- Exact observed suffixes + bare brands and individually approved descriptions.
-- New locations/descriptions require review. Whitespace and case normalization
-- never removes meaningful word boundaries or makes a suffix a wildcard.
create function expense_classification_private.merchant_key(value text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case expense_classification_private.normalize_merchant(value)
    when 'autonet' then 'autonet'
    when 'autonet satu mare' then 'autonet'
    when 'autonet str. aurel vlaicu nr. 78 satu mare' then 'autonet'
    when 'omv' then 'omv'
    when 'omv 1642 satu mare' then 'omv'
    when 'omv 1947 satu mare' then 'omv'
    when 'omv 1642 bdul lucian blaga 120 satu mare' then 'omv'
    when 'omv 1947 b-dul henri coanda nr. 7 satu mare' then 'omv'
    when 'petrom' then 'petrom'
    when 'cnair road toll - tm28pnw' then 'cnair'
    when 'cnair road toll - sm23dif' then 'cnair'
    when 'allianz-tiriac insurance' then 'allianz-tiriac'
  end;
$$;

create function expense_classification_private.inspect_merchant(description text, notes text)
returns jsonb language plpgsql immutable parallel safe set search_path = '' as $$
declare
  normalized_description text := expense_classification_private.normalize_merchant(description);
  normalized_notes text := expense_classification_private.normalize_merchant(notes);
  description_merchant text := expense_classification_private.merchant_key(description);
  source_description text;
  source_merchant text;
  matched_merchant text;
  match_status text := 'no_match';
begin
  -- Only the complete, observed BT Star Forte envelope may supply a source.
  -- Ordinary notes, a second source field, and other import formats are ignored.
  source_description := substring(normalized_notes from
    '^bt star forte statement [0-9]{4}-(?:0[1-9]|1[0-2]); processed: [0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01]); transaction: [0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01]) (?:[01][0-9]|2[0-3]):[0-5][0-9]; source: ([^;]+)$');
  source_merchant := expense_classification_private.merchant_key(source_description);

  if source_description is not null and description_merchant is not null
     and source_merchant is distinct from description_merchant then
    match_status := 'conflicting_source';
  elsif source_merchant is not null and description_merchant is null
     and normalized_description not in ('expense', 'card payment', 'pos payment') then
    -- A substantive unrecognized description may be a different merchant.
    match_status := 'conflicting_description';
  elsif description_merchant is not null then
    matched_merchant := description_merchant;
    match_status := 'description_match';
  elsif source_merchant is not null then
    matched_merchant := source_merchant;
    match_status := 'approved_source_match';
  elsif normalized_description ~ '^(auto[ ._-]*net|o[ ._-]*m[ ._-]*v|pet[ ._-]*rom)'
     or source_description ~ '^(auto[ ._-]*net|o[ ._-]*m[ ._-]*v|pet[ ._-]*rom)'
     or normalized_description ~ '^(cnair road toll|allianz-tiriac)( |$)'
     or source_description ~ '^(cnair road toll|allianz-tiriac)( |$)' then
    match_status := 'unrecognized_spelling_or_suffix';
  end if;

  return jsonb_build_object('merchant', matched_merchant,
    'subtype', case matched_merchant when 'autonet' then 'car_maintenance'
      when 'cnair' then 'car_maintenance' when 'allianz-tiriac' then 'car_maintenance'
      when 'omv' then 'car_fuel' when 'petrom' then 'car_fuel' end,
    'status', match_status, 'description_merchant', description_merchant,
    'source_merchant', source_merchant);
end;
$$;

create function expense_classification_private.classify_expense_merchant(description text, notes text default null)
returns text language sql immutable parallel safe set search_path = '' as $$
  select expense_classification_private.inspect_merchant(description, notes) ->> 'subtype';
$$;

create function expense_classification_private.apply_expense_merchant()
returns trigger language plpgsql set search_path = '' as $$
declare target_subtype text;
begin
  target_subtype := expense_classification_private.classify_expense_merchant(new.description, new.notes);
  if target_subtype is not null then
    new.category := 'car';
    new.subtype := target_subtype;
  end if;
  return new;
end;
$$;

revoke all on all functions in schema expense_classification_private from public, anon, authenticated, service_role;
grant execute on function expense_classification_private.normalize_merchant(text),
  expense_classification_private.merchant_key(text),
  expense_classification_private.inspect_merchant(text, text),
  expense_classification_private.classify_expense_merchant(text, text)
  to authenticated, service_role;

create trigger expenses_classify_merchant
before insert or update of description, notes, category, subtype on public.expenses
for each row execute function expense_classification_private.apply_expense_merchant();

comment on function expense_classification_private.classify_expense_merchant(text, text) is
  'Conservative canonical merchant subtype: exact approved descriptions/suffixes, bare approved brands, and nonconflicting recognized statement sources only. Specific rules override generic/manual categories.';
commit;
