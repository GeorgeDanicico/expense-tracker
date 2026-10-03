# Expense subtype and merchant rollout / recovery

These artifacts were rehearsed on disposable Supabase PostgreSQL 17. On 2026-10-03, the additive subtype and expense-tab migrations were applied to the linked Supabase project and verified; the merchant-classification trigger and historical correction migrations remain unapplied. `scripts/deploy.sh` deploys the application container only and does **not** apply database migrations.

## Deployment sequence

1. Rehearse `bash scripts/test-database.sh`. It reconstructs the inspected legacy prerequisites inside its own disposable container, replays migrations, and runs pgTAP. Never run `supabase/tests/support/legacy-bootstrap.sql` on a live project.
2. The additive migrations `20261003110022_20261003100041_add_expense_subtypes.sql` and `20261003110229_20261003100123_create_expense_tabs.sql` are already applied. Keep both `20261003110230_20261003100634_add_expense_merchant_classification.sql` and `20261003110231_20261003100635_correct_historical_expense_merchants.sql` out of the first application release's migration bundle. Retain the existing migration history; do not replay earlier migrations against the live database. The CLI's `db push --dry-run` lists pending files but does not let you stop at a particular file, so an unrestricted push of this complete checkout would skip the reader-deployment gate.
3. Deploy the application from this implementation. Verify existing Expenses, Home, exports, and Car/no-subtype display against the additive schema. Every active reader, including any older application instances or external consumer, must understand `car` and nullable `subtype` before merchant rules can create Car records. Roll out the compatible readers before both classification migrations, not just the backfill.
4. Apply only `20261003110230_20261003100634_add_expense_merchant_classification.sql`. Keep `expense_classification_private` out of Supabase's exposed schemas. Its invoker trigger covers authenticated and service-role writes; no backup access or privileged recovery capability is granted to either role.
5. Immediately run the read-only grouped report with an administrator SQL connection:

   ```sh
   psql -X -v ON_ERROR_STOP=1 -f supabase/maintenance/expense-classification-dry-run.sql
   ```

   Use your normal secured libpq connection configuration (`PGHOST`, `PGUSER`, database, `.pgpass`); do not put database passwords in shell history. Save the grouped result and review matched descriptions plus conflicts/unrecognized suffixes. The observed 2026-10-03 snapshot expects 1 Autonet maintenance record for 2,274.06 RON and 3 OMV fuel records for 674.84 RON, preserving both OMV 1642 records. Those figures are baselines, not mandatory migration targets. Newly approved `CNAIR road toll - TM28PNW`, `Allianz-Tiriac insurance`, and `CNAIR road toll - SM23DIF` matches will appear in the report under `cnair` or `allianz-tiriac` when their stored classification needs correction. Any new Petrom/bare-name matches will appear separately in the report. No ambiguous report entry is automatically reclassified.
6. Apply `20261003110231_20261003100635_correct_historical_expense_merchants.sql` through the migration runner, recording its normal migration-history entry. It locks concurrent expense writes, preserves the first original and corrected full-row snapshot per expense, changes only differing recognized classifications, validates complete immutable-field equality, deep equality of unrelated/already-correct rows, and unchanged count/amount before committing. An invariant error aborts the transaction.
7. Rerun the dry-run report: pending confirmed corrections should be zero. Compare total count/amount to step 5. For the original snapshot, Transport was expected to fall from 74 to 70 rows and from 74,354.95 to 71,406.05 RON; overall count and amount must not change. Verify Car tab totals, Home category totals, monthly exports and a new recognized-merchant INSERT returning its **stored** subtype. The existing POST/data-access path selects and returns the final inserted row, so trigger changes reach callers.
8. Review Supabase security advisors after actual deployment, particularly the private schema exposure, function privileges, and backup RLS. Keep the protected backup until the agreed recovery period expires.

The canonical matcher supports exact observed Satu Mare descriptions/address suffixes and bare `Autonet`, `OMV`, and `Petrom`, plus the exact descriptions `CNAIR road toll - TM28PNW`, `Allianz-Tiriac insurance`, and `CNAIR road toll - SM23DIF`, after case/whitespace normalization. It does not accept arbitrary suffixes, embedded brand substrings, fuzzy aliases, or brand mentions in ordinary notes. Unapproved CNAIR toll or Allianz-Tiriac variants are reported for review and remain unclassified. The only source fallback is a complete observed `BT Star Forte statement YYYY-MM; processed: YYYY-MM-DD; transaction: YYYY-MM-DD HH:MM; source: ...` envelope, with a recognized source and a neutral description (`Expense`, `Card payment`, `POS payment`). A substantive conflicting description or conflicting source blocks classification, including OMV versus Petrom. Merchant rules take precedence over generic and manual categories; exceptions require a future explicit override policy.

No external statement importer was found in this repository, its scripts/docs, or the narrowly searched nearby Python sources. The importer therefore remains unmodified. Find its owner before rollout if it bypasses ordinary triggers, disables triggers, or writes through replication. Ordinary direct SQL/Data API writes are covered by the database trigger.

## Recover classifications safely

Use an administrator connection and begin a transaction. First inspect planned restoration and conflicts:

```sql
begin;
lock table public.expenses in share row exclusive mode;
select b.expense_id,
  case when e.id is null then 'deleted_conflict'
    when to_jsonb(e) = b.original_row then 'already_restored'
    when to_jsonb(e) = b.corrected_row then 'safe_to_restore'
    else 'later_edit_conflict' end as status
from expense_classification_private.expense_backups b
left join public.expenses e on e.id = b.expense_id
where b.migration_id = '20261003100635_correct_historical_expense_merchants'
order by b.expense_id;
```

Then execute recovery in that transaction and review its returned statuses:

```sql
select * from expense_classification_private.restore_historical_merchants();
-- COMMIT after reviewing results; ROLLBACK cancels the entire recovery.
```

The function temporarily disables **both** the merchant and `updated_at` triggers, restores original category, subtype, and timestamp only for rows whose **entire current row** still equals the recorded correction, checks immutable fields/unrelated rows/exact restored snapshots, then re-enables both triggers. Any subsequent edit, even an amount/note change with the same classification, is a conflict. Deleted rows are reported and never recreated. Already-restored rows are skipped; first backups remain unchanged. The function requires both triggers to be ordinarily enabled before starting and refuses unusual trigger state for explicit review. Trigger changes are transactional, so rollback or a failed invariant restores their preceding state.

To roll back the classification **policy** as well, run `drop trigger expenses_classify_merchant on public.expenses;` **after** calling recovery, in the same transaction. This prevents future writes from restoring the merchant mappings. Keep the additive Car/subtype schema, protected backups, and compatible readers; reverting an application to readers that cannot understand existing Car rows requires a separate data/reader audit. Do not rerun the historical migration or correction function during a policy rollback.

## Rehearsal coverage

`supabase/tests/expense_classification.sql` covers observed merchants, approved sources, the three exact new descriptions, case/whitespace variants, conflict/substring/unknown-suffix nonmatches, authenticated INSERT/relevant UPDATE and precedence, denied backup/correction/recovery access, correcting seven historical fixtures from differing wrong categories, preserving both OMV records and all unrelated rows, second-run zero changes/unchanged first backups, and recovery with later-edit/deletion conflicts. Recovery restores exact originals while bypassing the triggers, re-enables them, and can be repeated safely. All financial fixtures are synthetic; no production writes are part of these tests.

References: [Supabase trigger guidance](https://supabase.com/docs/guides/database/postgres/triggers), [custom-schema exposure](https://supabase.com/docs/guides/api/using-custom-schemas), and the [implementation plan](expense-tabs-and-subtypes-plan.md).
