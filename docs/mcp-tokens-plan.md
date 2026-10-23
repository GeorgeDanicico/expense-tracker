# MCP access tokens plan (family hub phase 3, steps 3.1–3.4)

This plan replaces password sign-in for MCP clients with personal access tokens, and makes MCP
something each user turns on in Settings. It covers steps 3.1–3.4 of
[family-hub-roadmap.md](family-hub-roadmap.md). Step 3.5 (OAuth for claude.ai connectors) waits for
a public HTTPS URL and isn't part of it.

Today an MCP client sends `Authorization: Basic base64(email:password)` on every request
([src/lib/mcp/auth.ts](../src/lib/mcp/auth.ts)). The server signs in with the password through
`AuthService.startSession` and caches the session in memory. Your real password therefore sits in
every MCP client's config, and anyone who reads that config can sign in to the web app as you.

## The design in one page

| Question | Answer |
| --- | --- |
| What does a client send? | `Authorization: Bearer sl_mcp_<43 base64url characters>`: 32 random bytes with a recognisable prefix. |
| What's stored? | Only the token's **SHA-256** (hex) in `mcp_tokens.token_hash`, and a display prefix such as `sl_mcp_Ab3xQ9`. The full token is shown once, when it's created. A plain hash is enough because the token is 256 random bits; a slow password hash would add nothing. |
| How does a token act as its user? | **The server opens a real Supabase session for the token's owner** (see "How a token acts as its user" below). Every MCP call runs on that session, so RLS, Storage policies and `auth.uid()` behave exactly as they do in the browser. Nothing on the MCP path reads data with the secret key. |
| Who can use MCP? | Anyone who turns on **Settings → AI assistants**. `profiles.mcp_enabled` defaults to `false`. A kid also needs the new **AI assistants** permission (`mcp`: off / on, default off), which a parent sets like any other module. |
| Who sees and revokes tokens? | **Only their owner.** Parents don't see a kid's tokens; they turn the kid's `mcp` permission off, which refuses all of the kid's tokens at once. |
| What happens on every request? | One RPC looks the token up by its hash and returns one of: ok, unknown, revoked, expired, MCP off, or not permitted. Revoking a token, turning MCP off or removing a kid's permission works **on the next request**, even when a session for that token is cached. |
| What do refusals look like? | Unknown, revoked or expired → **401** with `WWW-Authenticate: Bearer realm="simple-ledger"`. MCP off or kid not permitted → **403** with a message that says what to change. Repeated failures from one IP or token prefix → **429**, with the same limits as today (5 in 15 minutes). |
| How long do tokens last? | 30 days, 90 days, 1 year or never, picked at creation. A user can hold at most **10** live tokens (not revoked and not expired). |
| Do tokens work on the REST API? | **No.** Only `/api/mcp` accepts them. `getCurrentUser` treats any other bearer token as a Supabase JWT, so a token sent to `/api/expenses` fails with 401. |
| And Basic auth? | It keeps working, unchanged and ignoring `mcp_enabled`, until **M8** removes it. That way your current client keeps working between deploys, and you switch over when the Settings page exists. |
| Is there a flag? | No. Token auth (M5) is harmless before the UI ships, because no token can exist yet, and the whole UI ships in one task (M7). |

### How a token acts as its user

**Chosen: an admin magic-link session.** With the secret key, the server calls
`auth.admin.generateLink({ type: "magiclink", email })`. That returns a one-time `hashed_token` and
sends **no email**. A fresh publishable-key client redeems it right away with
`auth.verifyOtp({ token_hash, type: "email" })`. The result is an ordinary Supabase session for that
user: a signed access token with a `session_id`, and a refresh token. It's wrapped in the existing
`AuthSession` type (`run`, `isActive`), the same type `startSession` returns today, so the MCP route
and the tools don't change. The session is cached in memory per token id and refreshes itself, as
today's password sessions do.

Why not sign our own short-lived user JWT, as the roadmap first suggested:

1. **The app has no signing key.** The project uses the new `sb_publishable_` / `sb_secret_` API
   keys. Signing JWTs ourselves would mean either the legacy JWT secret, which Supabase is phasing
   out, or importing a private key of our own into the project's JWT signing keys and keeping it in
   the app's environment. That key would be a second master secret able to impersonate anyone, not
   only MCP users.
2. **Key rotation would silently break MCP.** Rotating signing keys in the dashboard is routine, and
   a key the app holds separately would fall out of step.
3. **A hand-made JWT has no session behind it.** It can't be refreshed or signed out, and its claims
   would have to track whatever Supabase's services expect (`aud`, `role`, `session_id`, `aal`).

Why not use the secret key directly with an explicit `user_id` filter: it bypasses RLS on every
MCP call. The roadmap ruled that out.

Costs we accept:

- **Each cold start creates an auth session for the user.** The first request on a token after a
  server start, or after its cached session fails to refresh, mints a session. That moves the user's
  `last_sign_in_at` and adds a row to `auth.sessions`. The app tracks activity with
  `family_members.last_active_at`, so nothing user-facing changes. Sessions left behind by restarts
  expire under the project's normal refresh-token rules.
- **Supabase rate-limits OTP verification per IP**, and every verification comes from our server.
  The cache keeps minting to about once per token per server start, far below the limit. A failed
  mint answers 503 (not 401), so a client retries rather than discarding its token.
- **Kid accounts have synthetic emails** (`@kids.ifam.invalid`). `generateLink` sends nothing, so
  this works in principle; M3 tests it against a kid account at checkpoint 2.
- **Token auth needs `SUPABASE_SECRET_KEY` in production.** The family hub needs it too. Without
  it, bearer requests answer 503 and Basic auth keeps working.

### Request flow

```
Bearer  client ──POST /api/mcp, Authorization: Bearer sl_mcp_…──▶ Next route
          route: Origin guard → parse header → format check → throttle check (IP, prefix)
                 → sha256(token) → authenticate_mcp_token(hash) via the secret key
                     unknown / revoked / expired → 401     mcp off / not permitted → 403
                 → cached AuthSession for token id, or mint one:
                     admin.generateLink(magiclink, email) → verifyOtp(token_hash) on a fresh client
                 → session.run(MCP transport) → 200

Basic   unchanged until M8.
```

`authenticate_mcp_token` also bumps `last_used_at` when it's more than 5 minutes old, the same
throttle `touch_last_active` uses, so a busy client doesn't write on every call.

## Tasks

The workflow is the same as phase 1 and the avatars: one task, one branch
(`family/<id>-<slug>` from `main`) and one PR, each done by a fresh agent, one at a time. George
applies the two migrations at checkpoint 1, before `main` is next deployed. The family hub is off in
production, so the brief gap between M1 merging and the migration landing touches nothing users can
reach.

| Task | What | Depends on |
| --- | --- | --- |
| M1 | The `mcp` kid permission: SQL catalogue, TS catalogue, fixtures | — |
| M2 | Migration: `profiles.mcp_enabled`, `mcp_tokens`, RPCs, SQL tests | M1 |
| — | **Checkpoint 1:** George applies the M1 and M2 migrations | M1, M2 |
| M3 | `AuthAdmin.startSessionForUser` and `AuthSession.end` | — (can run alongside M1–M2) |
| M4 | Token helpers and `McpTokenRepository` | M2 |
| M5 | Bearer token auth on `/api/mcp`, alongside Basic | M3, M4 |
| M6 | Settings API: the switch, create, list and revoke | M4 |
| M7 | Settings → AI assistants page | M6 |
| — | **Checkpoint 2:** George creates a token and switches his clients to it | M5, M7 |
| M8 | Remove Basic auth; README | Checkpoint 2 |

---

### M1: The `mcp` kid permission

**Files:** `supabase/migrations/<timestamp>_add_mcp_permission.sql` (the coordinator picks the
timestamp, after `20261018000100`), `supabase/tests/mcp_permission.sql`,
`src/lib/permissions.ts`, `src/test/fakes/family.ts`, and every test fixture that builds a full
`Permissions` object (`npm run check` finds them).

Three places list the catalogue and must change together (their comments say so):

1. The `member_permissions_level_allowed` check on `member_permissions`. Drop it and add it again
   with `('mcp', 'off'), ('mcp', 'edit')`.
2. `family_private.module_keys()`: `create or replace` it with `'mcp'` appended.
3. `family_private.is_valid_permissions(jsonb)`: `create or replace` it with the two new pairs.

Then backfill **pending kid invites**, whose stored `permissions` must stay a full catalogue object or
redemption refuses them:

```sql
update public.family_invites
set permissions = permissions || '{"mcp": "off"}'::jsonb
where role = 'kid' and not permissions ? 'mcp';
```

Existing kids need no rows: a missing module counts as `off`.

TypeScript (`src/lib/permissions.ts`):

- `MODULE_KEYS`: append `"mcp"`.
- `MODULE_LEVELS.mcp = ["off", "edit"]`.
- `MODULE_LABELS.mcp = "AI assistants"`, `MODULE_LEVEL_LABELS.mcp = { off: "Off", edit: "On" }`.
- `DEFAULT_KID_PERMISSIONS.mcp = "off"`. Both presets get `mcp: "off"`.

The permission editor, the permission list and `get_family()` pick the new module up on their own.
Keep the existing kid-permission UI tests passing and add one that shows the new row.

**SQL tests:** a kid can't get an `mcp` level other than off or edit; `set_member_permissions` takes
an object with `mcp` and refuses one without it; a pending kid invite created before the migration
still redeems; `get_family()` reports `mcp: "off"` for an existing kid.

**Done when:** `npm run check`, `npm test` and the SQL tests pass. The diff touches no route or MCP
code.

### M2: Migration for the switch and the tokens

**Files:** `supabase/migrations/<timestamp>_create_mcp_tokens.sql`, `supabase/tests/mcp_tokens.sql`,
`src/lib/database.types.ts`.

**Schema:**

```sql
alter table public.profiles
  add column mcp_enabled boolean not null default false;

create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint mcp_tokens_name_valid check (name = btrim(name) and char_length(name) between 1 and 40),
  constraint mcp_tokens_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint mcp_tokens_prefix_format check (prefix ~ '^sl_mcp_[A-Za-z0-9_-]{6}$'),
  constraint mcp_tokens_expiry_after_creation check (expires_at is null or expires_at > created_at)
);

create index mcp_tokens_user_id_idx on public.mcp_tokens (user_id);
```

**Access:**

- `enable row level security` on `mcp_tokens`.
- **Select:** grant `select` to `authenticated` on every column **except `token_hash`**, with a policy
  of `user_id = app_private.current_user_id()`. No insert, update or delete grants for `authenticated`
  or `anon`.
- **`create_mcp_token(p_name text, p_token_hash text, p_prefix text, p_expires_at timestamptz)`**,
  security definer, granted to `authenticated`. It inserts for the caller only, refuses (`42501`) a
  kid whose `mcp` permission is off, refuses (`P0001`, a message the API can show) an 11th live
  token, and checks that `p_expires_at` is null or in the future. It returns the new row without the
  hash. The server generates the token and passes only its hash, so the database never sees the
  token.
- **`revoke_mcp_token(p_id uuid) returns boolean`**, security definer, granted to `authenticated`. It
  sets `revoked_at = now()` on the caller's own live token and returns whether a row changed. Revoked
  rows are kept, for the record.
- **`authenticate_mcp_token(p_token_hash text)`**, security definer, granted to **`service_role`
  only**. It returns `(status text, token_id uuid, user_id uuid, email text)`, where `status` is one
  of `ok`, `unknown`, `revoked`, `expired`, `mcp_off` or `not_permitted`. `email` is read from
  `auth.users` (not `profiles`, which can lag behind an email change) and is set only for `ok`. On
  `ok` it bumps `last_used_at` when that's null or more than 5 minutes old. "Not permitted" means the
  user is a kid in a family and their `mcp` permission is off.
- **`profiles.mcp_enabled` guard:** a trigger, the same pattern as `guard_profile_avatar_path`,
  refuses (`42501`) changing it to `true` as `authenticated` when the caller is a kid whose `mcp`
  permission is off. Turning it off is always allowed. Check how `profiles` updates are granted
  today; if updates are column-granted, grant `update (mcp_enabled)` to `authenticated`.

Every function sets `search_path = ''`, revokes `all` from `public`, and has a `comment on`.

**SQL tests:**

- A user lists only their own tokens, and `token_hash` can't be selected even for their own rows.
- A user can't insert, update or delete `mcp_tokens` directly.
- `revoke_mcp_token` on another user's token returns false and changes nothing.
- `create_mcp_token` refuses an 11th live token, and refuses a kid with `mcp` off.
- `authenticate_mcp_token` returns each status; `authenticated` and `anon` can't execute it.
- `last_used_at` moves on the first call and not on a second call a minute later.
- A kid with `mcp` off can't turn `mcp_enabled` on; a parent and a user with no family can; anyone
  can turn it off.
- Deleting the user deletes their tokens.

**Done when:** the SQL tests pass and `database.types.ts` is regenerated.

### Checkpoint 1

George applies the M1 and M2 migrations to the live project, in that order. Claude applies them
through the Supabase MCP only on his explicit request at that time.

### M3: A session for a user, from the server

**Files:** `src/lib/auth/admin.ts`, `src/lib/auth/service.ts`, `src/lib/supabase/auth-admin.ts`,
`src/lib/supabase/auth.ts`, `src/test/fakes/auth.ts` and their tests.

Add to `AuthAdmin`:

```ts
/**
 * Opens a session for this user without their password, for MCP access tokens. The session acts as
 * the user under RLS, exactly like one from `startSession`. Null when the account doesn't exist or
 * the provider refuses.
 *
 * SECURITY: anyone holding the result acts as that user. Call it only after the caller has proved
 * they may act for them (a valid, live MCP token for that user).
 */
startSessionForUser(user: { id: string; email: string }): Promise<AuthSession | null>;
```

The Supabase implementation calls `auth.admin.generateLink({ type: "magiclink", email })` on the
admin client, checks that the returned user's id matches `user.id` (refuse otherwise, in case the
email moved to another account in between), then calls `verifyOtp({ token_hash, type: "email" })` on
a fresh publishable-key client and wraps that client as `startSession` does. Move the wrapping into
one shared helper so the two can't drift.

Add `end(): Promise<void>` to `AuthSession`: it signs the session out on the provider
(`signOut({ scope: "local" })`) and swallows errors. `startSession` sessions get it too.

**Tests:** unit tests with a mocked Supabase client cover: success; `generateLink` failing;
`verifyOtp` failing; a mismatched user id; that no email-sending call is made; and that `end()` calls
`signOut` with `local` scope. The fake gains `startSessionForUser` with the same failure switches as
`startSession`.

**Done when:** the tests pass. Nothing calls the new method yet.

### M4: Token helpers and the repository

**Files:** `src/lib/mcp/tokens.ts` (+ test), `src/lib/mcp/token-repository.ts`,
`src/lib/supabase/repositories/mcp-tokens.ts` (+ test), `src/test/fakes/mcp-tokens.ts`,
`src/lib/repositories.ts`, `src/test/fakes/repositories.ts`, `src/lib/supabase/admin-client.ts`
(add the new file to the comment's list of callers).

`src/lib/mcp/tokens.ts`, pure and with no Supabase:

- `generateMcpToken(): { token: string; hash: string; prefix: string }`: `randomBytes(32)` as
  base64url, prefixed `sl_mcp_`. The display prefix is `sl_mcp_` plus the first 6 random characters.
- `hashMcpToken(token)`: SHA-256 as lowercase hex.
- `parseMcpToken(value)`: the token if it matches `^sl_mcp_[A-Za-z0-9_-]{43}$`, else null.
- `MCP_TOKEN_EXPIRIES = { "30d", "90d", "1y", "never" }` and `expiryDate(choice, now)`.

`McpTokenRepository`:

```ts
export type McpToken = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

export type McpTokenCheck =
  | { status: "ok"; tokenId: string; user: { id: string; email: string } }
  | { status: "unknown" | "revoked" | "expired" | "mcp_off" | "not_permitted" };

export interface McpTokenRepository {
  /** The caller's live tokens (not revoked; expired ones included, so the page can say so), newest first. */
  list(): Promise<McpToken[]>;
  /** Stores a token for the caller. Only the hash and the display prefix reach the database. */
  create(input: { name: string; hash: string; prefix: string; expiresAt: string | null }): Promise<McpToken>;
  /** Revokes one of the caller's tokens. False when there's no such live token. */
  revoke(id: string): Promise<boolean>;
  /** Whether the caller has MCP on. */
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  /**
   * Looks a token up by its hash, with no signed-in user.
   * SECURITY: runs with the secret key (authenticate_mcp_token is granted to service_role only).
   */
  check(hash: string): Promise<McpTokenCheck>;
}
```

Every method except `check` runs as the caller, through the request's client. Map the RPC errors to
`DomainError`s: 403 for a kid without permission, 409 for the token cap, 422 for a bad name or
expiry.

**Done when:** the repository tests pass against the fake Supabase client, and the fake repository
follows the same rules (cap, kid permission, owner-only revoke).

### M5: Bearer token auth on `/api/mcp`

**Files:** `src/lib/mcp/auth.ts` (+ test), `src/app/api/mcp/route.ts` (+ test).

- `parseMcpAuthorization(request)` returns `{ kind: "bearer", token } | { kind: "basic", credentials } | null`.
  A bearer value that fails `parseMcpToken` counts as a failure (401), with no lookup.
- `getMcpTokenSession(token, clientIp)` checks the throttle (keys: `ip:<ip>` and `prefix:<prefix>`),
  hashes the token, calls `check`, and on `ok` returns the cached session for that token id or mints
  one with `startSessionForUser`. Cached sessions are checked with `isActive()` as today, and
  concurrent first requests share one pending mint.
- On any status other than `ok`, the token's cached session (if any) is dropped and `end()`ed.
- Unknown, revoked, expired and malformed tokens count toward the throttle. `mcp_off` and
  `not_permitted` don't, because they're settings to fix, not guesses.
- The cache is capped (20 sessions, oldest out first, ended on eviction) and shares the cap with
  Basic sessions.
- Route responses: 401 with `WWW-Authenticate: Bearer realm="simple-ledger"` for unknown, revoked,
  expired or malformed tokens; 403 `{ error: "MCP is turned off for this account. Turn it on in Settings → AI assistants." }`
  for `mcp_off`; 403 `{ error: "A parent needs to turn on AI assistants for you." }` for
  `not_permitted`; 429 when throttled; 503 when the mint fails or the secret key is missing. A
  request with no `Authorization` header answers 401 with both `Bearer` and `Basic` challenges until
  M8.
- Basic auth is untouched.

**Route tests:** a valid token lists the owner's expenses; revoked, expired, unknown, malformed,
MCP-off and kid-without-permission tokens get the status above; user A's token never returns user B's
data; revoking a token after a successful call refuses the next call and ends the cached session; two
concurrent first calls mint once; six bad tokens from one IP get 429; a Basic request still works.

**Done when:** the tests pass, and an MCP token sent to `/api/expenses` gets 401 (a test pins it).

### M6: Settings API

**Files:** `src/app/api/account/mcp/route.ts`, `src/app/api/account/mcp/tokens/route.ts`,
`src/app/api/account/mcp/tokens/[id]/route.ts`, `src/lib/validation/mcp.ts`, `src/lib/api/keys.ts`,
and tests. All behind `withUser`, so they take cookies or a bearer JWT like every other route.

| Route | Does | Answers |
| --- | --- | --- |
| `GET /api/account/mcp` | The switch, whether the caller may use MCP, and their tokens | `{ enabled, allowed, tokens: McpToken[] }` |
| `PATCH /api/account/mcp` | `{ enabled: boolean }` | 200 with the same shape; 403 for a kid without permission turning it on |
| `POST /api/account/mcp/tokens` | `{ name, expiry: "30d" \| "90d" \| "1y" \| "never" }` | 201 `{ token: McpToken, secret: "sl_mcp_…" }`, the only response that ever carries the full token; 403 or 409 from the repository |
| `DELETE /api/account/mcp/tokens/[id]` | Revoke | 204, or 404 when there's no such live token of yours |

`POST` and `DELETE` on tokens are rate-limited per user with `src/lib/http/rate-limit.ts`, as the
avatar upload is. Responses carry
`PRIVATE_HEADERS`, and the `POST` response adds `Cache-Control: no-store`.

**Route tests per role:** a user with no family, a parent, a kid with `mcp` off (403 on enabling and
creating; `GET` reports `allowed: false`), a kid with `mcp` on, and another user's token id (404 on
revoke).

**Done when:** the tests pass.

### M7: Settings → AI assistants

**Files:** `src/app/(app)/settings/mcp/page.tsx`, `src/components/settings/mcp-*.tsx`,
`src/components/settings/settings-nav.tsx`, `src/app/(app)/settings/layout.tsx`,
`src/hooks/use-mcp-settings.ts`.

- A new tab, **AI assistants**, at `/settings/mcp`. It shows for everyone, not only when the family
  module is on. Change `settingsTabs` and the layout's "family pages only" redirect so that
  `/settings/mcp` isn't sent back to `/settings`.
- **The switch:** "Let AI assistants use your account". Off by default. For a kid without the
  permission, it's disabled with "A parent can turn on AI assistants for you in Manage family".
- **Create a token** (shown while the switch is on): a name and an expiry select (30 days, 90 days,
  1 year, never; default 90 days). On success, a dialog shows the token once, with a copy button,
  "You won't see this token again", and ready-to-paste setup for **Claude Code** and **Claude
  Desktop** with the token and the app's address (`window.location.origin`) filled in.
- **The token list:** name, prefix (`sl_mcp_Ab3xQ9…`), created, last used ("Never" when null), and
  expiry, with "Expired" in the danger tone. Each row has Revoke, behind a confirm dialog.
- Turning the switch off keeps the list visible, with a note that every token is refused until it's
  turned back on.
- Add the page's components to the UI gallery (`/dev/ui`) where the other settings cards are.

Claude Code setup shown on the page:

```bash
claude mcp add --transport http simple-ledger https://<app>/api/mcp -s user --header "Authorization: Bearer sl_mcp_…"
```

Claude Desktop (`mcp-remote`):

```json
{
  "mcpServers": {
    "simple-ledger": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<app>/api/mcp", "--header", "Authorization:${AUTH}"],
      "env": { "AUTH": "Bearer sl_mcp_…" }
    }
  }
}
```

**Done when:** component tests cover the kid-without-permission state, the one-time dialog and
revoke. There are screenshots at 390 and 1280 px, in light and dark, of: the switch off, the list with
an expired token, and the new-token dialog.

### Checkpoint 2

On the deployed app, George:

1. Checks that `SUPABASE_SECRET_KEY` is set in production.
2. Turns on AI assistants, creates a token, and replaces the Basic header in Claude Code and Claude
   Desktop with it.
3. Runs `get_account` and `list_expenses` from Claude Code.
4. Turns on the permission for a kid account, signs in as the kid, creates a token and runs
   `get_account` with it. This proves the magic-link session works for `@kids.ifam.invalid` emails.
5. Revokes a token, and checks that the next call is refused.

If step 4 fails, M8 waits and the kid path gets a follow-up task. Adult tokens keep working either
way.

### M8: Remove Basic auth

**Files:** `src/lib/mcp/auth.ts`, `src/app/api/mcp/route.ts`, their tests, `README.md`.

- Delete `parseBasicCredentials`, the password-session cache and their tests. `AuthService.startSession`
  stays only if something else uses it; otherwise remove it from the interface, the Supabase
  implementation and the fake.
- A Basic request gets 401 with only the `Bearer` challenge.
- README → "MCP / Claude": token setup only, pointing at Settings → AI assistants. Mention that MCP
  is off until you turn it on, and that a kid needs a parent to allow it.

**Done when:** a Basic request gets 401 (a test pins it), and the README describes token setup only.

## Out of scope

- **OAuth 2.1 for claude.ai connectors** (roadmap 3.5). It needs a public HTTPS URL. With tokens in
  place, OAuth adds a consent screen that issues the same kind of token, so this design carries
  over.
- **Scoped tokens** (read-only, or per module). Every token can do whatever its owner can, and a
  kid's module permissions still apply through `defineTool`. Read-only tokens are a small later
  addition: a `scope` column, and a check in `defineTool` for tools that write.
- **Parents managing a kid's tokens.** The permission switch is the parent's control.
