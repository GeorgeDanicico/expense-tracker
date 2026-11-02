# Backups

All the data lives in the hosted Supabase project (the database and the `avatars` storage bucket).
The VPS keeps nothing: the containers are read-only and the only thing they write is a cache in
memory. So "can we get the data back?" is a question about the Supabase plan.

This page says what to look up, how to rehearse a restore, and what to do if the plan's backups
aren't enough. It was written without access to the Supabase dashboard, so the table in "What to
record" is empty until George fills it in.

## What Supabase backs up

From Supabase's public backup docs (https://supabase.com/docs/guides/platform/backups, checked
2 November 2026; plans and prices change, so check again):

| Plan | Backups |
| --- | --- |
| Free | No automatic backups listed. Supabase recommends exporting regularly (`supabase db dump`) and keeping copies somewhere else. |
| Pro | A daily backup, kept 7 days. |
| Team | A daily backup, kept 14 days. |
| Enterprise | A daily backup, kept up to 30 days. |
| Point-in-Time Recovery (PITR) | A paid add-on for Pro and up (needs at least the Small compute add-on). Restore to any second; the worst case loss is about 2 minutes. Turning it on stops the daily backups. |

Things that catch people out:

- **Storage files are not in the backup.** Only the database is. Profile pictures live in the
  `avatars` bucket. After a restore, the rows that point to a picture come back, but a picture
  deleted since the backup does not. Pictures are small and a user can upload a new one, so this is
  acceptable, but it is worth knowing.
- **A dashboard restore replaces the live database and takes it offline** until it finishes (longer
  for bigger databases). It is not a way to look at old data next to the new data.
- **Custom role passwords** have to be reset after restoring a daily backup.
- **Deleting the project deletes its backups.**
- A daily backup can be **downloaded** only as a logical backup; after PITR, use the CLI or
  `pg_dump` to get a copy you can keep.

## What George needs to look up and record

In the Supabase dashboard: **Settings → Billing** (the plan) and **Database → Backups**. Fill in:

| Question | Answer |
| --- | --- |
| Which plan is the project on? | _to fill in_ |
| Are daily backups listed? How many days back? | _to fill in_ |
| Is PITR on? What window? | _to fill in_ |
| Date of the newest backup shown | _to fill in_ |
| Can a backup be downloaded from the dashboard? | _to fill in_ |
| Date of the last restore rehearsal, and who did it | _to fill in_ |

If the answer to the second row is "none" (Free plan, or backups missing), do the fallback below
before anything else.

## Restore rehearsal

Do this once, now, and again after any big change to the database. The point is to find out, on a
calm day, that the backup file really loads and has the data in it. **Never rehearse against the
live project.**

There are two ways. The local one needs nothing but Docker and costs nothing.

### Option 1: a local Postgres (recommended)

The repo already starts a throwaway Supabase Postgres for `npm run test:db`
(`scripts/test-database.sh`). Use the same image.

1. **Get a backup file.** In the dashboard, **Database → Backups**, download the newest daily
   backup (or, if the plan has none, make one yourself with the Supabase CLI:
   `supabase db dump --db-url "<connection string>" -f backup.sql`, run from your own laptop, with
   the connection string from **Project Settings → Database**). Keep the file outside the repo (for example in a new
   `~/restore-rehearsal/` folder); it holds everybody's data and nothing here stops you committing it.
2. **Start a disposable database**, with no port published, so nothing can reach it:

   ```bash
   docker run --name restore-rehearsal -e POSTGRES_PASSWORD=rehearsal-only -d supabase/postgres:17.4.1.054
   until docker exec restore-rehearsal pg_isready -h 127.0.0.1 -U postgres; do sleep 1; done
   ```

3. **Load the file.** If it is plain SQL:

   ```bash
   docker exec -i -e PGPASSWORD=rehearsal-only restore-rehearsal \
     psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=0 < ~/restore-rehearsal/backup.sql 2> ~/restore-rehearsal/restore-errors.txt
   ```

   If it is a custom-format file (a `.backup` file), copy it in and use `pg_restore`:

   ```bash
   docker cp ~/restore-rehearsal/backup.backup restore-rehearsal:/tmp/backup.backup
   docker exec -e PGPASSWORD=rehearsal-only restore-rehearsal \
     pg_restore -U supabase_admin -d postgres --no-owner --clean --if-exists /tmp/backup.backup
   ```

   Some errors about roles or extensions that already exist are normal for a Supabase dump; read
   `~/restore-rehearsal/restore-errors.txt` and write down which ones you saw. Errors about our own tables are not
   normal.
4. **Check the data is there.** Compare with the live app (the numbers should be close to the
   backup's date, not equal):

   ```bash
   docker exec -e PGPASSWORD=rehearsal-only restore-rehearsal psql -X -U supabase_admin -d postgres -c "
     select 'auth.users' as t, count(*) from auth.users
     union all select 'profiles', count(*) from public.profiles
     union all select 'expenses', count(*) from public.expenses
     union all select 'expense_tabs', count(*) from public.expense_tabs
     union all select 'investment_transactions', count(*) from public.investment_transactions
     union all select 'net_worth_items', count(*) from public.net_worth_items
     union all select 'families', count(*) from public.families
     union all select 'todos', count(*) from public.todos
     union all select 'reminders', count(*) from public.reminders;"
   ```

   Also check that the newest expense date is close to the backup's date
   (`select max(expense_date) from public.expenses;`) and that the migrations are all there
   (if the dump has `supabase_migrations.schema_migrations`, `select count(*)` from it should equal `ls supabase/migrations | wc -l`; if the table is missing, check a recent table such as `public.ai_usage` exists).
5. **Throw it away**, and delete the backup file when you are done:

   ```bash
   docker rm -f restore-rehearsal
   rm -r ~/restore-rehearsal
   ```

6. **Write down** the date, the file's size, how long steps 3 and 4 took, and anything surprising,
   in the table above. The time it took is the best estimate of how long a real restore keeps the
   app down.

### Option 2: a second Supabase project or a branch

If the dashboard offers **Restore to a new project** for your plan, that is the closest thing to a
real restore: it builds a separate project from a backup without touching the live one. Check
what the page offers; the option depends on the plan. Delete the new project afterwards (it costs
money while it exists).

A Supabase **branch** is built from the migrations in the repo, not from the live data, so it is
good for checking that the migrations replay (the SQL tests already do that) but it does **not**
rehearse a restore. Don't count it as one.

## The real restore (when it is needed)

See `docs/incident-checklist.md`, "The database needs a restore".

## If the plan has no usable backups: a nightly `pg_dump`

This is a proposal, not built. **It is George's decision** (it is listed in "Decisions for George"
in `docs/security-plan.md`).

**What it would be.** A scheduled job runs `pg_dump` against the Supabase database every night,
encrypts the file, stores it somewhere other than Supabase, and deletes files older than 14 days.

**Two places to run it:**

| | GitHub Action (scheduled) | The VPS (cron or a systemd timer) |
| --- | --- | --- |
| Where the database password lives | A GitHub secret. It is another place a leak can happen, and a workflow change can read it. | Only on the VPS, in a file readable by one user. |
| Where the file goes | A private release asset, an artifact (90 days at most, and artifacts are not meant as storage) or an external bucket. | A folder on the VPS, which is the same machine we are trying to be independent of; better to copy it off to another place too. |
| Runs if the VPS is down | Yes. | No. |
| Works if the VPS disk is lost | Yes. | Only if copied off. |
| Effort | A workflow file and two secrets. | A script, a timer and a way to copy files off. |

**Encryption.** Encrypt with a public key (`age` or `gpg`), so the job can only write backups and
never read them. George keeps the private key on his own machine and in his password manager, and
nowhere in CI or on the VPS. Without the key, a leaked backup is just noise.

**Trade-offs:**

- A nightly dump can lose up to a day of data. PITR loses about two minutes but costs more.
- The dump needs the database connection string (the direct or session pooler one, not the
  transaction pooler, which `pg_dump` can't use). It is a powerful secret: rotate it like the
  others (see the incident checklist).
- The dump holds everyone's financial data and (hashed) credentials from `auth.users`. Treat the
  file like the database.
- It does not include the `avatars` files (a dump is only the database). If pictures matter,
  copy the bucket separately, or accept losing them.
- Restoring a dump into a Supabase project by hand needs the steps above, so the rehearsal still
  has to happen.
- Free GitHub Actions minutes are plenty for a small database; 14 daily files is a small amount of
  space.

**Recommendation.** If the plan is Pro or better, rely on the daily backups, do the rehearsal once,
and look at PITR only if losing a day would hurt. If it is Free, set up the nightly dump from a
GitHub Action, with `age` encryption, to a private place outside the repo, kept 14 days, and
rehearse a restore from one of its files.
