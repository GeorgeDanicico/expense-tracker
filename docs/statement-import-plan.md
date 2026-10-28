# Statement import plan (family hub phase 7)

This plan covers importing a bank statement into the Expenses module: you upload a CSV (later a PDF
with text), the app turns it into draft rows, you review them, and only then are they saved as your
own expenses, linked to the import so the whole import can be undone. It replaces steps 7.1–7.4
in [family-hub-roadmap.md](family-hub-roadmap.md). **Step 7.5 (an LLM for layouts no parser
recognises) belongs to phase 8 and is not planned here**; the parser design only leaves the door
open for it (see "Not in this plan").

The plan stops at one point it can't pass alone: **which banks and formats to support is still an
open decision** in the roadmap. Everything that doesn't depend on it (the schema, the pipeline, the
review screen, undo) comes first. The per-bank parsers come after a checkpoint where George names
his banks and supplies anonymised sample statements. No bank name or column layout is assumed
anywhere in this plan.

## The design in one page

| Question | Answer |
| --- | --- |
| Who can import? | **Whoever has the Expenses permission** at `edit` (every parent, and a kid with Expenses on), through `withPermission("expenses", "edit")`. A kid with Expenses off gets 403 on every import route. Users without a family can import too, as they can add expenses. |
| Whose expenses are created? | **Only the caller's own.** Import routes never read `?member=`; the owner comes from the session, as in `POST /api/expenses`. Parents don't see their kids' drafts or imports, whatever the Family finance permission says. |
| What is uploaded? | A CSV or a PDF as the **raw request body** (`Content-Type: text/csv` or `application/pdf`), as the avatar upload does, never multipart. Limits: **2 MB for CSV, 5 MB for PDF**, at most **500 rows** after parsing. The type is decided by the bytes, not by the header or the file name. |
| Is the file stored? | **Never.** It's read into memory, parsed and dropped. No disk, no Supabase Storage, no log line with its content, and the file name isn't read. Statements carry IBANs and account numbers. |
| What is stored? | **Draft rows** only: `import_batches` (one per upload) and `import_rows` (one per debit), for **24 hours** or until confirmed. IBAN-shaped and card-number-shaped text is masked in descriptions before a row is drafted. |
| How is the layout recognised? | Parsers sit behind a **`StatementParser`** interface and a registry picks one by the file's **header or layout**. A generic CSV parser (recognisable headers such as date, description, amount) is the baseline; per-bank parsers come after the checkpoint. A layout nobody recognises is refused with a clear message, never guessed. |
| What happens to money in? | **Skipped.** An expense must be greater than zero, so refunds and incoming payments are counted ("4 incoming payments skipped") and not imported. See question 2. |
| What about other currencies? | A row whose currency differs from the user's currency (`profiles.currency`) is **shown but can't be imported**; there is no conversion, as with family totals. See question 3. |
| What does the review screen show? | A table of the draft rows: tick box, date, merchant, amount, currency, category and subtype. Each row can be edited or unticked. **Nothing is saved until you press Confirm.** |
| How are duplicates found? | A draft row is flagged as a **possible duplicate** when one of your existing expenses has the **same date and amount** and a **similar merchant**. Flagged rows are **unticked** by default. Flags are worked out each time the draft is read, so they're never stale. |
| Where do category suggestions come from? | From the **existing merchant classification** in the database (`expense_classification_private.classify_expense_merchant`), called while the draft is created. A row it recognises gets its car category and subtype and is shown as "set by a merchant rule", because the `expenses_classify_merchant` trigger would apply the same rule on insert anyway. Every other row starts as **Other**; you pick. |
| What does Confirm do? | One SQL function inserts every ticked row into `expenses` **in one transaction**, links each new expense to the batch in `import_expenses`, and marks the batch confirmed. All or nothing. Confirming twice is refused. |
| Can I undo? | **Yes, a whole import**: one function deletes the caller's expenses linked to that batch and marks the batch undone. See question 4 for how long and what happens to edited rows. |
| Is the same statement imported twice? | **No.** Each batch carries a hash of its normalised rows (not of the file bytes, so a re-download of the same statement matches). Uploading a statement whose hash belongs to a draft **reopens that draft**; one that belongs to a confirmed import is **refused** with the date it was imported. An overlapping statement (two months that share days) is caught by the duplicate flags instead. |
| When does a draft expire? | **24 hours after upload**, fixed (viewing doesn't extend it). An expired draft counts as missing everywhere (every read and `confirm_import_batch` check `expires_at`), and is deleted by the user's next upload and by the worker's daily clean-up. |
| Feature flag? | **None**, as in phases 4–6. The API and the page land unlinked, and the **Import button on the Expenses page lands last** among the CSV tasks (I11), once at least one real bank parses. Routes use `withPermission`. |
| MCP | **None.** See "Why there are no MCP tools". |

### How an upload becomes a draft

```
Browser ──POST /api/imports  (raw body, Content-Type: text/csv | application/pdf)──▶ route
  route: auth → Expenses permission → per-user rate limit (every attempt counts)
         → declared type must be one of the two (else 415)
         → readBodyWithLimit(2 MB or 5 MB by declared type) (else 413)
         → sniff the bytes: PDF signature, or text that decodes (else 415)
         → PDF: extract the text (I12)        CSV: decode (UTF-8, UTF-16 with BOM, fallback)
         → registry: the first parser whose matches() accepts the header/layout
              none → 422 "unrecognised layout" (the hook for 7.5)
         → parse → debits kept, credits counted → mask IBANs and card numbers
         → more than 500 rows → 422
         → content hash of the normalised rows
              live batch with this hash: draft → reopen it; confirmed → 409 with its date
         → create_import_batch(batch, rows): deletes the caller's expired drafts, inserts the batch
           and rows with the merchant-rule suggestions, in one transaction
         → 201 { batch }          the bytes are garbage once the handler returns
```

### How review and confirm work

```
GET  /api/imports/<id>        rows + duplicate flags + whether each row can be imported
  service: load the draft (RLS) → the caller's own expenses between the first and last row's date
           (explicit user_id filter) → match one-to-one → flags; compare each row's currency with the
           user's currency

POST /api/imports/<id>/confirm  { rows: [{ id, description, amount, expenseDate, category,
                                           subtype, notes }] }      only the ticked rows
  service: every id must belong to the batch (else 422) → each row validated with expenseSchema →
           currency must match → confirm_import_batch(id, rows)
  SQL:     lock the batch → still a draft and not expired (else 55000 / P0002) → insert the expenses
           (merchant trigger runs) and link each to the batch → status = confirmed → delete the draft rows
  → 200 { batch, created: [...expenses as stored] }
```

The edits made on the review screen (unticking, a changed category) live in the browser until
Confirm; a reload brings back the draft as it was uploaded. The expenses come back **as stored**,
so a category the merchant trigger changed is shown correctly.

### Duplicate matching

A draft row matches an existing expense when all three hold:

1. **Same amount**, to the cent.
2. **Same `expense_date`.**
3. **Similar merchant.** Both descriptions are normalised (lower case, accents removed, digits and
   punctuation dropped, spaces collapsed); they're similar when one contains the other or their
   word sets overlap by at least half (Jaccard ≥ 0.5). Existing expenses can carry a notes envelope
   whose `source:` part holds the merchant while the description is a neutral "Card payment" (see
   [expense-classification-rollout.md](expense-classification-rollout.md)); for those the `source:`
   text is compared as well.

Matching is **one-to-one**: an existing expense can be matched by one draft row only (the first by
position), so two identical coffees in the file against one already saved flag one row, not both.
The rule is a starting point; I5 tunes the threshold on the fixtures, and the checkpoint samples may
show that a bank's posting date differs from the date the expense was saved with (question in the
checkpoint).

### Why there are no MCP tools

Phase 3's tools act on structured data the model can read and write safely. An import doesn't fit:

- **The file would have to pass through the model.** An MCP tool takes JSON, so a statement would
  travel as text in the conversation, IBANs included. That undoes the "the file is never stored and
  never leaves the server" rule, and the conversation is kept by the MCP client.
- **The review step needs a person.** The roadmap's rule is that every import ends in a review and
  nothing is saved until confirmed. A tool that confirms on the model's say-so would be a bulk
  `add_expense` with no one looking at the rows.
- The existing `add_expense` already covers "add this one expense".

If it's wanted later, `list_imports` (READ) and `undo_import` (DELETE) are thin wrappers over the
service from I5, and need a tool-surface snapshot update. They're left out because nothing asks for
them.

## Decisions

"Roadmap" means phase 7 as already written; "Proposed" means this plan's choice, open to change
before the task that uses it starts.

| Decision | Choice | Why |
| --- | --- | --- |
| Review before saving | Every import ends in a review; nothing is saved until confirmed | Roadmap. |
| Who can import, and for whom | Expenses permission; only the caller's own expenses | Roadmap. Imports never take `?member=`. |
| The file | Never stored; read in memory | Roadmap. Statements carry IBANs. |
| Draft storage | `import_batches` and `import_rows`, 24 hours | Roadmap. |
| Parser design | A `StatementParser` interface, picked by header or layout | Roadmap. |
| Duplicates | Same date and amount, similar merchant; flagged and unticked | Roadmap. The matching rule above is Proposed. |
| Category suggestions | The existing merchant classification | Roadmap. Called from SQL so there is one rule, not a TypeScript copy that could drift. |
| Confirm and undo | One transaction, each expense linked to the batch | Roadmap. |
| How expenses are tagged | A link table, `import_expenses (expense_id, batch_id)`, not a column on `expenses` | Proposed. `restore_historical_merchants()` compares whole-row `to_jsonb(expenses)` against snapshots taken on 3 October ([expense-classification-rollout.md](expense-classification-rollout.md)); a new column would make it report every backed-up row as edited. A link table leaves `expenses` and its triggers alone. |
| Format order | CSV first, then PDF with text | Roadmap. |
| LLM for unknown layouts (7.5) | Phase 8, not planned here | Roadmap. |
| Upload shape | Raw body with `text/csv` or `application/pdf`, not multipart, not `text/plain` | Proposed. Same reasoning as the avatar route: those types need a CORS preflight, which is never granted, so another site's HTML form can't post a file to the app. |
| Size limits | 2 MB CSV, 5 MB PDF, 500 rows, 30 PDF pages | Proposed. Both byte limits are under the 10 MB that `proxy.ts` buffers before a route sees the body (`experimental.proxyClientMaxBodySize`, which truncates silently instead of failing), so nothing in `next.config.ts` changes. A month of card transactions is tens to a few hundred rows; raise the limits only if a real statement doesn't fit. |
| Rate limit | 30 uploads per user per hour, every attempt counted | Proposed. Each upload costs a parse; same limiter as avatars (`createFailureLimiter`). |
| Masking | IBAN-shaped and long digit sequences are masked to their last 4 characters in descriptions before a row is drafted | Proposed. The description is saved with the expense and exported, so an account number in it would outlive the 24-hour draft. The same helper is what 7.5 would use before sending text anywhere. |
| Idempotency | A hash of the normalised rows, unique per user among live batches | Proposed. Works across re-downloads of the same statement, which byte hashes don't. |
| Duplicates are computed on read | Not stored on the draft | Proposed. Two drafts open at once, or a draft reopened the next morning, see current flags. |
| Edits before Confirm | Kept in the browser, not saved row by row | Proposed. Keeps the draft rows immutable (simpler RLS and guard), at the price of losing edits on a reload. |
| Long descriptions | The first 120 characters become the description (the expense limit); the rest goes to notes, up to 500 | Proposed. Nothing is silently dropped. |
| Notes on imported expenses | Empty unless a row has overflow text; provenance is the batch link | Proposed. See the checkpoint question about the notes envelope existing expenses carry. |
| Where the screen lives | `/expenses/import`, opened from an Import button on the Expenses page | Proposed. It is part of Expenses, not a new nav item. |
| MCP tools | None | See "Why there are no MCP tools". |

## Questions for George

Each has a default that the plan uses unless you say otherwise, so none of them blocks I1–I9. The
first is the roadmap's open decision and blocks I10.

1. **Which banks and formats?** For each bank or card you import from: current account or card,
   and whether you can download CSV, PDF or both. Answered at the checkpoint before I10, with the
   sample statements.
2. **Refunds and incoming money.** Default: skipped, counted on the review screen, never imported,
   because an expense must be greater than zero. Alternative: a refund could reduce a matching
   expense, which is a different feature. Needed by I2.
3. **A statement in another currency.** Default: those rows are shown, unticked, and can't be
   confirmed; there is no conversion. For card payments abroad, which amount a parser takes (the
   amount in your account's currency or the original one) depends on the bank, and is settled per
   bank at the checkpoint. Needed by I2.
4. **Undo.** Default: an import can be undone **at any time** while it's in the list of recent
   imports (the last 20), and undo **also removes imported expenses you edited afterwards**, after
   telling you how many that is ("This removes 37 expenses, 2 of them changed since you imported
   them"). Alternatives: a time limit such as 30 days, or leaving edited expenses alone. Needed by I8.

## Tasks

The workflow is the same as phases 1–6: one task, one branch (`family/<id>-<slug>` from `main`),
one PR, one fresh agent per task, run one at a time. All SQL is in I1; George applies the
migration at the checkpoint. Read the relevant guide in `node_modules/next/dist/docs/` before
writing route or page code, as `AGENTS.md` asks.

| Task | What | Depends on |
| --- | --- | --- |
| I1 | Migration: import tables, the link from imports to expenses, the create, confirm, undo and purge functions, guard, RLS, SQL tests | — |
| — | **Checkpoint:** George applies the I1 migration | I1 |
| I2 | Domain: types, limits, Zod schemas, amount and date parsing, masking, content hash | — (can run alongside I1) |
| I3 | `StatementParser` interface, registry, text decoding, CSV reader, generic CSV parser, fixtures | I2 |
| I4 | Upload guard and pipeline: size limits, signature check, rate limit, parse to draft rows | I3 |
| I5 | `ImportRepository`, `ExpenseRepository.listRange`, duplicate matcher and the import service | I1, I2, I4 |
| I6 | API routes: upload, list, read, confirm, undo, discard | I5 |
| I7 | The import page: upload step and review screen (not linked yet) | I6 |
| I8 | Recent imports, resume, undo, expiry states, phone layout | I7 |
| I9 | The worker's daily purge of expired drafts | I1 |
| — | **Checkpoint:** George names his banks and formats and supplies anonymised sample statements | — (can happen any time before I10) |
| I10a, I10b, … | One CSV parser per bank and format, each with anonymised fixtures | the checkpoint, I3 |
| I11 | The Import button on the Expenses page | I8, I10a |
| I12 | PDF text extraction: the dependency, `extractPdfText`, PDFs accepted by the route | I4, I6 |
| I13a, I13b, … | One PDF parser per bank that offers PDF only, or whose PDF layout differs from its CSV, each with fixtures | the checkpoint, I12 |
| — | **Checkpoint:** smoke test | I11, I13 (or I11 alone if no bank needs PDF) |

The number of I10 and I13 tasks is decided at the second checkpoint: one task per bank and format.

### I1: Migration

Migration `create_statement_imports`:

```sql
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'undone')),
  source_kind text not null check (source_kind in ('csv', 'pdf')),
  parser_id text not null check (char_length(parser_id) between 1 and 60),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  currency text check (currency ~ '^[A-Z]{3}$'),             -- the statement's currency, if it has one
  period_start date,
  period_end date,
  row_count integer not null check (row_count between 1 and 500),
  skipped_credits integer not null default 0 check (skipped_credits >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz,                                    -- drafts only: created_at + 24 hours
  confirmed_at timestamptz,
  confirmed_count integer check (confirmed_count >= 0),
  undone_at timestamptz,
  check ((status = 'draft') = (expires_at is not null)),
  check (status = 'draft' or confirmed_at is not null),
  check ((status = 'undone') = (undone_at is not null))
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  position smallint not null check (position between 1 and 500),   -- order in the statement
  expense_date date not null,
  description text not null check (char_length(btrim(description)) between 1 and 120),
  amount numeric(12, 2) not null check (amount > 0 and amount <= 9999999999.99),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  category text not null default 'other',                    -- the suggestion
  subtype text,
  rule_matched boolean not null default false,               -- the merchant classification recognised it
  notes text check (notes is null or char_length(notes) <= 500),
  unique (batch_id, position)
);

-- Which expenses an import created. A separate table, so `expenses` itself is untouched.
create table public.import_expenses (
  expense_id uuid primary key references public.expenses(id) on delete cascade,
  batch_id uuid not null references public.import_batches(id) on delete cascade
);
```

`category` and `subtype` use the same checks as `expenses` (copy `expenses_category_valid` and the
subtype check from the existing migrations, including `car`). Indexes: a **partial unique index** on
`import_batches (user_id, content_hash) where status in ('draft', 'confirmed')` (one live batch per
statement; an undone one frees it), `import_batches (user_id, created_at desc)`, a partial index on
`import_batches (expires_at) where status = 'draft'` for the purge, and `import_expenses (batch_id)`
for undo and the counts.

**Why a link table.** The obvious design is an `import_batch_id` column on `expenses`. But
`expense_classification_private.restore_historical_merchants()` decides whether an expense was
edited since the 3 October correction by comparing the whole row, `to_jsonb(expenses)`, with the
snapshot taken then (see [expense-classification-rollout.md](expense-classification-rollout.md)).
A new column adds a key to every current row and none of the snapshots, so the recovery would report
every backed-up expense as changed. The link table needs no change to `expenses`, its triggers or that
function, and the expenses repository's explicit column lists stay as they are.

Policies (`to authenticated`, helpers in a sub-select, as in `create_todos`). There is **no family
widening**: parents don't read their kids' imports, whatever Family finance says.
- **import_batches**: select where `user_id = app_private.current_user_id()`; insert with the same
  owner check and `status = 'draft'`; update where the owner matches; delete only own **drafts** (a
  confirmed batch is kept, because expenses are linked to it). The policy does **not** hide expired
  drafts: a row the select policy hides can't be deleted by its owner either, and the upload needs to
  clear them. Expiry is enforced by the functions below and by the repository, which treat an expired
  draft as missing.
- **import_rows**: select, insert and delete through a sub-select on the caller's batches. No update
  policy: draft rows never change.
- **import_expenses**: select through the caller's batches; insert only when the batch is the
  caller's **and** the expense has `user_id = app_private.current_user_id()` (an explicit check,
  because the expenses select policy is wider for parents). Grants are select and insert only; rows
  go away with their expense or batch through the foreign keys.

Trigger `import_batches_guard` (security invoker, like `todos_guard`): `user_id`, `source_kind`,
`parser_id`, `content_hash`, `row_count`, `created_at` never change (42501); `status` moves only
`draft → confirmed → undone` (55000 otherwise).

Functions (security invoker, `set search_path = ''`; each runs in one transaction):
- `create_import_batch(p_batch jsonb, p_rows jsonb) returns uuid`: deletes the caller's expired
  drafts, then inserts the batch (`user_id` from `app_private.current_user_id()`, `expires_at = now()
  + interval '24 hours'`) and its 1–500 rows. For each row it calls
  `expense_classification_private.classify_expense_merchant(description, null)`; when that returns a
  subtype the row gets `category = 'car'`, that subtype and `rule_matched = true`. The function is
  already granted to `authenticated`, so no new grant is needed. A repeated live hash is a 23505
  from the unique index.
- `confirm_import_batch(p_batch_id uuid, p_rows jsonb) returns table (id uuid, description text,
  amount numeric, category text, subtype text, expense_date date, notes text)`: locks the batch `for
  update`; P0002 when it is missing, someone else's or **expired** (it checks `expires_at` itself);
  55000 when it isn't a draft; 22023 when `p_rows` is empty, over 500, or names a row id that isn't in
  the batch. It inserts each row into `expenses` for the caller (the `expenses_classify_merchant`
  trigger runs as for any insert), adds an `import_expenses` row for each new expense, sets
  `status = 'confirmed'`, `confirmed_at` and `confirmed_count`, clears `expires_at`, deletes the
  batch's rows, and returns the expenses **as stored**. Any failing row (a check constraint) rolls
  everything back and the batch stays a draft.
- `undo_import_batch(p_batch_id uuid) returns integer`: locks the batch; P0002 when it isn't the
  caller's; 55000 when it isn't confirmed; deletes the caller's expenses linked to it (the links go
  with them), sets `status = 'undone'` and `undone_at`, and returns how many were deleted.
- Discarding a draft needs no function: `delete from import_batches where id = … and status =
  'draft'` cascades to its rows.
- `purge_expired_import_batches() returns integer` (`service_role` only, revoked from everyone
  else): deletes drafts whose `expires_at` has passed and returns the count.

The SQL error codes are the contract with I5; write them in a comment at the top of the migration.

SQL tests:
- `supabase/tests/import_rls.sql`: the owner reads and changes their own batches and rows; another
  user, **a parent with Family finance reading a kid**, and a user with no family see and change
  nothing; a confirmed batch can't be deleted directly; `user_id`, `content_hash` and the other
  fixed columns can't change; status can't move backwards or skip a step; rows can't be updated; a
  link can't be added to someone else's batch or to an expense that isn't the caller's, and can't be
  changed or deleted directly; deleting the user removes their batches, rows and links; deleting an
  imported expense removes its link only.
- `supabase/tests/import_save.sql`: creating a batch inserts the batch and rows together and deletes
  the caller's expired drafts; a bad row (a zero amount) inserts nothing; a row for `OMV` comes out
  `car` / `car_fuel` with `rule_matched`, one for an unknown merchant `other`; the same live hash is
  a 23505, and passes again after an undo; confirm inserts exactly the given rows with a link each,
  applies the merchant trigger to a row sent as `other`, leaves unlisted rows out, deletes the draft
  rows and is atomic (a failing row inserts nothing and the batch stays a draft); confirming twice,
  confirming an expired draft (still stored), a row id from another batch and another user's batch
  are refused with the codes above; undo deletes exactly the linked expenses of the caller, leaves
  unlinked and other users' expenses alone, and a second undo is 55000; the purge refuses
  `authenticated` and deletes only expired drafts with their rows.
- `expense_classification.sql` is **run unchanged** as a regression check: the migration must not
  disturb the recovery function's whole-row comparison.

**Done when** `npm run test:db` passes and `database.types.ts` is regenerated.

### Checkpoint: apply the migration

George applies `create_statement_imports` to the live project (Supabase MCP `apply_migration`, as
in earlier checkpoints). Nothing in the app uses it yet.

### I2: Domain and validation

Pure code, no Supabase, so it can run alongside I1. New folder `src/lib/imports/`.

- `types.ts`: `ImportLimits` constants (`IMPORT_CSV_MAX_BYTES = 2 MiB`, `IMPORT_PDF_MAX_BYTES = 5
  MiB`, `IMPORT_MAX_ROWS = 500`, `IMPORT_MAX_PDF_PAGES = 30`, `IMPORT_DRAFT_HOURS = 24`),
  `ParsedRow` (`expenseDate`, `description`, `amount` always positive, `currency`, `direction:
  "debit" | "credit"`), `ParsedStatement` (`parserId`, `rows`, optional `currency`, `periodStart`,
  `periodEnd`, `warnings`), `ImportBatch` (with its status and counts), `DraftRow` (with `category`,
  `subtype`, `ruleMatched`, `duplicateOf`, `importable`), `ImportDraft`, and
  `ImportError` codes (`unrecognised_layout`, `no_text`, `encrypted_pdf`, `too_many_pages`,
  `too_many_rows`, `no_debits`, `already_imported`, …) so the screen can tell them apart.
- `amount.ts`: `parseAmount(text, { decimal })` returning cents as an integer (no floats until the
  end): handles `1.234,56`, `1,234.56`, `45,20`, a trailing or leading minus, `(45.20)`, currency
  symbols and codes, non-breaking spaces. `detectDecimalMark(cells)` decides the mark once for a
  whole column: a cell with exactly one or two digits after the last separator settles it, and a
  column where nothing does (`1.234` alone) is **refused rather than guessed**.
- `date.ts`: `parseStatementDate(text)` for `YYYY-MM-DD`, `DD.MM.YYYY`, `DD/MM/YYYY`, `DD-MM-YYYY`,
  day first throughout (the app is Europe/Bucharest), rejecting impossible dates; a timestamp keeps
  only its date.
- `redact.ts`: `maskAccountNumbers(text)` masks IBAN-shaped tokens (country code, two digits, up to
  30 alphanumerics, with or without spaces) and any run of 12 or more digits (card and account
  numbers) to `…` plus the last 4 characters; ordinary text, amounts and dates are untouched.
- `hash.ts`: `statementHash(rows)`: SHA-256 (`node:crypto`) of the rows' date, cents, currency and
  normalised description, sorted, one per line. The same rows in a different order, or from a
  re-download, give the same hash.
- `src/lib/validation/import.ts`: `confirmImportSchema` (`rows` 1–500 items) whose items are built
  on `expenseSchema`'s fields plus the row `id`, so a confirmed row obeys exactly the rules of a
  hand-typed expense: description ≤ 120, amount greater than zero, a subtype that belongs to the
  category. Zod 4 does not allow `.extend()` on a schema with refinements; use `safeExtend` or
  rebuild from `expenseSchema.shape`.

Tests: every amount form above and the refused ambiguous column; each date form and an impossible
date (31.02); masking of IBANs written with and without spaces, a 16-digit card number, and text
that must not change ("Invoice 2026-10 RO"); a hash that ignores order but changes with one cent.

**Done when** the unit tests pass and nothing imports the new code yet.

### I3: Parser interface, registry and the generic CSV parser

New files under `src/lib/imports/`:

- `parser.ts`: the interface and the registry.

  ```ts
  type StatementSource =
    | { kind: "csv"; text: string }
    | { kind: "pdf"; text: string; pages: string[][] };   // pages → lines, filled by I12

  interface StatementParser {
    id: string;                      // "generic-csv", later one id per bank and format
    label: string;                   // shown on the review screen
    kinds: readonly ("csv" | "pdf")[];
    /** Looks only at the header or the first lines; never throws. */
    matches(source: StatementSource): boolean;
    parse(source: StatementSource): ParsedStatement;
  }
  ```

  `parseStatement(source)` takes the **first parser in registry order whose `matches` is true**,
  the specific ones before the generic one, and throws `UnrecognisedLayoutError` (code
  `unrecognised_layout`, a 422 message: "This statement's layout isn't supported yet.") when none
  match. A parser's own failure on a matching file throws the same family of error with a message
  that never contains row text. A test checks that **no fixture is claimed by two parsers**.
- `decode.ts`: `decodeStatementText(bytes)`: UTF-8 with or without a BOM; UTF-16 when the BOM says so;
  otherwise a legacy single-byte decode (windows-1250 first, the codepage Romanian exports have
  used), settled against the real samples at the checkpoint.
- `csv.ts`: a small RFC 4180 reader (quoted fields, doubled quotes, delimiters and newlines inside
  quotes, CRLF/LF/CR) with delimiter detection among `,` `;` and tab. Written in-house: it's under
  100 lines, and a dependency isn't worth it for it.
- `parsers/generic-csv.ts`: the baseline. It finds the header row among the first 20 lines, maps
  columns by name (a short English synonym list: date / posting date, description / details /
  merchant, amount, debit, credit, currency; the list grows when the samples show others), and
  handles both a single signed amount column and separate debit and credit columns. It uses
  `detectDecimalMark` and `parseStatementDate`, takes debits as expenses and counts credits. It
  `matches` only when it finds a date, a description and an amount (or debit) column. It never
  picks a column by position.
- `src/lib/imports/__fixtures__/generic-csv/`: **synthetic** fixtures, written for this task and
  containing no real data: comma with ISO dates, semicolon with day-first dates and decimal commas, a
  BOM, CRLF, quoted descriptions with a delimiter and a newline in them, signed amounts, separate
  debit and credit columns, a UTF-16 file, a windows-1250 file, an IBAN inside a description, an
  ambiguous amount column, and an unrecognised layout. Each has an expected-rows JSON beside it.
- `fixtures.test.ts`: walks every fixture folder and fails on an IBAN-shaped string or a run of 12
  digits that isn't one of the marked fake values, so a real number can't be committed by accident.

**Done when** each fixture parses to its expected rows, the unrecognised ones throw
`unrecognised_layout`, and nothing imports the registry yet.

### I4: Upload guard and pipeline

- `src/lib/imports/upload.ts`: `readStatementUpload(request)`:
  1. the declared `Content-Type` (`text/csv` or `application/pdf`, parameters ignored) else a 415;
  2. `readBodyWithLimit` from `src/lib/http/body.ts` with the limit for that type, else a 413
     "Choose a statement under 2 MB" (5 MB for a PDF); it checks `Content-Length`, then counts
     while reading;
  3. **the signature check**: a PDF must start with `%PDF-` within its first 1,024 bytes; a CSV
     must be text. A file is refused (415) when it starts with a known binary signature (`%PDF`,
     `PK\x03\x04` for xlsx and zip, `\xD0\xCF\x11\xE0` for old xls, PNG, JPEG, `MZ`) or has a NUL byte
     in its first 8 KB, unless it starts with a UTF-16 BOM. The content decides, not the header: a
     PDF sent as `text/csv` is read as a PDF if PDFs are enabled, and refused otherwise.
  Returns `{ kind, bytes }`. The file name is never read.
- `src/lib/imports/pipeline.ts`: `buildDraft({ kind, bytes })`: decode or extract the text →
  `parseStatement` → drop credits (count them) → `maskAccountNumbers` on each description, moving
  anything past 120 characters to the row's notes → refuse 0 debits (`no_debits`) or more than 500
  rows (`too_many_rows`) → `statementHash`. Returns the batch fields and the rows, still in memory.
  PDFs answer a 415 "PDF statements aren't supported yet" until I12 turns them on.
- `src/lib/http/rate-limit.ts` gains `importUploadAttempts` (30 an hour, counting every attempt)
  and its message, next to the avatar limiter. Shared file: rebase and re-check before merging.

Tests: each refusal (wrong type, a PNG sent as `text/csv`, a zip, a NUL in the first bytes, a 2 MB + 1
body with and without `Content-Length`, an empty body); a UTF-16 CSV passes; the 31st attempt in an
hour is 429; the pipeline masks an IBAN in a description, moves a 200-character description's tail to
notes, and refuses 501 rows; **the file never reaches disk or a log**: a test greps the sources under
`src/lib/imports` and `src/app/api/imports` for `node:fs`, `fs/promises` and `.storage`, and a
failing parse is run with `console` spied on to show that no row text is logged.

**Done when** the tests pass and nothing outside `src/lib/imports` and the limiter uses the new code.

### I5: Repository, duplicates and service

Follow `TodoRepository` and the calendar service:

- `ExpenseRepository.listRange(userId, range)` in `src/lib/expenses/repository.ts`, its Supabase
  implementation (`queryExpensesForUser` already takes `start` and `endExclusive`, and filters by
  `user_id` itself because parents' RLS reads are wider) and its fake. Shared files: rebase and
  re-check before merging.
- `ImportRepository` in `src/lib/imports/repository.ts`: `createBatch(batch, rows)` (the
  `create_import_batch` rpc), `findLiveByHash(hash)` (an expired draft isn't live), `getDraft(id)`
  (batch and rows, or null), `listRecent(limit)` (live drafts and the last confirmed or undone batches, with the current count
  of linked expenses and how many were changed since, `updated_at > created_at`), `confirm(id, rows)`,
  `undo(id)`, `discard(id)`. It acts as the caller; another user's batch counts as missing. The
  Supabase implementation in `src/lib/supabase/repositories/imports.ts` maps the SQL codes from I1
  to `DomainError`s: P0002 to a 404 "That import wasn't found or has expired.", 55000 to a 409,
  23505 to a 409, 22023 and 23514 to a 422. The fake in `src/test/fakes/imports.ts` is added to
  `Repositories` and the fake set (shared files: rebase and re-check).
- `src/lib/imports/duplicates.ts`: `flagDuplicates(rows, existing)` as described in "Duplicate
  matching", pure and tested: same date and amount with a similar merchant, one-to-one, the
  neutral-description case through the notes envelope, accents and case, near misses (a different
  amount by one cent, a different day) not flagged, and the two-coffees case.
- `src/lib/imports/service.ts` (use cases for the routes):
  - `createDraft(userId, upload)`: `buildDraft`, then `findLiveByHash` (a draft is returned as it
    is; a confirmed batch is a 409 "You imported this statement on 3 October. Undo that import to
    import it again."), then `createBatch`.
  - `getDraft(userId, id)`: an expired draft is a 404 here, as in every read; then the rows,
    `listRange` over the rows' dates, `flagDuplicates`, and `importable` (the row's currency equals
    `account.getCurrency(userId)`).
  - `confirmDraft(userId, id, edits)`: validates with `confirmImportSchema`, checks every id and
    every currency, then `confirm`. Duplicates don't block: ticking a flagged row is the user's call.
  - `listImports`, `undoImport`, `discardDraft`.

Tests (fakes): a new draft; the same statement twice returns the same draft, and after confirming
is a 409; after an undo it can be imported again; duplicates flagged against existing expenses and
not against another user's; a row in another currency is not importable and not confirmable;
confirm creates the expenses, linked to the batch, and only for the caller; a car merchant sent as
`other` comes back `car`; an expired draft is a 404.

**Done when** typecheck, lint and the repository, matcher and service tests pass.

### I6: API routes

Every route uses `withPermission("expenses", "edit")` and never reads `?member=`.

| Route | What |
| --- | --- |
| `POST /api/imports` | Upload (raw body). 201 `{ batch, reopened: false }`, or 200 with `reopened: true` for an existing draft. 413, 415, 422 (unrecognised layout, no debits, too many rows), 429. |
| `GET /api/imports` | The caller's recent imports: live drafts with their expiry, confirmed and undone batches. |
| `GET /api/imports/[id]` | A draft with its rows, duplicate flags and `importable`; for a confirmed batch, its summary. 404 when missing or expired. |
| `POST /api/imports/[id]/confirm` | The ticked rows with their final values. 200 `{ batch, created }`. 409 when the draft was confirmed already. |
| `POST /api/imports/[id]/undo` | Undo a confirmed import. 200 `{ batch, removed }`. 409 when it isn't confirmed. |
| `DELETE /api/imports/[id]` | Discard a draft. 204. |

Route tests: each action as a parent and as a kid with Expenses on; a kid with Expenses off gets 403
on all six and the repository is never touched; another user's id is 404 on every id route; the
status codes of the upload; a confirm with a bad row returns field errors for that row and saves
nothing; the same statement twice. Add the routes to `FINANCE_ROUTES` in
`finance-permissions.test.ts` and to `PROTECTED_ROUTES` in `protected-routes.test.ts`.

A PDF is a 415 ("PDF statements aren't supported yet") until I12 turns PDFs on.

**Done when** the route tests pass and both lists include the new routes.

### I7: The import page and the review screen

Page `src/app/(app)/expenses/import/page.tsx`, components in `src/components/expenses/import/`. It
follows the Expenses page's permission handling. Nothing links to it yet. SWR keys go in
`src/lib/api/keys.ts` and a helper in `invalidate.ts` refreshes the expense lists, the dashboard
and the tabs after a confirm.

- **Upload step**: a file picker and a drop zone for `.csv` (and `.pdf`, marked "coming soon"
  until I12), a line saying "The file is read and discarded. Only the rows below are kept, for 24
  hours." The browser sends the file as the raw body with the right `Content-Type`. Each server
  error has its own message (too large, not a statement, layout not supported yet, already
  imported with its date).
- **Review step**: a summary line (parser label, period, "37 rows, 3 possible duplicates, 4
  incoming payments skipped"), then the table: tick box, date, description (editable), amount,
  currency, category and subtype selects. Rows that are possible duplicates are **unticked** and
  show "Looks like *Lidl, 12 Oct, 45.20*"; rows in another currency are unticked, disabled and
  explained; rows set by a merchant rule show their car category as fixed ("Set by a merchant
  rule"). Select all, select none, and "All except duplicates"; the ticked count and total sit in a
  sticky footer with **Add 34 expenses** and **Discard**. Confirm opens a dialog with the count and the
  total, then calls the confirm route; the result view says "Added 34 expenses" with a link to
  the month and an **Undo** button.
- Edits (ticks, descriptions, categories) are local state until Confirm.
- Add the page to `/dev/preview/import` with fake data, following `calendar-fixtures.ts`.

**Done when** screenshots at 1280 px (light and dark) show the upload step, a review with
duplicates, a foreign-currency row and a rule-matched row, and the result view; and uploading a
generic CSV, unticking a row, changing a category and confirming creates the right expenses.

### I8: Recent imports, undo, expiry and phones

- A **Recent imports** list on the import page, from `GET /api/imports`: drafts ("Statement of 3
  Oct · 37 rows · expires in 19 h", **Resume** and **Discard**) and confirmed imports ("37 expenses ·
  imported 3 Oct", **Undo**), the last 20. An undone import is shown as such, without a button.
- **Undo** opens a confirm dialog from the repository's counts: "This removes 37 expenses
  you imported on 3 October, 2 of them changed since." Undo stays available as question 4 says;
  until it's answered, the default applies.
- Expiry: a draft opened after 24 hours is a 404 and the page shows "This import has expired.
  Upload the statement again." with the upload step; a confirmed-in-another-tab draft shows the
  409 message and the list.
- **Phones** (< 768 px): the table becomes one card per row (as `expense-mobile-list.tsx` does for
  expenses) with the tick box, merchant, amount and date on top and the category below; the footer
  stays sticky above the tab bar; the upload step is full width.

**Done when** screenshots at 390 and 1280 px of the list, the undo dialog, an expired draft and the
phone review; confirming and undoing in the preview leaves the expense lists as they were.

### I9: The worker's daily purge

The notifications worker already runs a daily clean-up (`CLEANUP_INTERVAL_MS`). It also calls
`purge_expired_import_batches()` there: a method on the worker store
(`src/lib/supabase/worker-store.ts`) and on its fake (`src/test/fakes/worker-store.ts`), a call in the
clean-up in `src/lib/notifications/worker.ts`, and a log line with **the count only**. A failure
is logged and the rest of the tick goes on, as the other clean-up steps do. Shared files: rebase and
re-check before merging.

Tests with a fake clock: the clean-up calls the purge once a day, a failing purge doesn't stop the tick
or the other clean-up, and the log carries a number and nothing else.

**Done when** the worker tests pass and the purge is exercised against the I1 function in
`import_save.sql` (already covered there).

### Checkpoint: George names his banks and formats and supplies anonymised sample statements

This is the roadmap's open decision ("Banks and formats for statement import"), and it can happen
at any time before I10. **Nothing in the plan assumes an answer.** What is needed:

1. **The list.** For each bank or card you import from: whether it's a current account or a card,
   and whether you can download CSV, PDF or both. Fill in this table in the PR that adds the
   samples:

   | Bank or card | Account type | CSV? | PDF with selectable text? | Notes (language, one account per file, ...) |
   | --- | --- | --- | --- | --- |
   | *to be filled in by George* | | | | |

2. **One anonymised sample per format**, ideally one that contains: an ordinary month, a refund or
   incoming payment, a payment in another currency, a transfer, a long description, a description
   with accents, and a row on the first and the last day of the period. If the bank changed its
   format over the years, one of each.
3. **How to anonymise** (so the samples can be committed as fixtures; treat the repository as public):
   - Edit CSVs in a **plain-text editor**, not a spreadsheet. A spreadsheet changes the delimiter,
     the encoding, the dates and the leading zeros, which are exactly what the parser must handle.
   - Replace names, addresses, IBANs, card and account numbers, references and balances with
     invented values. Keep the **shape**: same headers, column order, delimiter, quoting, date and
     number formats, line endings and encoding. For IBANs, keep the length and use an obviously fake
     body (`RO00FAKE...`) so the masking tests still mean something.
   - For a PDF, say whether the text is selectable. Replace the values in the PDF with an editor
     that keeps it text; if that isn't possible, paste the statement's text into a text file with
     the values replaced, and I12's test helper builds a text PDF from the lines. That keeps the text
     but not the exact column positions, so tell the agent if the bank's PDF needs them.
4. **Answers about the data**: which date should the expense carry, the transaction date or the
   posting date (if the file has both)? For card payments abroad, which amount is the expense
   (your account's currency, or the original)? Does the statement list refunds, and how? Is the
   merchant in the description column, or in a separate field with a neutral description such as
   "Card payment"?
5. **The notes envelope.** The classification trigger reads a merchant from a notes envelope
   (`BT Star Forte statement YYYY-MM; processed: …; transaction: …; source: …`) that existing
   expenses carry, written by an importer outside this repository, but only when the description is
   neutral. If one of your banks puts the
   merchant in a separate field, say whether new imports should write the same envelope so the
   existing merchant rules keep working for it. Default: they don't, and the parser puts the
   merchant in the description.

The agent for each I10 task reads the table and the samples, and the PR that adds them is merged
before the first I10 starts.

### I10a, I10b, …: One CSV parser per bank and format

One task per row of the table whose CSV column says yes. Each:

- `src/lib/imports/parsers/<parser-id>.ts` implementing `StatementParser`, with `matches` looking
  at that bank's exact header (or first lines) and nothing looser, registered **before**
  `generic-csv`.
- The anonymised sample(s) under `src/lib/imports/__fixtures__/<parser-id>/`, with an expected-rows
  JSON beside each, chosen on the checkpoint's answers: the date, the amount column, the
  currency, how a credit is marked, how a refund looks, the merchant field, the encoding and delimiter.
- A fixtures test for every file, the shared "no fixture is claimed by two parsers" test, and the
  fixture scan from I3.
- The duplicate matcher is run on the parser's output against expenses written the way this bank's
  rows were saved before (as the samples suggest), and its threshold is adjusted in `duplicates.ts`
  only if that fixture needs it.

**Done when** each fixture parses to its expected rows, nothing else matches it, and uploading it
through `/dev/preview/import` produces a sensible review.

### I11: The Import button

- An **Import statement** button in the Expenses page header (the main ledger and, on phones, the
  header's action row), linking to `/expenses/import`. It is only shown to users who see Expenses.
- Add it to `/dev/preview/expenses`.

**Done when** screenshots at 390 and 1280 px of the Expenses page with the button, and a kid with
Expenses off still can't reach the import page or its routes.

### I12: PDF text extraction

**The dependency.** `package.json` and the lockfile have no PDF library (checked 28 October 2026);
`fflate` and `sharp` are there but neither reads PDFs. The options:

| Option | Size and shape | Verdict |
| --- | --- | --- |
| `unpdf` | MIT, about 2.2 MB unpacked, **no dependencies**; packages a serverless build of Mozilla's pdf.js meant for bundlers and runtimes without a DOM | **Recommended.** The smallest option that gives text with positions, and nothing native. |
| `pdfjs-dist` | Apache-2.0, about 35 MB unpacked; the worker has to be wired by hand under Next | Larger, and `unpdf` already wraps it. |
| `pdf-parse` 2.x | Apache-2.0, depends on `pdfjs-dist` and a native canvas package | Heavier than `unpdf` and adds a native module to an image that already carries `sharp`. |
| Poppler's `pdftotext` | A system package and a child process per upload | Not a dependency, but the image would need the package and the app would write the file to a temp path, which the "never stored" rule rules out. |

Pin `unpdf` to an exact version, as every other dependency is, **at least two weeks old when the
task runs** (2.0.0 came out on the day of this plan; the 1.9.x line is the safer pick today). The
agent verifies the size and the licence at install time.

The task:
- `src/lib/imports/pdf-text.ts`: `extractPdfText(bytes)` returns `string[][]`, pages of lines. It
  reads the text items with their positions through pdf.js (via `unpdf`), groups items on the same
  baseline into a line and joins items with a large horizontal gap by a tab, so column-style
  statements keep their columns. It refuses an encrypted PDF ("This PDF is password protected."),
  more than 30 pages (`too_many_pages`, a 422), and a PDF with no text layer
  (`no_text`: "This PDF is a scan; scanned statements aren't supported.").
- The pdf.js work runs in the request's process and a hostile file could keep it busy; the 5 MB and
  30-page limits are the bound. That is accepted for a single household's app and listed for phase 14's
  review.
- `pipeline.ts` and the upload guard from I4 stop returning "PDF statements aren't supported yet";
  `StatementSource` carries `pages`; the upload step on the import page enables `.pdf`.
- Check the build before merging: read the Next guide on `serverExternalPackages` in
  `node_modules/next/dist/docs/`, run `npm run build`, and run the standalone server (`output:
  "standalone"` with `outputFileTracingRoot`) against a PDF, because the image copies only the traced
  files. The worker bundle (`build:worker`) must not import it.
- A test helper builds a small text PDF from lines (a minimal PDF writer, about 40 lines, used by
  tests only), so no binary fixture has to be committed for the extraction tests.

Tests: a two-page PDF comes back as two pages of lines; a three-column table keeps its columns
separated by tabs; an encrypted PDF, a PDF made of an image, a PDF over 30 pages and a truncated file
each give their message; a PDF sent as `text/csv` and a CSV sent as `application/pdf` are handled as
the signature check says.

**Done when** the tests pass, `npm run build` succeeds, and the standalone server extracts the text
of a generated PDF.

### I13a, I13b, …: One PDF parser per bank

One task per bank that offers PDF only, or whose PDF layout differs from its CSV. Same shape as
I10: a parser registered before the generic one, its `matches` looking at the bank's exact
header lines, anonymised fixtures (PDFs or line files rebuilt by the test helper, as agreed at the
checkpoint), expected rows, and the shared tests. A bank whose PDF and CSV carry the same rows needs
nothing here: the CSV parser is enough and the PDF is not offered for it.

**Done when** each PDF fixture parses to its expected rows and nothing else matches it.

### Checkpoint: smoke test

With the app on your phone and a Mac, and a real statement of each bank (not the anonymised one):

1. Import a CSV from your first bank. Check the summary line, that the rows match the statement, that
   the refunds and incoming payments were skipped and counted, and that known car merchants arrive
   in the car category with their subtype.
2. Untick two rows, change a category, confirm. The new expenses appear in the right months and the
   dashboard totals move by the amount you ticked.
3. Upload the same statement again: you are told when you imported it and nothing is added. Upload
   the next month's statement, which overlaps by a few days: the overlapping rows are flagged and
   unticked.
4. Undo the first import. Exactly its expenses go; expenses you added by hand are still there. Import
   the statement again and confirm it works.
5. Leave a draft for more than 24 hours: it can't be opened and is gone from the list; the next
   morning, check the worker log shows the daily purge count.
6. Do the same with a PDF statement of each bank that has one.
7. Try the refusals: a photo, an `.xlsx`, a CSV from a bank not on your list (clear message, nothing
   saved), a file over the limit.
8. Do steps 1 and 2 on the phone, at 390 px.
9. As a kid with Expenses on, import a statement and see that a parent's family view shows the kid's
   expenses but not the draft; as a kid with Expenses off, find no Import button.
10. Check that the container has no copy of any statement: no new file under the app's directories
    and the Supabase Storage buckets are unchanged.

## Not in this plan

- **7.5, an LLM for layouts no parser recognises.** It's phase 8. What this plan leaves for it: an
  unrecognised layout is a distinct error (`unrecognised_layout`) rather than a generic failure,
  `maskAccountNumbers` already exists and is the helper to run before any text leaves the server,
  and the draft/review/confirm flow is unchanged by where the rows come from. The opt-in, the cost
  gate and the extraction belong to 8.x.
- **Scanned PDFs and OCR.** A PDF without a text layer is refused.
- **Bank connections** (open banking, scraping, background syncing) and **email forwarding** of
  statements.
- **Other file types**: Excel, OFX, MT940, CAMT and QIF. They can be added as parsers later if a
  bank offers nothing else.
- **Money in.** Refunds and incoming payments aren't imported (question 2); netting a refund
  against an expense, income tracking and transfers between your own accounts are separate features.
- **Currency conversion.** Rows in another currency can't be imported.
- **Importing for someone else.** Parents can't import into a kid's expenses, and a kid's import is
  theirs alone.
- **Saving review edits as you go**, resuming with the edits intact after a reload, and splitting or
  merging rows.
- **Categories learned from your history** ("the last time this merchant was Groceries") and
  **AI category suggestions**. The matcher already loads neighbouring expenses, so history is cheap
  to add later; AI suggestions are roadmap step 8.5.
- **Editing the merchant rules** from the app.
- **Recurring-payment detection** from imported rows (roadmap step 8.7).
- **MCP tools** for imports (see above).
- **Keeping the original file**, in any form.
