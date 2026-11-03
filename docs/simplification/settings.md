# Simpler ways: settings

Looked at `src/app/(app)/settings/**` (layout and seven pages; the family pages are in the family report), `src/components/settings/**` (12 files, ~1,900 lines without tests), `src/components/oauth/**`, `src/app/change-password`, `src/app/api/account/**`, `src/app/api/notifications/**`, `src/app/api/oauth/**` and the validation for account and notifications, with the `find-shapes` script and by reading every page and the larger cards. The cards are mostly lean; the weight is in **the pages doing card work** and **the seven-tab navigation** U5 and U11 replace. 5 proposals, about 70 lines. The one most worth doing is **moving the account page's two forms into cards on `useApiForm`** (proposal 1), which also clears one of the two page files `local/no-fetch-in-components` lists.

## Map

| Page | Lines | What it holds |
| --- | --- | --- |
| `settings/layout.tsx` + `settings-nav.tsx` | 33 + 80 | Page header and up to seven tabs (Account, Family, My permissions, Manage family, AI assistants, AI features, Notifications), a sideways-scrolling row. |
| `settings/page.tsx` (Account) | 186 | Picture (`AvatarCard`), the currency form and the "add an email" form **inline in the page**, then `SignOutEverywhereCard`, `DownloadDataCard`, `DeleteAccountCard`. |
| `settings/notifications/page.tsx` | 138 | Push support, this device's subscription and the test, in the page; three cards from `notification-cards.tsx` (277). |
| `settings/mcp/page.tsx` + `mcp-*.tsx` | 48 + ~700 | The AI assistants switch, connected apps, personal tokens (`mcp-tokens.tsx`, 318). |
| `settings/ai/page.tsx` + `ai-switch-card.tsx` | 31 + 101 | The AI statement-reading switch. |
| `oauth/consent-screen.tsx`, `consent-views.tsx` | 151, 233 | The consent page for an app asking for access. |

Counts: 1 page with `apiRequest` (`settings/page.tsx`, the currency PATCH) and 1 hand-kept `status` / `message` pair beside a `useApiForm` in the same file; 1 component with its own pending state (`consent-screen.tsx`, audit D6); 7 tabs, 3 of them off-screen at 390 px.

## Proposals

| # | Proposal | Lines saved | Risk | Files |
|---|---|---|---|---|
| 1 | `CurrencyCard` and `AddEmailCard` out of the account page, both on `useApiForm` | ~20 | Low | 3 |
| 2 | One settings list instead of `settingsTabs` + `SettingsNav` (U5/U11) | ~40 | Medium | 4 |
| 3 | A `settings-api.tsx` for account, notifications, AI and MCP writes | ~15, D6 closed | Medium | 6 |
| 4 | The consent screen on `useApiForm` | ~8 | Low | 1 |
| 5 | Move the push-subscription logic out of the notifications page into a hook | ~0 lines; previewable page | Low | 2 |

### 1. Two cards out of the account page

**Why.** `settings/page.tsx` keeps `status` (`"idle" | "saving" | "saved" | "error"`) and `message` by hand for the currency form, with its own `try/catch`, while the email form in the same file uses `useApiForm`. Each form also renders ~45 lines of card inside the page. As cards (like the five already in `src/components/settings`), the page becomes a list of cards, and the currency card can carry the B10 warning U8 settles ("existing amounts are not converted").

**Before**
```tsx
const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
const [message, setMessage] = useState("");
async function saveCurrency(event) { event.preventDefault(); setStatus("saving"); … try { … setStatus("saved"); } catch (caught) { setStatus("error"); setMessage(…); } }
```

**After**
```tsx
const form = useApiForm();
function save(event) { event.preventDefault(); void form.submit(async () => { await account.setCurrency(currency); setSaved(true); }, { fallback: "The currency could not be saved." }); }
```

**Files.** `settings/page.tsx`, new `currency-card.tsx` and `add-email-card.tsx`. **Lines saved.** ~20. **Risk.** Low. **Proof.** `src/app/api/account/route.test.ts` (server unchanged), a card test for the saved and error states; `npm test`.

### 2. One settings list

**Why.** U5 and U11's brief. `settingsTabs()` builds up to seven tabs, `activeSettingsTab()` picks the longest match, and `SettingsNav` styles a scrolling row; at 390 px "AI assistants", "AI features" and "Notifications" start off-screen (measured: x = 403, 509 and 603 px) and the active tab isn't scrolled into view. A grouped list (Account, Family, Notifications, AI) whose rows link to the same URLs replaces all three functions with one table of rows filtered by the same rules (`features.family`, `role === "parent"`). The URLs stay, so links from notifications and the MCP block messages keep working.

**Lines saved.** ~40 (the nav's styling and the active-tab logic). **Risk.** Medium: a navigation change, signed off with U5. **Proof.** `src/components/settings/settings-nav.test.ts` (rewritten for the list's rows per kind of user).

### 3. A `settings-api.tsx`

**Why.** D6 for settings: the currency PATCH, email change, avatar upload and delete, notification settings, push subscribe and unsubscribe, the AI switch, the MCP switch and tokens. Several already go through `src/lib/api/account-requests.ts` and the `use-notification-settings`, `use-ai-settings` and `use-mcp-settings` hooks, so this is mostly gathering them behind one provider so `/dev/preview/settings`, `notifications` and `ai-settings` stop sending writes to the real API (the preview notes that they fail when signed out).

**Risk.** Medium (many small writes). **Proof.** `notification-settings.test.tsx`, `mcp-settings.test.tsx`, `ai-settings.test.tsx`, `avatar-card.test.tsx`; turn on `local/no-fetch-in-components` for `src/components/settings`, `src/components/oauth` and `src/app/(app)/settings`.

### 4. The consent screen on `useApiForm`

**Why.** `consent-screen.tsx:105` keeps `pending` and `decisionError` by hand (audit D6). `useApiForm`'s `pendingAction` covers "which button is pending"; the 401 redirect stays in the callback. ~8 lines. **Proof.** `src/components/oauth/consent.test.tsx`.

### 5. Push subscription in a hook

**Why.** `settings/notifications/page.tsx` holds `support`, `subscribed`, `testMessage` and an effect that reads the service worker. As `usePushSubscription()` next to `use-notification-settings.ts`, the page is three cards and the preview can fake the device state (today `?devices=0` only fakes the server half).

## Found on the way (for U11)

- **There is no "change password" in Settings.** `/change-password` exists only for a forced change (`mustChangePassword`); a user who wants to change theirs has no way in. A product gap for U11's Account group (audit P5 asks for the current password there).
- **"Browser notifications: Off: nothing is sent to any of your devices."** is the switch's fixed description, so it reads as the current state even when the switch is on (seen in `/dev/preview/notifications`). Say what the switch does ("Turn off to stop every notification") instead.
- **For a kid, "AI assistants" and "AI features" are tabs that only say "a parent can turn this on".** In the list, show them as one disabled row with that line, or hide them.
- **Account currency is a native select of 32 currencies plus a Save button**: 3 taps for a setting changed once; fine, but it belongs at the bottom of Account, not second.

## Tidy-ups

- `SettingsTab`, `ConsentScreenState`, `consentPath`, `ConsentFrame`, `AVATAR_TYPES`, `AVATAR_MAX_BYTES`, `deletionBlockedReason`, `MCP_BLOCK_MESSAGES`, `SecretDialogState`, `SecretDialogEvent`, `tokenDisplayPrefix`, `tokenMeta`, `ExpirySelect` are exported but used only in their own files (or tests).
- `src/app/api/account/notices/[id]/dismiss/route.ts` and `src/app/api/family/invites/[id]/route.ts` are token-for-token alike (12 lines); fine as they are.

## Considered and rejected

- **Splitting `mcp-tokens.tsx` (318 lines)**: it reads top to bottom (list, create, reveal, revoke); splitting would add files without removing code.
- **One generic "switch card"** for the AI and MCP switches: different blocked states and copy; they'd drift.

## Already simple

- `AvatarCard`, `DownloadDataCard`, `SignOutEverywhereCard`, `DeleteAccountCard`: one card, one action each.
- `useOrigin` in `mcp-command.tsx` uses `useSyncExternalStore` correctly for a server-safe origin.
