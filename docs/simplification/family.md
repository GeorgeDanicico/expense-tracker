# Simpler ways: family

Looked at `src/components/family/**` (20 files, ~1,800 lines without tests), the family pages (`src/app/(app)/settings/family/**`, `settings/permissions`), `src/app/join/[code]`, `src/app/api/family/**`, `src/lib/family/**`, `src/lib/validation/family.ts` and `src/lib/mcp/tools/members.ts`, with the `find-shapes` script and by reading the components and the routes they call. **Family is the largest D6 conversion left: 12 component files call `apiRequest`** (of the 26 in `docs/lint-rules.md`). 5 proposals, about 110 lines; the one most worth doing is **a `useFamily()` hook and a `family-api.tsx`** (proposals 1 and 2), which U11 needs anyway.

## Map

| Area | Files | Notes |
| --- | --- | --- |
| Pages | `settings/family/page.tsx` (30), `settings/family/manage/page.tsx` (57), `settings/permissions/page.tsx` (43) | Family shows the members (or Create / Join without a family); Manage family repeats the members as a table with actions, then invites; My permissions lists a kid's modules. |
| Member lists | `family-members.tsx` (`MemberRow`, read-only), `manage-members.tsx` (172; `MemberRow` with five dialogs per row) | Two `MemberRow`s for the same members on two tabs. |
| Dialogs | `create-invite-`, `create-kid-`, `edit-permissions-`, `edit-color-`, `reset-password-`, `remove-member-`, `delete-kid-account-`, `delete-family-dialog.tsx`, `account-notice-dialog.tsx` | Each: `useApiForm`, `apiRequest`, an `after…` helper, and `if (!form.pending) onOpenChange(next)`. |
| Forms | `create-family-form.tsx`, `join-family-form.tsx` | Same pattern. |
| Viewing | `viewing-picker.tsx` (141), `write-only.tsx` | The "Viewing: Me / Family / Maria…" chips on finance screens. |

Counts: 12 component files with `apiRequest`; 7 `useSWR<FamilyResponse>(… FAMILY_API_KEY …)` reads app-wide (3 here, plus `use-viewing.ts`, `use-member-colors.ts`, the calendar and the board); 16 `displayName ?? username` expressions app-wide (8 here); 9 family dialogs guard closing while pending by hand (15 app-wide); `edit-color-dialog.tsx` and `edit-permissions-dialog.tsx` have the same `save` (52-node clone); the `color` and `permissions` member routes are the same 22 lines.

## Proposals

| # | Proposal | Lines saved | Risk | Files |
|---|---|---|---|---|
| 1 | A `useFamily()` hook for the 7 family reads | ~15 | Low | 8 |
| 2 | A `family-api.tsx` plus hook; the `after…` family helpers move into it | ~40 | Medium | 14 |
| 3 | One `memberDisplayName(member, fallback)` | ~0 lines; one rule, 16 places | Low | 14 |
| 4 | One member list for Family and Manage family | ~45 | Medium | 4 |
| 5 | `RouteContext` in the five `members/[id]` routes | ~5 | Low | 5 |

### 1. A `useFamily()` hook

**Why.** Cleanup plan task 9 did this for the account (`useAccount()`); the family read is still written out 7 times with its type and key, three of them conditional (`isParent ? FAMILY_API_KEY : null`, `hasFamily ? … : null`, `member && !family ? … : null`).

**Before**
```tsx
const { data } = useSWR<FamilyResponse>(allowed ? FAMILY_API_KEY : null);
```

**After**
```tsx
const { family } = useFamily({ enabled: allowed });   // src/hooks/use-family.ts
```

**Files.** New `src/hooks/use-family.ts`; `settings/family/page.tsx`, `settings/family/manage/page.tsx`, `viewing-picker.tsx`, `use-viewing.ts`, `use-member-colors.ts`, `calendar-screen.tsx`, `todo-board-screen.tsx`. **Lines saved.** ~15. **Risk.** Low: same key. **Proof.** `src/components/family/viewing.test.tsx`, `family-members.test.tsx`, `manage-members.test.tsx`; `npm test`.

### 2. A `family-api.tsx` plus hook

**Why.** U11 (D6). Twelve files each import `apiRequest`, a URL helper and an `after…` helper from `src/lib/api/invalidate.ts` (`afterFamilyJoined`, `afterFamilyChanged`, `afterInvitesChanged`, `afterMemberRemoved`, `afterFamilyDeleted`, `afterNoticeDismissed`: ~45 lines there). One `FamilyApi` (`create`, `join`, `createKid`, `createInvite`, `revokeInvite`, `setPermissions`, `setColor`, `resetPassword`, `remove`, `deleteKid`, `deleteFamily`, `dismissNotice`) with a provider makes the family pages previewable (they aren't in `PREVIEW_SCREENS` today) and puts the cache updates next to the writes. Not optimistic: these are rare writes whose result (an invite code, a kid's password) the user must see.

**Before** (`edit-color-dialog.tsx`, and the same in `edit-permissions-dialog.tsx`)
```tsx
const updated = await apiRequest<FamilyResponse>(familyMemberColorApiUrl(member.memberId), { method: "PATCH", body: JSON.stringify({ color }) });
await afterFamilyChanged(mutate, updated);
```

**After**
```tsx
await family.setColor(member.memberId, color);   // updates FAMILY_API_KEY itself
```

**Files.** New `family-api.tsx`; the 12 components; `invalidate.ts`. **Lines saved.** ~40 net. **Risk.** Medium (many dialogs; each keeps its fallback message). **Proof.** `family-forms.test.tsx`, `manage-members.test.tsx`, `manage-invites.test.tsx`, `account-notice-dialog.test.tsx`, `permission-list.test.tsx`; turn on `local/no-fetch-in-components` for `src/components/family`.

### 3. One `memberDisplayName`

**Why.** `member.displayName ?? member.username ?? "<fallback>"` is written 16 times (14 in components and hooks, 2 in `src/lib`) with five fallbacks ("Unnamed", "Family member", "this member", "this kid", ""). It's short, so the gain is one place to change how a member is named (U11 may want "@username" shown differently) and a lint rule so it stays one place. Put it in `src/lib/family/views.ts` next to `FamilyMemberView`.

### 4. One member list

**Why.** Family (`family-members.tsx`) and Manage family (`manage-members.tsx`) each render every member with their own `MemberRow`. On a phone, a parent sees the same people twice on two tabs, and Manage family's rows are a table with five buttons each. U11 merges the Family and Manage family pages: one list, each row with a `⋯` (`RowActions`, U4) holding Colour, Permissions, Reset password, Remove and Delete for parents, and nothing for kids.

**Lines saved.** ~45 (one `MemberRow`, one page). **Risk.** Medium: a UI change, needs George's sign-off with U11's screenshots. **Proof.** `family-members.test.tsx`, `manage-members.test.tsx` (both rewritten as one).

### 5. `RouteContext`

`src/app/api/family/members/[id]/route.ts`, `…/account`, `…/color`, `…/password`, `…/permissions` declare `{ params: Promise<{ id: string }> }` inline.

## Found on the way (for U11)

- **"My permissions" is a whole tab that says one line for parents** ("Parents can use every part of the app."). Show it only to kids, or fold it into the family page.
- **The join link sends a signed-out visitor to the plain sign-in screen** (`/join/<code>` → `/login?next=%2Fjoin%2F…`), with nothing saying they're about to join a family. A line on the sign-in card when `next` is a join link would help (auth is outside this module; noted in the audit).
- **Typed confirmations stay** for deleting a family, an account or a kid (the plan's decision); everything else here can close without a second dialog.

## Tidy-ups

- The `color` and `permissions` PATCH routes (`src/app/api/family/members/[id]/{color,permissions}/route.ts`) are the same shape: fine, explicit handlers are the convention.
- `NoticeDialog`, `isKidAccountEmail`, `Scheduler`, `CreatedKid`, `ViewedUser`, `familyMemberView` are exported but only used in their own files.
- Three member-route tests share a `beforeEach` (40 nodes): move the setup to `src/test/` if those files are touched.

## Considered and rejected

- **A "member dialog" factory for colour and permissions**: two dialogs with different bodies; the shared part is the save, which proposal 2 removes.
- **Moving role checks out of SQL**: audit D5 keeps them in SQL on purpose.

## Already simple

- `viewing-picker.tsx` and `write-only.tsx`: small and used everywhere.
- The routes: `withUser` → `requireFamilyFeature()` → parse → one call → `json`.
