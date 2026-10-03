begin;

create or replace function expense_classification_private.inspect_merchant(description text, notes text)
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
     and source_merchant is distinct from description_merchant
     and not (source_merchant is null and normalized_description in (
       'cnair road toll - tm28pnw', 'allianz-tiriac insurance', 'cnair road toll - sm23dif')) then
    -- A recognized different source remains a conflict. The three specifically
    -- approved exact descriptions win over an unrecognized source string.
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

comment on function expense_classification_private.inspect_merchant(text, text) is
  'Exact approved descriptions override unrecognized statement source strings; recognized conflicting merchants and substantive descriptions remain blocked.';

commit;
