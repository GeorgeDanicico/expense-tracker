# Statement reader eval (I19)

A hand-run check of how well a model reads bank statements, and what it costs. It runs the statement
reader's own code (the numbering, the prompts, the schemas, the output caps and `verifyReading`)
against synthetic statements whose right answers are known. See `docs/statement-import-plan.md`,
"Revision: the AI reads the statement" and task I19.

**The live run spends real money. It runs only by hand, never in CI, and `npm test` does not call it.**

## Running it

```sh
# See the whole harness work without a key or any cost (a stand-in model returns the expected answers).
npm run eval:statements -- --dry-run

# The live run George does by hand: gpt-5.6-luna, reasoning effort none, both modes.
npm run eval:statements -- --model gpt-5.6-luna

# Only if "none" misses rows or categories:
npm run eval:statements -- --model gpt-5.6-luna --effort low
```

Options: `--model <id>` (required for a live run), `--provider <id>` (defaults to `AI_PROVIDER`, then
`openai`; only OpenAI has an adapter so far), `--effort none|low|medium|high` (default `none`),
`--mode read|categorise|both` (default `both`), `--only <id>,<id>` (a few statements while trying
something), `--dry-run`.

What a live run does, in order:

1. **Refuses without `OPENAI_API_KEY`**, from the environment or `.env.local` (a plain `node` does not
   load Next's env files, so the script reads `.env.local` itself). It also refuses a model that has
   no price in `src/lib/ai/pricing.ts`, and any run without a terminal to type in.
2. **Prints an estimate** from the text (three characters to a token, nothing cached) and the pricing
   table: a typical cost (the plan's 30 output tokens a transaction and 8 a merchant) and the most it
   could cost (every call writing its whole output cap).
3. **Waits for you to type `spend`.** Anything else stops it before the first call.
4. Calls the model once per statement and mode, one after another, and prints a Markdown table to paste
   into a PR, then writes everything (every answer included) to `eval-results/`, which git ignores.

It does not go through `structured()` in `src/lib/ai/index.ts`, so it **skips the per-user budget gate
and the usage ledger**: there is no signed-in user, family or database here, and a hand-run eval should
not use up anyone's $3 month or write rows. The budget it respects is the one you confirm. Everything
else is the reader's own: `readStatement`, `categoriseMerchants`, `verifyReading`, the prompts and
the caps. The only difference in the request is that reasoning effort comes from `--effort`.

## What it reports

Per mode (the two modes are separate calls in production, so they are separate rows):

| Column | Meaning |
| --- | --- |
| Statements OK | Mode `read`: passed code's verification. Mode `categorise`: the answer had one category per merchant. |
| Rows exactly right | Mode `read`: expected rows (money in included) read with the same date, amount to the cent, currency and direction, and a matching merchant, out of all expected rows. A statement that fails verification is refused in production, so its rows count as not right. |
| Category / and subtype | Of the money-out rows read exactly right (mode `categorise`: of the merchants sent), how many got the expected category, and the expected subtype too. Merchants the database's merchant rule knows are left out, since the rule overrides the model. |
| Tokens per statement | Input, cached input and output, averaged. Reasoning tokens are in the output. |
| Average and highest cost | Priced from `src/lib/ai/pricing.ts`, next to the $0.01 aim. The highest names the statement. |

**A merchant matches** when every word of the expected name is among the model's words (case and accents
folded) and the model added at most three more (`score.ts`). "Lidl Cluj" matches "Lidl Cluj" and "Lidl
Cluj Napoca"; it does not match "Lidl" or "POS 4411 LIDL CLUJ RO". Verification has already shown that
every word is written on the cited lines, so an extra word is noise that was not cleaned, never an
invention.

**Mode `categorise`** only runs for statements a parser reads (today the generic CSV parser, English
headers). It sends the parser's debit descriptions, minus the merchants the merchant rule knows, with
an empty history, so every merchant is unknown. Statements no parser reads are read by the model (mode
`read`); a statement a parser claims and then refuses is read by mode `read` in production (when the
parser's error is an `unreadable_statement`), so it is skipped here with that note.

## The statements

`fixtures/` holds the synthetic statements. Nothing in it is real: the names are invented (Ion Exemplu,
Maria Test), the IBANs are `RO00FAKE…`, and the card number is the well-known test number. They are
**generated**: `statements.ts` describes them as data and renders them, so the answer a perfect model
gives is built from what was printed, never typed. After changing it, run

```sh
npm run eval:statements:generate
```

and commit the result. `eval.test.ts` fails when the files on disk are not what the generator
produces. Each statement has three files: the statement (`.csv` or `.pdf`), `.expected.json` (rows and
categories it should be read as) and `.answer.json` (what a perfect model answers; `--dry-run` plays it
back).

| Statement | Shape |
| --- | --- |
| `csv-en-iso-signed` | English headers, ISO dates, dot decimals, signed amounts, a currency column, a refund, a salary, a merchant the rule knows |
| `csv-en-debit-credit-comma` | Semicolons, DD.MM.YYYY, comma decimals with dot thousands, debit and credit columns, a balance |
| `csv-ro-multiline` | Romanian headers and diacritics, CRLF, descriptions over two or three lines, printed totals |
| `csv-ro-foreign` | Romanian headers, a currency per row, EUR and USD rows, a EUR refund |
| `csv-en-currency-in-preamble` | A preamble with a fake IBAN, the currency stated only above the table, a printed total; a parser claims it and then refuses it, and with AI on the pipeline hands it to the model |
| `csv-ro-comma-digits-before-amount` | Unquoted comma CSV where a store number runs into the amount ("Mega Image 118,118.40"); verification matches CSV amounts field by field |
| `pdf-en-two-pages` | A PDF table over two pages, wrapped descriptions, a balance, a printed total |
| `pdf-ro-table` | A Romanian PDF table, the currency after every amount, a printed total |
| `pdf-card-multiline` | A card statement, three lines per transaction, `CR` for money in, two EUR rows |
| `pdf-ro-no-year` | Dates printed as "12.10"; the year is only in the period heading, and code takes it from there |
| `pdf-ro-large-month` | About 110 transactions over three pages, for realistic size and cost |
| `csv-en-month` | About 50 rows a parser reads, for a realistic mode `categorise` |

A **known gap** is a shortcoming of the reader that a statement is there to measure: the eval counts it as
failed and labels it, and its `expected.json` says why (`knownGap`). When the reader is fixed, the dry-run
test fails and tells whoever fixed it to remove the label. There are none at the moment: the three
statements that were gaps (year-less dates, a store number before the amount, a CSV a parser claims and
refuses) are read since I20.

## Adding George's anonymised samples

Put them in `samples/` (the generator never touches it). The repository is public, so only commit a
sample after anonymising it as the plan's "Sample statements" section describes: edit CSVs in a plain
text editor, replace names, addresses, IBANs, card numbers, references and balances with invented
values, and keep the shape (headers, column order, delimiter, quoting, date and number formats,
encoding). Use obviously fake IBAN bodies (`RO00FAKE…`).

For each sample `<id>`:

- the statement: `<id>.csv`, `<id>.pdf`, or `<id>.txt`, the text of a PDF with the values replaced: one
  PDF line per line, a tab between a table row's columns, and a line `=== page ===` to start a new page.
  The eval turns it into a text PDF with the test helper and reads that the way an upload is read;
- `<id>.expected.json`, written by hand in the same shape as the generated ones (`rows` with `date`,
  `amount` as "45.20", `currency`, `direction`, a clean `merchant`, `category`, `subtype`; `description`;
  `currency`). `parser` and `knownGap` can be left out;
- no `answer.json` is needed. `--dry-run` leaves such samples out, since there is nothing to play back.

The answers about the data that the plan asks George for (which date an expense carries, which amount
for card payments abroad, how refunds look) go into the expected rows and, if they change the
instructions, into a new prompt version.
