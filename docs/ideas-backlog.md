# Ideas backlog: budgets and the AI consultant, the iOS app, a lock screen to-do widget

Written 27 November 2026 from a planning conversation. These are ideas with a recommendation each,
not decided plans. Each section stands on its own, so a new session can pick one up. The spending
comparisons (category, car subtype, merchant and recurring payments, shown as insights) are being
worked on separately and aren't covered here.

## 1. Monthly budget and an AI spending consultant

**The idea.** You set a monthly budget. When you go over it, or are on track to, the app gives smart
recommendations and offers a chat with an AI consultant that knows what you spent in the previous
month or months and helps you work out where to cut.

**What already exists.**

- The AI gate (`src/lib/ai/gate.ts`, migration `20261030000100_create_ai_gate.sql`): per-user opt-in,
  a kid `ai` permission, a cost ledger, $3 a month per family, a global backstop and a kill switch. A
  new AI feature is a row in `AI_FEATURES` (`src/lib/ai/index.ts`) plus its model in the environment.
- The roadmap already plans **8.6 Assistant chat** on the MCP tools and **8.7 Monthly summary**
  ("the numbers computed in code, the text written by the model") in
  [family-hub-roadmap.md](family-hub-roadmap.md). The consultant should build on those, not beside them.
- The notification outbox and worker (`src/lib/notifications/worker.ts`) for budget alerts. It needs
  a new `kind`; today the check allows only `reminder`, `todo_assigned`, `todo_due` and `test`.
- No budgets table yet.

**Recommended principle.** Code computes every number (totals, deltas, recurring payments, the
projection); the model only explains, ranks and talks about those facts. Send the model computed
summaries, not raw transactions, so it stays cheap, private and checkable.

**Still to decide (needs a proper grilling session before any code).**

- *Budget shape:* one monthly total, or per category too? Personal, or one family budget shared
  between spouses? Does an unspent amount carry over? Fixed every month, or can it change per month?
- *Trigger:* only when actually over, or also when the projection says you'll go over (from which
  day of the month)? Warning levels (e.g. 80%, 100%)?
- *Consultant input:* which facts and how many past months? Merchant level or category level only?
- *Consultant output:* free chat, or a structured plan ("cut takeaway by 300 lei"), and does it
  follow up next month on whether the plan worked?
- *Monitoring:* alert channel and timing, how often the AI may run, its cost limit per conversation
  and per month (inside the $3 family budget or on top?), and how to judge whether the advice is any
  good (did spending actually drop?).

Write the decisions into a `docs/budgets-plan.md` in the same style as the other plans.

## 2. The iOS app: Expo, the Apple fee, and whether to split the backend

**The concern.** Without the paid Apple developer account an app has to be reinstalled every week,
and an Expo app calling the Next.js backend may not make sense, so maybe the app should move to a
dedicated backend first.

**Facts.**

- With a free Apple account, an app you sign and install yourself expires after **7 days** and must
  be reinstalled from Xcode (and at most 3 such apps at once). The **$99/year** developer account
  removes that and adds TestFlight. There's no way around it for a native app on a real iPhone.
- The roadmap already decided (decision 1 in [family-hub-roadmap.md](family-hub-roadmap.md)): keep
  Next.js as the web app **and** the backend, and add Expo as a second client in phase 9.
- Next.js route handlers in `src/app/api/**` *are* a backend. A native client calling them is a
  normal setup. The real native-specific work is auth: the web uses cookies, a native app needs
  bearer tokens (roadmap step 1.2; bearer handling already appears in `src/lib/supabase/auth.ts`).

**Recommendation.** Don't split the backend for this. A separate backend pays off for long-running
jobs or heavy load, and the worker container already covers background jobs. Stay with the PWA
(service worker and Web Push already work on iOS 16.4+ once added to the Home Screen) until there's
a native-only feature you really want, then decide on the $99 fee. Revisit a separate backend only
if a concrete limit of Next.js shows up.

## 3. A lock screen widget with the to-dos my wife assigns me

**The idea.** When my wife creates a to-do for me, I see it in the app, and when I wake the iPhone,
a lock screen widget shows my to-do list.

**What already exists.**

- The push notification: `todo_assigned` in `src/lib/notifications/worker.ts` ("Ana assigned you Buy
  milk"), and a 09:00 "Due today" push. These already show on the lock screen as notifications.
- A token-protected, read-only feed pattern: the calendar feed at
  `src/app/api/calendar/feed/[token]` with its link endpoint `src/app/api/calendar/feed-link`.

**Limits.**

- A PWA **can't** add a lock screen widget on iOS. Widgets need a native app with WidgetKit, which
  brings back the Apple fee question in section 2.
- A widget doesn't depend on the app being open. iOS refreshes widgets on its own schedule (roughly
  every 15–30 minutes, not instantly), so a new to-do can take a while to appear. The push
  notification is the instant signal; the widget is the glanceable list.

**Recommendation: a Scriptable widget, no Apple fee.** Scriptable (free on the App Store) runs a
small JavaScript file that can render lock screen widgets (iOS 16+) from a URL.

1. Add a read-only to-do feed in the same style as the calendar feed: a per-user secret token,
   created and revoked from Settings, returning the caller's open to-dos (assigned to them) as JSON,
   ordered by due date. Only the fields the widget needs: title, due date, who assigned it.
2. Ship a short Scriptable script (e.g. in `docs/` or downloadable from Settings) that fetches the
   feed and shows the top 3 open to-dos, with a count of the rest. Tapping it opens the app's to-do
   page.
3. The phone must reach the app's URL, as the calendar feed does (over Tailscale today).

If the native app is built later, the same feed (or the bearer-token API) can back a real WidgetKit
widget.
