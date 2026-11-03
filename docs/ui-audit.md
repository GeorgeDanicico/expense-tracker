# UI audit (phase 17, U2)

What each screen shows, what people do there, how many taps it takes on a phone, and what can be hidden, merged or moved. Written for U3's mockups and the screen tasks U4–U11 in [ui-plan.md](ui-plan.md). It changes no code. The `find-simpler-ways` reports for each module are in [simplification/](simplification/).

## How this was measured

- **In the browser, at 390 × 844 px** (the built-in browser's mobile emulation), on 4 November 2026 around 00:30 Bucharest time, with `npm run dev` and the fixture screens in `/dev/preview/[screen]` (dashboard, expenses, import, investments, net-worth, reminders, todos, calendar, settings, notifications, ai-settings), `/dev/ui`, and the signed-out pages `/login` and `/join/<code>`.
- **Counted from the code** where the preview can't go: the family pages, My permissions and AI assistants (not in `PREVIEW_SCREENS`), a kid's account (the preview always signs in as a parent), and the navigation taps between screens (the shell's links go to the real routes, which need a session). The More sheet itself was opened and read in the browser.
- **What a tap is:** every press on the screen, starting from Home. Typing doesn't count. A native select or date picker counts 2 (open, choose). The keyboard's Enter counts 1, as the plan's table does. Vertical scrolling doesn't count; a sideways swipe is noted.
- **Writes:** reminders, to-dos, the calendar and import are previewable end to end (in-memory APIs), and those taps were done in full. Expenses, investments, net worth and settings send their writes to the real API from the preview, so those were counted up to the save button.

## The tap table, corrected

| Task | Plan said (today) | Measured today at 390 px | Target | Where the plan was wrong |
| --- | --- | --- | --- | --- |
| Add an expense | Expenses → Add expense → category select → pick → Add: **5** | **From Home:** Add expense → Save expense: **2** only if the category is Groceries and the date is left alone. A correct one: Add expense → category (2) → date (2) → Save: **6**. From Expenses, the same plus the tab: **7**. | + → Save: **2** | Home already has **Add expense** (on the Summary card and on Monthly). And the date field defaults to the **last day of the month** (30 November on 4 November), so a correctly dated expense needs the date picker every time. |
| Add a to-do | More → To-dos → Add a card → Enter: **3** | More → To-dos → Add a card → Enter: **4** | + → To-do → Enter: **2** | It left out the More tap. "Add a card" itself is good: one tap opens a focused field, Enter adds and keeps it open. |
| Add a reminder | More → Reminders → Add reminder → (date/time) → Add: **4–6** | More → Reminders → Add reminder → Add reminder: **4** before 09:00; **6** after (the default is today at 09:00, already past, so the date has to change). | + → Reminder → Save: **3** | The range was right; the cause is the 09:00-today default. Title gets focus on open. |
| Mark a reminder done | More → Reminders → Done: **3** | **3** for one under Upcoming; **4** for an overdue one (it's on the Overdue tab, not Upcoming); **+1** when the reminder logs an expense ("Log expense and mark done" in its dialog). | Done on Home: **1** | Overdue reminders live on their own tab. |
| See this month's spending | Home: **0–1** | **0**: Home's Summary shows the month's total on the first screen. | **0** | Right, for anyone with the expenses permission. A kid without it gets a lock message on Home. |
| Snooze a reminder | More → Reminders → Snooze → choice: **4** | **4** (For an hour, or Until tomorrow 09:00); "Choose a time…" opens a dialog: **6+** | Swipe or long-press → choice: **2** | Right. But "For an hour" can end *before* the reminder is due (see "Bugs found"). |
| Delete a to-do | More → To-dos → open card → Delete → confirm: **5** | **5** | Swipe left: **1**, with undo | Right. |
| Change a setting | More → Settings → tab → change: **4** | Notifications: More → Settings → **swipe the tab row** → Notifications → switch: **4 + a swipe** (the tab starts off-screen at x = 603 px). Currency: More → Settings → select (2) → Save changes: **5**. | More → Settings → row → change: **4**, one list | The tab is off-screen on a phone; settings with a Save button take one more. |

Other everyday tasks, measured the same way:

| Task | Today | Notes |
| --- | --- | --- |
| Delete an expense | Expenses → trash → Delete expense: **3** | The trash icon is 28 × 28 px. No way to edit an expense in the app (MCP only, audit D10). |
| Change the month on Expenses | ‹ or ›: **1** | Plus a month field and Go next to it, which repeat the arrows. |
| Switch to the family view | Viewing → Family: **1** | The chips take two rows at 390 px on Home, Expenses, Investments and Net worth. |
| Import a statement | Expenses → Import statement → Choose a file → (system picker) → Add N expenses: **4** + the picker | The review has a sticky action bar already (`review-step.tsx`), the pattern U4's `ActionBar` generalises. |
| Add an investment order | More → Investments → asset → Add order → Save order: **5** | Quantity, unit price and amount are all typed. |
| Add a net-worth value | More → Net worth → Add value → Save value: **4** | The date defaults to the last observation, not today (see "Bugs found"); a new value needs **+2**. |
| Add a calendar event | More → Calendar → Add event → Add event: **4** | The start is the next whole hour today; most events need **+2–4** for date and time. |
| Move a to-do | More → To-dos → ⇄ → column: **4** | Long-press drag works too. |

## Screens

### Home (`/dashboard`)

| | |
| --- | --- |
| **Shows** | Summary / Monthly / History control; the Viewing chips (with a family); this month's card (total, transactions, average, largest, **Add expense**); the previous three months as bars with a comparison line; the leading category; the last five expenses. 1,375 px tall: 1.6 phone screens. Monthly adds the month toolbar again and a 30-row "daily spending" list (1,716 px); History is the analytics view. |
| **What people do** | Look at this month's total (0 taps); add an expense (2–6); open Expenses (1). |
| **Hide, merge, move** | Move Monthly and History under Money as "Insights" (U7, as planned): Monthly repeats Expenses' month toolbar and totals. Keep one line comparing this month with last. Add what's due today (reminders) and open to-dos (U7). The "Leading category" card is a curiosity, not a daily need: Insights. |

### Expenses (`/expenses`), saved tabs and import

| | |
| --- | --- |
| **Shows** | Add expense, Import statement, Export; Viewing chips; the tab row (Expenses, saved tabs, +); the month toolbar (‹ November 2026 › plus a month field and Go); a totals card; "All expenses" with search, a category select and the rows. **The first expense starts 694 px down**: on a 844 px phone with the bottom bar, one row is visible before scrolling. A saved tab (`?tab=…`) shows its filters (date scope, search, category, subtype, Apply, Reset) before its total, so the first figure is below the fold. Import: upload step, recent imports (Resume, Discard, Undo), then a review list with a sticky "N of M selected · Total · Add N expenses" bar. |
| **What people do** | Add an expense (1 + the form); check the month's list and total (0); delete a wrong one (3); switch month (1); occasionally import, export, or open a saved tab. |
| **Hide, merge, move** | One primary action (Add, or the + button from U6); Import and Export behind `⋯`. Month as one compact control (drop the field and Go, or open a month picker from the title). Saved tabs as a chip row; their filters behind a filter button with the count of active filters. The totals card can shrink to one line above the list. Rows get row actions instead of a visible trash icon per row. |

### Investments (`/investments`)

| | |
| --- | --- |
| **Shows** | Add investment (full width); Viewing chips; one card per broker with totals per currency, each asset (value, gain, quote source), and, after tapping an asset, its orders inline with Add order and remove buttons. |
| **What people do** | Look at the totals (0); add an order to an asset they hold (5 from Home); occasionally add a new investment. |
| **Hide, merge, move** | Under Money (U9). Add investment as a secondary action (`⋯` or the asset's own "Add order"); orders and their removal behind the asset. "Totals by currency" badge and the per-asset "Yahoo Finance" chip are detail: one line. Consider computing the order amount from quantity × price (a product question). |

### Net worth (`/net-worth`)

| | |
| --- | --- |
| **Shows** | Add item; Viewing chips; an attention banner ("Watch needs a current value"); the total card; groups (Investments, Cash, Property, Jewelry, Debts) with each entry's value, last valuation date and Add value / Edit details. When a value is missing the total card says "Incomplete", "Partial", "Partial known subtotal …" and "1 value need attention…": four lines for one fact. |
| **What people do** | Look at the total (0); add a new value for an account or a property, about monthly (4, plus 2 for the date). |
| **Hide, merge, move** | Under Money (U9). One status line on the total. "Add value" as the row's main action; "Edit details" in `⋯`. Default a new value's date to today. |

### Reminders (`/reminders`)

| | |
| --- | --- |
| **Shows** | Add reminder; Upcoming / Overdue · N / Done; rows with title, due date and time, repeat, a "Today" badge, Mark done, Snooze (menu) and Edit. The add dialog fills the phone screen: title (focused), notes, first date, time, repeat, notify-me chips, mute, and an optional expense. |
| **What people do** | Mark one done (3–4); snooze one (4); add one (4–6). |
| **Hide, merge, move** | Under Planning (U10). Overdue at the top of one list rather than a tab of its own (it's the most urgent group and today the least visible). Done on Home (U7). In the add form, notes, notify-me, mute and expense behind "More options"; default the date to tomorrow 09:00 when today's 09:00 has passed. |

### To-dos (`/todos`)

| | |
| --- | --- |
| **Shows** | "Showing" member chips (one row, scrolls sideways) and Due today / Overdue chips; a To do / In progress / Done control (one column at a time on a phone); "Add a card"; cards with due date, assignee and a ⇄ move button. The card dialog has title, notes, assignee, due date, Delete. |
| **What people do** | Add a card (4); move a card along (4); delete one (5); filter to "Me". |
| **Hide, merge, move** | Under Planning (U10). The one-column-per-screen control already works well on a phone; keep it rather than sideways-scrolling columns unless the mockup shows otherwise. Delete with swipe and undo (U12). Filters can collapse into one "Showing: Everyone ▾" control. |

### Calendar (`/calendar`)

| | |
| --- | --- |
| **Shows** | Subscribe and Add event; member chips; Today, previous and next (60 days); Month / Week / Agenda (Agenda is the phone default; Week shows 3 days). Agenda rows show date, time, title, place and member initials. The event dialog: title, all day, starts, ends, who's going, repeat, location, notes. |
| **What people do** | See what's coming (0 from Calendar, 2 from Home); add an event (4 + date and time). |
| **Hide, merge, move** | Under Planning (U10). Subscribe behind `⋯` (set up once). The plan says "week view on phones"; Agenda reads better at 390 px today, so let the mockup decide. Next few events on Home (U7). |

### More sheet

| | |
| --- | --- |
| **Shows** | Finance (Investments, Net worth), Planning (Reminders with its count, To-dos, Calendar), Settings, the account name, Sign out, and "Install iFam" instructions. A centred dialog ending at the screen's bottom. |
| **What people do** | Reach everything except Home and Expenses: every task in the table above that starts with "More" pays for it. |
| **Hide, merge, move** | U5's bar (Home, Money, +, Planning, More) moves Finance and Planning out; More keeps Settings, family pages, sign-out and install. |

### Settings

Seven tabs today (Account, Family, My permissions, Manage family, AI assistants, AI features, Notifications) in a sideways-scrolling row; at 390 px the last three start off-screen and the active one isn't scrolled into view.

| Page | Shows | What people do | Hide, merge, move |
| --- | --- | --- | --- |
| Account (`/settings`) | Picture; account currency (32-option select + Save); "Add an email address" (kids, username accounts); Sign out everywhere; Download my data; Delete my account. | Change the picture; rarely, the currency. | Group: Account. Currency to the bottom with B10's warning. **No "change password"** for a user who isn't forced to (product gap). |
| Family (`/settings/family`) | Without a family: Create and Join forms. With one: the members (avatar, name, @username, joined date). | See who's in the family. | Merge with Manage family into one Family page; parents get row actions. |
| My permissions (`/settings/permissions`) | A kid's modules (On / Off) and what parents can see; for a parent, one line ("Parents can use every part of the app"). | A kid checks what's on. | Only for kids, or a section of the Family page. |
| Manage family (`/settings/family/manage`, parents) | The members as a table with Colour, Permissions, Reset password, Delete account, Remove buttons per row; Add a kid; invites. | Invite someone; add a kid; change a kid's permissions. | Into the Family page; per-row actions in `⋯`. |
| AI assistants (`/settings/mcp`) | The switch, connected apps, personal access tokens. | Set up once. | Group: AI. Collapse for kids to one disabled row ("A parent can turn this on"). |
| AI features (`/settings/ai`) | The statement-reading switch and what is sent to OpenAI. | Turn on once. | Group: AI. Same for kids. |
| Notifications (`/settings/notifications`) | The browser-notifications switch (its fixed caption "Off: nothing is sent…" reads like a status while it's on), this device (blocked help, Send a test), and Reminders / To-dos / Calendar switches. | Turn kinds on or off; fix a blocked device. | Group: Notifications, near the top of the list (it's the setting people look for). Rewrite the caption. |

### Change password (`/change-password`)

Shown only when a parent reset a kid's password (`mustChangePassword`). One form, outside the shell. Fine as it is; U11 should decide whether the same form is reachable from Account.

### Sign in (`/login`) and join (`/join/[code]`)

| | |
| --- | --- |
| **Shows** | A card: "Sign in" (heading), a Sign in / Create account control, email or username, password (placeholder "At least 8 characters" even when signing in), Sign in, "or continue with" Google. "Sign in" appears three times. A signed-out `/join/<code>` redirects to `/login?next=/join/<code>` with nothing saying a family invite is waiting. |
| **What people do** | Sign in (type, 1 tap); a new parent creates an account; a kid signs in with a username. |
| **Hide, merge, move** | Drop the heading or the control's duplicate label; the password hint only when creating an account. When `next` is a join link, say so on the card ("Sign in to join The Danicicos"). Out of the screen tasks' folders today; U11 is the closest owner. |

### What a kid sees and can do

From `DEFAULT_KID_PERMISSIONS` (`src/lib/permissions.ts`: expenses on; investments, net worth, family finance, AI assistants and AI features off) and `navigationFor` / `settingsTabs`; counted from the code, since the preview has no kid mode (`?ai=kid` and `?kidEmail=1` preview parts of it).

- **Bottom bar:** Home, Expenses, More. **More:** Reminders, To-dos, Calendar, Settings (no Investments or Net worth). No Viewing chips (family finance is off), so a kid only sees their own money.
- **Can:** add and delete their own expenses, import statements (built-in readers only, AI is off), keep their own reminders, add, move and delete any family card, add and edit calendar events, set notifications, add an email address.
- **Settings:** six tabs (no Manage family). AI assistants and AI features show only "a parent can turn this on" (AI assistants also needs an email, which a username account doesn't have).
- **If a parent turns Expenses off:** the Expenses tab disappears and **Home becomes "This part of the app is turned off for you. Ask a parent."**, because the whole Home page is behind the expenses permission. U7's "today" Home must work without it (reminders, to-dos, events).
- **Hide, merge, move:** no tabs or rows that only say "ask a parent" (one disabled row in the AI group at most); Planning first for a kid without money modules.

## Bugs found on the way

None of these is in the audit or the plan. They are listed here so U6–U11 (or a small PR before them) pick them up.

| Bug | Where | Seen | Owner |
| --- | --- | --- | --- |
| A new expense defaults to the **last day of the selected month** (30 November on 4 November), so a quick save is future-dated. | `src/components/expenses/expense-form.tsx` (`defaultValue={maxDate}`) | Browser, Home and Expenses | U6 (or a fix now) |
| "Add value" defaults to the **last observation's date**, so a quick save **replaces** that observation instead of adding today's. | `src/components/net-worth/add-net-worth-valuation-dialog.tsx:89` | Browser, Net worth | U9 (or a fix now) |
| "Snooze for an hour" can end **before** the reminder is due ("Pay the rent", due 02:35, snoozed at 00:35 until 01:35). | `snoozeEnd` in `src/lib/reminders/schedule.ts:143` | Browser, Reminders | U10 (a product call) |
| The bottom bar's Expenses tab isn't active on `/expenses/import` (exact path match). | `src/components/layout/mobile-tab-bar.tsx:69` | Code | U5 |
| Every expense row is rendered twice (table and phone list, one hidden by CSS): 28 delete buttons for 14 expenses. | `src/components/expenses/expense-list.tsx` | Browser | U8 |
| The month field next to the Expenses stepper is cut off at 390 px ("November 202…"). | `src/components/expenses/month-toolbar.tsx` | Browser | U8 |
| Copy: "1 value need attention" (net worth); "Off: nothing is sent to any of your devices." as a switch caption that reads like a status. | `net-worth-summary.tsx`, `notification-cards.tsx:98` | Browser | U9, U11 |

Also measured: **no control in `/dev/ui` reaches 44 px at 390 px** (heights 28, 32 and 36 px) and 11 of the gallery's inputs and selects use 12–14 px text, which makes iOS zoom (U4). Audit B1 (more than two decimals) is already fixed on `main`.

## What each screen task should take on

One line per module, from its report in [simplification/](simplification/) and the screens above.

| Module | Task | Take on |
| --- | --- | --- |
| Layout | U4, U5 | `AppDialog` with `pending` (15 hand guards go), a `DataGate` for the loading/error ladder (14 places), a `ToggleChip` with 44 px touch size, `createApiContext` for API objects; U5: one `navigationFor` (drop `MORE_SECTIONS` / `MORE_ITEMS`), `isActivePath` in the tab bar, a Home that works without the expenses permission ([layout.md](simplification/layout.md)). |
| Expenses | U6, U8 | Fix the end-of-month date default first; one `LedgerPanel` for main and family; `expense-api.tsx` + hook with optimistic writes (D6, B4); one cache key per month; one list per breakpoint; Import and Export behind `⋯`, filters in a sheet ([expenses.md](simplification/expenses.md)). |
| Investments | U9 | `investment-api.tsx` + hook (not optimistic: orders can fail), the shared loading gate, Add order from the asset, a decision on computing the order amount ([investments.md](simplification/investments.md)). |
| Net worth | U9 | Value date defaults to today; one category table; drop the unused `onSuccess` props; `net-worth-api.tsx` + hook (optimistic only for valuations); one status line on the total ([net-worth.md](simplification/net-worth.md)). |
| Reminders | U10 | Overdue on the main list; tomorrow 09:00 as the default; decide Snooze before due; shared `daysBetween` / `monthsBetween` / `useNow`; chips through `ToggleChip` ([reminders.md](simplification/reminders.md)). |
| To-dos | U10, U12 | Shared family helpers with the calendar (`ToggleChip`, `memberDisplayName`, `NoFamilyState`, `useFamily`); `TodoQuickAdd` on `useApiForm` and reused by the quick-add sheet; swipe-to-delete with undo ([todos.md](simplification/todos.md)). |
| Calendar | U10 | The subscribe dialog's load on SWR (D6 leftover); date maths through `src/lib/calendar.ts` (9 hand parses); the same shared family helpers; let the mockup choose Agenda or Week on phones ([calendar.md](simplification/calendar.md)). |
| Family | U11 | `useFamily()` for 7 reads; `family-api.tsx` + hook for 12 files (D6); one member list for Family and Manage family with row actions; My permissions for kids only ([family.md](simplification/family.md)). |
| Settings | U5, U11 | One grouped list for the seven tabs; currency and email out of the page into cards on `useApiForm`; a `settings-api.tsx` so the previews stop calling the real API; the consent screen on `useApiForm`; a "change password" row ([settings.md](simplification/settings.md)). |

## Candidate lint rules

Patterns the reports found that a machine can check and that aren't in [lint-rules.md](lint-rules.md) yet. Counts are existing cases in `src/` (tests excluded) on 4 November 2026. Each would be added by the task named, with its fixes, as in "How the code gets cleaner on the way".

| Rule | Catches | Use instead | Existing cases | Add in |
| --- | --- | --- | --- | --- |
| `local/no-dialog-pending-guard` | An `onOpenChange` handler that tests `….pending` before calling through. | `AppDialog`'s `pending` prop. | 15 | U4 |
| `local/no-raw-toggle-button` | `aria-pressed` on a `Button` / `IconButton` outside `src/components/ui`. | `ToggleChip`. | 11 in 10 files | U4 |
| `local/no-hand-loading-ladder` | `if (isLoading && !data)` / `if (error && !data)` returning `DataLoading` / `DataError`. | `DataGate`. | 15 | U4 (warn), each screen task fixes its own |
| `local/no-reduced-motion-query` | `matchMedia("(prefers-reduced-motion…)")` outside the shared hook. | `useReducedMotion()`. | 1 | U4 (the plan already replaces the one case) |
| `local/use-is-active-path` | `pathname === href` in navigation code. | `isActivePath`. | 1 (`mobile-tab-bar.tsx`) | U5 |
| `local/use-route-context` | A hand-written `{ params: Promise<…> }` context type in a `route.ts`. | Next's global `RouteContext<"/path/[id]">`. | 19 (14 routes already use it) | U8, fixing all 19 (mechanical) |
| `local/no-hand-api-context` | `createContext<…Api>` in a module's `*-api.tsx`. | `createApiContext(restApi)`. | 4 | U8 (with the first new API object) |
| `local/no-hand-pending-state` | `const [pending, setPending] = useState(…)` in `src/components`. | `useApiForm` (`pendingAction` for several buttons). | 3 (`todo-quick-add.tsx`, `import-screen.tsx`, `consent-screen.tsx`) | U10 (U11 fixes the consent screen) |
| `local/no-hand-date-parse` | A template literal ending in `T00:00:00Z`, `T12:00:00Z`, `T00:00:00` or `T12:00:00` passed to `new Date()` or `Date.parse()` outside `src/lib/calendar.ts` and `src/lib/time-zone.ts`. | `addDays`, `daysBetween`, `dateInMonth` and the other helpers in `calendar.ts`. | 14 in 10 files (9 in `src/lib/family-calendar`) | U10 |
| `local/use-family-hook` | `useSWR` with `FAMILY_API_KEY` outside `useFamily` (the account already has `useAccount`, and nothing reads `ACCOUNT_API_KEY` directly). | `useFamily()`. | 7 | U11 |
| `local/use-member-name` | `….displayName ?? ….username` outside `src/lib/family`. | `memberDisplayName(member, fallback)`. | 16 | U11 |

Checks that need judgement, for the "Conventions" list in [lint-rules.md](lint-rules.md) rather than a rule:

- **A date field defaults to the day it's most likely to be:** today (from the application calendar) for something that happened, tomorrow 09:00 for something to remember. Never the end of a month or the last saved date. (Both date bugs above.)
- **A row isn't rendered twice for two breakpoints;** one list that adapts, or `useIsPhone()` choosing one.
- **A tab or row that only says "ask a parent" isn't shown;** collapse it into one disabled row.

## Notes for U3

- **Add to the preview before mocking:** a kid mode (`?role=kid`, with permissions), the family pages, My permissions and AI assistants, and in-memory APIs for expenses, investments, net worth and settings (the D6 conversions give them for free).
- **The preview leaves itself** when a screen pushes its own URL (expense tabs, Home's Summary / Monthly / History, settings tabs go to `/expenses?tab=…`, `/dashboard?view=…`, `/settings/…`). Query strings on the preview URL work instead: `/dev/preview/expenses?tab=tab-car`, `/dev/preview/dashboard?view=monthly`.
- **Use a visible browser pane for screenshots.** React 19.2 reveals streamed Suspense boundaries on `requestAnimationFrame`, which a hidden tab doesn't run, so the page stays on its skeletons. Not an app bug.
- Next's dev indicator ("N", bottom left) sits on top of the Home tab in development; ignore it in screenshots.
