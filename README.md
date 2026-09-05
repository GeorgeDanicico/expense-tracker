# Simple Ledger

A private, mobile-first expense tracker built with Next.js 16, React 19, Chakra UI 3, and Supabase. It uses CSS files and Chakra styling—there is no Tailwind configuration or dependency.

## Included

- Email/password authentication with cookie-based Supabase SSR sessions
- Authenticated dashboard for the current month
- Historical statistics for 3 months, 6 months, 1 year, 2 years, or one custom day/month
- Monthly expense ledger with month/year navigation
- Add and delete expense entries
- Per-account currency setting applied to every amount and export
- Secured `.xlsx` export for any selected month
- Installable PWA manifest, icons, and an offline shell
- Responsive desktop sidebar and safe-area-aware mobile navigation
- Searchable, category-filtered expense table with dedicated phone cards
- Owner-only Supabase RLS policies, explicit grants, input constraints, and query indexes
- Database-side dashboard aggregation so historical rows are not transferred to the app server

## Run locally

The connected Supabase URL and publishable key are already present in the ignored `.env.local` file as server-only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` values. For another project, copy `.env.example` to `.env.local` and replace the values. Do not add a `NEXT_PUBLIC_` prefix to either variable.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

New accounts use `EUR` by default. Each signed-in user can change their account currency from **Settings**; the selection applies to dashboards, expense entry, lists, and Excel exports.

## Required Supabase Auth setting

The hosted Supabase project has Email/password authentication enabled. Confirm these settings if you connect the app to another project:

1. Open Supabase Dashboard → Authentication → Sign In / Providers → Email and enable email/password sign-ins.
2. Under Authentication → URL Configuration, set the local Site URL to `http://localhost:3000` and allow `http://localhost:3000/auth/confirm` as a redirect URL.
3. Use the standard PKCE confirmation template below. It uses the callback URL supplied by signup, so local and deployed environments do not get mixed up. The app also supports this project's existing six-digit OTP link at `/confirm-email`.
4. For production, replace those URLs with the final HTTPS origin and update the server-only `SITE_URL`.

Recommended confirmation-template link:

```html
<a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email">
  Confirm your Simple Ledger account
</a>
```

For stronger password security, also enable leaked-password protection and keep the email OTP expiry at or below one hour in Supabase Auth settings.

## Database

Migrations live in `supabase/migrations`. They add or upgrade the expense ledger without deleting the earlier empty starter tables, then apply:

- positive amount, category, description, and note constraints;
- a validated per-account currency preference, defaulting existing accounts to `EUR`;
- indexes aligned with the ledger's owner, date, and creation-time filters;
- an owner-scoped dashboard aggregation function that runs under RLS;
- authenticated-only SELECT, INSERT, UPDATE, and DELETE policies scoped to `auth.uid()`;
- anonymous privilege revocation and hardened legacy tracker policies/functions.

## Verification

```bash
npm run check
npm audit --omit=dev
```

The Excel endpoint and every Server Action independently re-check authentication. The browser service worker does not cache dashboard pages, API responses, or expense data.
