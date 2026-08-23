begin;

alter table public.profiles
  add column if not exists currency text;

update public.profiles
set currency = upper(btrim(currency))
where currency is not null;

update public.profiles
set currency = 'EUR'
where currency is null
   or currency not in (
     'EUR', 'RON', 'USD', 'GBP', 'AED', 'AUD', 'BGN', 'BRL', 'CAD', 'CHF',
     'CNY', 'CZK', 'DKK', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'JPY', 'KRW',
     'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'SEK', 'SGD', 'THB', 'TRY',
     'UAH', 'ZAR'
   );

alter table public.profiles
  alter column currency set default 'EUR',
  alter column currency set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_currency_supported'
  ) then
    alter table public.profiles add constraint profiles_currency_supported
      check (
        currency in (
          'EUR', 'RON', 'USD', 'GBP', 'AED', 'AUD', 'BGN', 'BRL', 'CAD', 'CHF',
          'CNY', 'CZK', 'DKK', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'JPY', 'KRW',
          'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'SEK', 'SGD', 'THB', 'TRY',
          'UAH', 'ZAR'
        )
      );
  end if;
end;
$$;

comment on column public.profiles.currency is
  'ISO 4217 currency used to label all amounts owned by this account.';
comment on column public.expenses.amount is
  'Positive amount in the owning account currency. Currency changes relabel rather than convert historical values.';

commit;
