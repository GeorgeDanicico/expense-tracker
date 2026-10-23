# MCP access plan (family hub phase 3)

This plan replaces password sign-in for MCP clients with two ways in: **OAuth**, where an app like
Claude asks for access and you click Allow, and **personal access tokens** for machines without a
browser. It also makes MCP something each user turns on in Settings. It replaces steps 3.1–3.5 of
[family-hub-roadmap.md](family-hub-roadmap.md); making `/api/mcp` reachable from the internet (for
claude.ai, the Claude phone app and ChatGPT) is a later step, described at the end.

Today an MCP client sends `Authorization: Basic base64(email:password)` on every request
([src/lib/mcp/auth.ts](../src/lib/mcp/auth.ts)). Your real password sits in every MCP client's
config, and anyone who reads that config can sign in to the web app as you.

## Decisions

| Question | Decision |
| --- | --- |
| Who runs the OAuth server? | **Supabase Auth's OAuth 2.1 server.** It handles discovery, dynamic client registration, PKCE, the token endpoint, refresh-token rotation, and the list of apps each user has allowed. We build the consent page. Its access tokens are ordinary Supabase user JWTs with an extra `client_id` claim, so RLS applies exactly as in the browser. |
| How do we avoid being tied to Supabase? | Every Supabase piece sits behind one of our interfaces, in `src/lib/supabase/` like the rest (see "Staying portable"). Leaving Supabase means new implementations of those interfaces and a config change, and each connected app showing its Allow page once more. |
| Is there an on/off switch? | Yes, one per user: **Settings → AI assistants → "Let AI assistants use your account"**, stored as `profiles.mcp_enabled`, **off by default**. While it's off, every app and every token of that user is refused. |
| What about kids? | A kid needs **all three**: a parent turns on their **AI assistants** permission (`mcp`: off / on, default off); the kid has a **confirmed real email** (not the generated `@kids.ifam.invalid` one); and the kid turns their own switch on. |
| Can kids use personal tokens? | **No, OAuth only.** A later kid permission (`personal_tokens`) can open this up; the checks below are written so that adding it is a small change. |
| How long do personal tokens last? | The user picks **1 month, 3 months (the default), 6 months or never**. Picking "never" shows a warning that we don't recommend tokens that never expire. |
| How many personal tokens? | At most **10** live ones (not revoked, not expired) per user. |
| Where do the access checks run? | **On every MCP request**, for both ways in. Turning the switch off, a parent turning a kid's permission off, revoking a token or disconnecting an app all take effect on the next request. |

## How it works

### OAuth, for apps with a browser

```
1. You add the app (for example `claude mcp add --transport http simple-ledger https://<app>/api/mcp`).
2. The app calls /api/mcp with no token → 401
     WWW-Authenticate: Bearer resource_metadata="https://<app>/.well-known/oauth-protected-resource/api/mcp"
3. The app reads that file: the authorization server is https://<ref>.supabase.co/auth/v1
4. The app reads Supabase's metadata and registers itself there (dynamic client registration)
5. Your browser opens Supabase's /oauth/authorize, which sends you to our /oauth/consent?authorization_id=…
6. Our consent page: sign in if needed → check your access → "Claude Code wants to use your account" → Allow
7. Supabase sends the browser back to the app with a one-time code; the app swaps it for tokens at Supabase
8. The app calls /api/mcp with Authorization: Bearer <Supabase access JWT>, refreshing it at Supabase as needed
```

On each request with an OAuth token, `/api/mcp`:

1. **Verifies the JWT** (signature, issuer, audience, expiry) and requires a `client_id` claim. A
   normal web-session JWT has none, so it gets 401 here.
2. **Checks the session is still live** with Supabase Auth. Disconnecting an app deletes its
   sessions, so the next call fails, instead of the last access token working for up to an hour.
3. **Checks access as that user** (`my_mcp_access()`): switch, kid permission, kid email.
4. **Runs the tools as that user**, on a client carrying that JWT, so RLS applies.

### Personal access tokens, for machines without a browser

For a server or Claude Code over Remote Control, where an OAuth redirect to `localhost` can't
complete. It works like GitHub's tokens.

**Creating one** (`POST /api/account/mcp/tokens`, all in one request):

```ts
import { createHash, randomBytes } from "node:crypto";

const secret = randomBytes(32).toString("base64url");   // 256 random bits → 43 characters
const token  = `sl_mcp_${secret}`;                       // what goes in the client's config
const prefix = token.slice(0, 13);                       // "sl_mcp_Ab3xQ9": shown in the token list
const hash   = createHash("sha256").update(token).digest("hex");
```

- `randomBytes` uses the operating system's secure random generator. 256 bits can't be guessed.
- The `sl_mcp_` prefix lets the server reject anything that isn't one of our tokens before it
  touches the database, and makes a token easy to spot in a config file or a log.
- Only the **hash** and the **display prefix** go to the database. A plain SHA-256 is right here:
  slow password hashes (bcrypt, argon2) exist because people pick weak passwords, and these tokens
  are random. An unsalted hash also means one indexed lookup per request.
- Signed-in users aren't granted `select` on `token_hash` at all, so no bug in our API can send a
  hash to the browser.

**Showing it once.** The plain token exists in three places, briefly:

1. The route's memory: it's returned once, as `{ token: {…metadata}, secret }`, with
   `Cache-Control: no-store`. The route never logs bodies or the `Authorization` header. The list
   endpoint's type has no field for the secret.
2. The HTTPS response.
3. React state in the "Copy your token" dialog. It's never written to the SWR cache,
   `localStorage`, `sessionStorage` or the URL: the page re-fetches the list, which has no secrets.
   The dialog shows the token in a read-only field with **Copy** (`navigator.clipboard.writeText`)
   and the filled-in `claude mcp add … --header "Authorization: Bearer sl_mcp_…"` command. Closing
   it clears the state; closing before copying asks "You won't see this token again. Close anyway?"

After that, the list shows `sl_mcp_Ab3xQ9…`, the name, when it was created and last used, its
expiry, **Regenerate** and **Revoke**. A lost token can't be recovered, by design: regenerate it.

**Using it.** On each request with a personal token, `/api/mcp`:

1. Checks the format, and the failure throttle for that IP and token prefix.
2. Hashes the token and calls `authenticate_mcp_token(hash)` (secret key only), which answers one of:
   `ok`, `unknown`, `revoked`, `expired`, `mcp_off`, `not_permitted`, `email_required`, or
   `kid_token` (the owner has since joined a family as a kid).
3. On `ok`, gets the cached session for that token, or opens one (below).
4. Runs the tools as that user.

**How a personal token acts as its user.** The database only trusts sessions Supabase Auth issued.
With the secret key, the server calls `auth.admin.generateLink({ type: "magiclink", email })`, which
returns a one-time `hashed_token` and **sends no email**, and immediately redeems it with
`verifyOtp({ token_hash, type: "email" })` on a fresh client. The result is an ordinary session for
that user, wrapped in the existing `AuthSession` type and cached in memory per token, refreshing
itself. This happens about once per token per server start. Each one counts as a sign-in for the
user (`last_sign_in_at` moves; the app tracks activity with `last_active_at`, so nothing visible
changes). It needs `SUPABASE_SECRET_KEY` in production, which the family hub needs anyway.

### Refusals

| Case | Answer |
| --- | --- |
| No token, unknown, revoked, expired or malformed token, OAuth session ended | **401** with `WWW-Authenticate: Bearer resource_metadata="…"` |
| Switch off | **403** "MCP is turned off for this account. Turn it on in Settings → AI assistants." |
| Kid without the permission | **403** "A parent needs to turn on AI assistants for you." |
| Kid without a real email | **403** "Add and confirm an email address in Settings to use AI assistants." |
| A kid's personal token | **403** "Kids connect AI assistants through the app's sign-in page, not with tokens." |
| Repeated bad tokens from one IP or token prefix | **429**, 5 in 15 minutes, as today |
| A session can't be opened for a valid personal token | **503**, so the client retries rather than discarding its token |

### What these tokens can't do

- **No REST API.** `getCurrentUser` refuses any bearer JWT with a `client_id` claim, so an OAuth
  token given to an app gets 401 on `/api/expenses`. Personal tokens aren't JWTs, so the REST API
  already refuses them.
- **No web sign-in, no password change.** Neither kind of token is a password.
- One honest gap: Supabase's OAuth access tokens are full user tokens. Someone holding one plus
  the project URL and the publishable key could call Supabase's own API directly as that user,
  under the same RLS as the app. Supabase doesn't support custom scopes yet; when it does, they
  close this.

## Staying portable

| Interface | What it does | Supabase implementation | If we leave Supabase |
| --- | --- | --- | --- |
| `McpAuthorizationServer` (`src/lib/mcp/authorization-server.ts`) | The authorization server's issuer URL; builds the protected-resource file and the 401 challenge | `SUPABASE_URL` + `/auth/v1` | Config |
| `OAuthConsent` (`src/lib/auth/oauth-consent.ts`) | Get a consent request, approve, deny, list connected apps, disconnect | `supabase.auth.oauth.*` | One new implementation |
| `AuthService.verifyAppToken` and `AuthService.sessionForAppToken` | Verify an OAuth access token and check its session is live; run as its user | `getClaims` + `getUser` on a bearer client | Usually a JWKS check |
| `AuthAdmin.startSessionForUser` | Turn a valid personal token into a session for its user | The admin magic-link session | One new implementation |
| `McpTokenRepository` | Personal tokens, the switch, the access check | Our own Postgres tables and functions | Moves with the database |

The consent page, the settings page, `/api/mcp` and the access rules only see these interfaces. The
existing lint rule keeps Supabase imports inside `src/lib/supabase/`.

## Tasks

The workflow is the same as phase 1 and the avatars: one task, one branch (`family/<id>-<slug>` from
`main`) and one PR, each done by a fresh agent, one at a time. George applies the two migrations at
checkpoint 1, before `main` is next deployed. The family hub is off in production, so nothing users
can reach changes in between.

| Task | What | Depends on |
| --- | --- | --- |
| — | **Checkpoint 0:** George turns on Supabase's OAuth server | — |
| P1 | Spike with George: Claude Code connects through Supabase OAuth over Tailscale (not merged; findings PR) | Checkpoint 0 |
| M1 | The `mcp` kid permission: SQL catalogue, TS catalogue, fixtures | — |
| M2 | Migration: the switch, the access rules, `mcp_tokens` and its functions | M1 |
| — | **Checkpoint 1:** George applies the M1 and M2 migrations | M1, M2 |
| M3 | OAuth interfaces and their Supabase implementations; the REST API refuses OAuth tokens | P1 |
| M4 | `AuthAdmin.startSessionForUser` and `AuthSession.end` | P1 |
| M5 | Token helpers and `McpTokenRepository` | M2 |
| M6 | `/api/mcp` accepts OAuth and personal tokens; the protected-resource file | M3, M4, M5 |
| M7 | The consent page and its API | M3, M5 |
| M8 | Settings API: the switch, personal tokens, connected apps | M3, M5 |
| M9 | Settings → AI assistants page | M8 |
| — | **Checkpoint 2:** George connects his clients the new ways | M6, M7, M9 |
| M10 | Remove Basic auth; README | Checkpoint 2 |

---

### Checkpoint 0: turn on Supabase's OAuth server

In the Supabase dashboard, **Authentication → OAuth Server**: turn on the OAuth 2.1 server, turn
on dynamic client registration, and set the authorization path to `/oauth/consent`. Check that the
Site URL is the app's address. This only adds endpoints at Supabase; nothing in the app uses them
yet.

### P1: Spike, with George

**Branch:** `family/p1-oauth-spike`, not merged. **Output:** a short PR adding "Spike findings" to
this plan, and corrections to the tasks below if the spike disproves anything.

Build the least that lets Claude Code connect: a bare consent page (Allow / Deny), the
protected-resource file, and `/api/mcp` accepting an OAuth JWT. Then George runs
`claude mcp add --transport http …` against the dev server, signs in and clicks Allow. Answer:

1. Does Claude Code discover, register and finish the flow against Supabase? Which scopes does it
   ask for, and does it send a `resource` parameter that Supabase accepts or ignores? What should the
   protected-resource file list in `scopes_supported`?
2. Does the project sign JWTs with an asymmetric key? Supabase needs one to issue ID tokens if a
   client asks for the `openid` scope.
3. On a second connect, does `getAuthorizationDetails` approve automatically (it returns a
   `redirect_url` instead of details)? See M7 for why this matters.
4. After `revokeGrant`, does `getUser(accessToken)` fail on the very next call?
5. Does the access token refresh after an hour without George doing anything?
6. Do `generateLink` + `verifyOtp` open a session for an adult account, with no email sent?
7. Does Next serve `/.well-known/oauth-protected-resource/api/mcp`, and does `src/proxy.ts` leave it
   alone? (Read the Next guide in `node_modules/next/dist/docs/` for route conventions first.)

#### Spike findings (2026-10-23)

Run against the dev server on `localhost:3000` and the live project, with Claude Code. The spike
code stays on `family/p1-oauth-spike` (not merged): a bare consent page, the protected-resource
route, `/api/mcp` accepting OAuth tokens, and a throwaway connected-apps page.

1. **Yes, the flow works end to end.** Claude Code read the protected-resource file, registered at
   Supabase (client name "Claude Code (<server name>)", redirect `http://localhost:<port>/callback`,
   no client URI), landed on `/oauth/consent?authorization_id=…` (the only query key), and after
   Allow called `/api/mcp` with a token we accepted; the tools ran as the user under RLS.
   - It asks for **`email` only**. `scopes_supported` should be `["email"]`.
   - The `resource` parameter never reaches us and Supabase ignores it: the token's `aud` is
     `authenticated`, not our URL. Don't check the audience against `/api/mcp`.
   - The access token carries `client_id`, `scope: "email"`, a `session_id`, and
     `amr: [{ method: "oauth_provider/authorization_code" }]`; it lasts 1 hour.
   - Supabase's metadata only lists `registration_endpoint` once dynamic registration is saved on.
2. **No asymmetric key yet**: the JWKS is empty and tokens are HS256. Not a blocker, since Claude
   Code never asks for `openid`. But until there is one, `getClaims(token)` is a round trip to
   Supabase Auth on every request. Adding an ES256 key is worth doing later; see 4 for what it
   changes.
3. **Auto-approve wasn't seen.** Clearing authentication in Claude Code makes it **register a new
   client** each time, so Supabase shows the consent page again and the old grant stays behind (two
   "Claude Code (simple-ledger-spike)" grants after one reconnect). Without clearing, Claude Code
   reuses its client. After a revoke, reconnecting the same client shows the consent page again. A
   `redirect_url` from `getAuthorizationDetails` for a client with a live grant is still untested,
   so M7 keeps handling it.
4. **Yes, a revoke is refused on the very next call**, with 56 minutes left on the access token.
   The refusal came from `getClaims` (HS256, so it asks Supabase), with "Auth session missing!".
   **Once the project has an asymmetric key, `getClaims` verifies locally and would accept a revoked
   token until it expires**, so the `getUser(token)` call in `verifyAppToken` is what makes
   disconnecting immediate. It must stay on every request.
5. **Refresh after an hour: assumed, not tested.** George chose not to wait the hour. Checkpoint 2
   checks it on the deployed app.
6. **`generateLink` + `verifyOtp`: not tested.** `.env.local` has no `SUPABASE_SECRET_KEY` yet. M4
   is built against mocks as planned; George adds the key locally and checkpoint 2 proves it.
7. **Yes.** `src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts` serves both URLs;
   `npm run build` lists it. The proxy matcher should skip `/.well-known/` (the proxy only refreshes
   cookies, so nothing breaks either way, but there's no cookie to refresh there).

What the spike changes in the tasks below:

- **M3:** inside an OAuth MCP call, `getCurrentUser()` must still find the user. A client created
  from a bare access token has no session, so `getClaims()` with no argument returns nothing and
  every repository that calls `getAuthenticatedUser()` (avatars, MCP tokens) would see no one. The
  spike gives `src/lib/supabase/server.ts` a `createTokenClient(token)` that remembers the token for
  the scoped run, and `getCurrentUser` falls back to it. M3 does the same.
- **M6:** `scopes_supported: ["email"]`. Put the `Bearer` challenge **first** when sending both,
  since MCP clients read `resource_metadata` from the first challenge. `resource` comes from
  `SITE_URL`, which must be exactly the address clients are given (the Tailscale name in production).
- **M8/M9:** expect several connected apps with the same name (one per registration). Show when each
  was connected, and make Disconnect per app, so old ones are easy to clear.

### M1: The `mcp` kid permission

**Files:** `supabase/migrations/<timestamp>_add_mcp_permission.sql` (the coordinator picks the
timestamp, after `20261018000100`), `supabase/tests/mcp_permission.sql`, `src/lib/permissions.ts`,
`src/test/fakes/family.ts`, and every test fixture that builds a full `Permissions` object
(`npm run check` finds them).

Three places list the catalogue and must change together (their comments say so):

1. The `member_permissions_level_allowed` check: drop it and add it again with `('mcp', 'off')` and
   `('mcp', 'edit')`.
2. `family_private.module_keys()`: `create or replace` it with `'mcp'` appended.
3. `family_private.is_valid_permissions(jsonb)`: `create or replace` it with the two new pairs.

Then backfill **pending kid invites**, whose stored permissions must stay a full catalogue object or
redemption refuses them:

```sql
update public.family_invites
set permissions = permissions || '{"mcp": "off"}'::jsonb
where role = 'kid' and not permissions ? 'mcp';
```

Existing kids need no rows: a missing module counts as `off`.

TypeScript: append `"mcp"` to `MODULE_KEYS`; `MODULE_LEVELS.mcp = ["off", "edit"]`;
`MODULE_LABELS.mcp = "AI assistants"`; `MODULE_LEVEL_LABELS.mcp = { off: "Off", edit: "On" }`;
`mcp: "off"` in `DEFAULT_KID_PERMISSIONS` and both presets. The permission editor, the permission
list and `get_family()` pick the new module up on their own.

**SQL tests:** only off and edit are allowed for `mcp`; `set_member_permissions` takes an object with
`mcp` and refuses one without it; a pending kid invite created before the migration still redeems;
`get_family()` reports `mcp: "off"` for an existing kid.

**Done when:** `npm run check`, `npm test` and the SQL tests pass. The diff touches no route or MCP
code.

### M2: Migration for the switch, the access rules and the tokens

**Files:** `supabase/migrations/<timestamp>_create_mcp_access.sql`, `supabase/tests/mcp_access.sql`,
`src/lib/database.types.ts`.

**The switch:** `profiles.mcp_enabled boolean not null default false`.

**The access rule**, in one private function that everything else calls:

```sql
-- Must match KID_EMAIL_DOMAIN in src/lib/family/kid-account.ts. Change both together.
create function mcp_private.kid_email_domain() returns text
language sql immutable set search_path = '' as $$ select 'kids.ifam.invalid' $$;

-- 'ok' | 'mcp_off' | 'not_permitted' | 'email_required', for any user. Ungranted.
create function mcp_private.access_status(p_user_id uuid) returns text ...
```

- `mcp_off` when `profiles.mcp_enabled` is false.
- For a member whose role is `kid`: `not_permitted` when their `mcp` permission is off;
  `email_required` when `auth.users.email` ends with `@` + `kid_email_domain()`. (A kid's new email
  replaces the generated one only once it's confirmed, so this is exactly "has a confirmed real
  email".)
- Otherwise `ok`.

**`my_mcp_access()`**, security definer, granted to `authenticated`: returns
`{ status, personalTokens }` for the caller, where `personalTokens` is false for kids. The consent
page, the settings page and `/api/mcp`'s OAuth path call it as the user.

**Switch guard:** a trigger on `profiles` (same pattern as `guard_profile_avatar_path`) refuses
(`42501`) turning `mcp_enabled` on as `authenticated` when the caller is a kid whose `mcp`
permission is off or who has no real email. Turning it off is always allowed. If `profiles` updates
are column-granted, grant `update (mcp_enabled)` to `authenticated`.

**Personal tokens:**

```sql
create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  prefix text not null,
  created_at timestamptz not null default now(),
  regenerated_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz,          -- null: never expires
  revoked_at timestamptz,
  constraint mcp_tokens_name_valid check (name = btrim(name) and char_length(name) between 1 and 40),
  constraint mcp_tokens_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint mcp_tokens_prefix_format check (prefix ~ '^sl_mcp_[A-Za-z0-9_-]{6}$')
);
create index mcp_tokens_user_id_idx on public.mcp_tokens (user_id);
```

- RLS on; `select` granted to `authenticated` on every column **except `token_hash`**, with a policy
  of `user_id = app_private.current_user_id()`. No insert, update or delete grants.
- **`create_mcp_token(p_name, p_token_hash, p_prefix, p_expiry)`**, security definer, granted to
  `authenticated`. `p_expiry` is one of `'1m'`, `'3m'`, `'6m'`, `'never'`; the function sets
  `expires_at` to `now() + interval '1 month'` (3, 6) or null, so the database accepts only those
  four choices. It refuses kids (`42501`) and an 11th live token (`P0001`, a message the API can
  show). It returns the new row without the hash.
- **`regenerate_mcp_token(p_id, p_token_hash, p_prefix, p_expiry)`**: the same checks, on one of the
  caller's tokens that isn't revoked (an expired one can be regenerated). It swaps in the new hash
  and prefix, resets `expires_at` from `p_expiry`, sets `regenerated_at = now()` and clears
  `last_used_at`, in one statement, so the old token stops working at once.
- **`revoke_mcp_token(p_id) returns boolean`**: sets `revoked_at` on the caller's own live token.
  Revoked rows are kept, for the record, and hidden from the list.
- **`authenticate_mcp_token(p_token_hash)`**, security definer, granted to **`service_role` only**.
  Returns `(status, token_id, user_id, email)`. Status, checked in this order: `unknown`, `revoked`,
  `expired`, `kid_token`, then `access_status(user_id)`. `email` comes from `auth.users` and is set
  only for `ok`. On `ok` it bumps `last_used_at` when that's null or more than 5 minutes old (the
  same throttle as `touch_last_active`).

Every function sets `search_path = ''`, revokes `all` from `public`, and has a `comment on`.

**SQL tests:**

- `access_status` for: an adult with the switch off and on; a kid with the permission off; a kid with
  the permission on and the generated email; a kid with the permission on and a real email; a user
  with no family.
- The switch guard for each of those; anyone can turn the switch off.
- A user lists only their own tokens, and can't select `token_hash` even on their own rows.
- A user can't insert, update or delete `mcp_tokens` directly.
- `create_mcp_token` accepts the four expiry choices and refuses any other; refuses kids; refuses an
  11th live token.
- `regenerate_mcp_token` and `revoke_mcp_token` on another user's token change nothing.
- `authenticate_mcp_token` returns every status, including `kid_token` after an adult with tokens
  joins a family as a kid; `authenticated` and `anon` can't execute it; `last_used_at` moves on the
  first call and not on a second a minute later.
- Deleting the user deletes their tokens.

**Done when:** the SQL tests pass and `database.types.ts` is regenerated.

### Checkpoint 1

George applies the M1 and M2 migrations to the live project, in that order. Claude applies them
through the Supabase MCP only on his explicit request at that time.

### M3: OAuth interfaces and their Supabase implementations

**Files:** `src/lib/mcp/authorization-server.ts`, `src/lib/auth/oauth-consent.ts`,
`src/lib/auth/service.ts`, `src/lib/auth/index.ts`, `src/lib/supabase/oauth-consent.ts`,
`src/lib/supabase/auth.ts`, `src/test/fakes/auth.ts`, a new `src/test/fakes/oauth-consent.ts`, and
tests.

```ts
// src/lib/mcp/authorization-server.ts
/** The OAuth authorization server MCP clients are sent to. */
export function getMcpAuthorizationServer(): { issuer: string };

// src/lib/auth/oauth-consent.ts
export type OAuthApp = { clientId: string; name: string; uri: string | null; logoUri: string | null };
export type ConsentRequest =
  | { kind: "needs_consent"; authorizationId: string; app: OAuthApp; redirectUri: string; scopes: string[] }
  | { kind: "already_approved"; redirectUrl: string };
export type ConnectedApp = OAuthApp & { scopes: string[]; connectedAt: string };

export interface OAuthConsent {
  /** Null when the request doesn't exist, has expired, or belongs to someone else. */
  getRequest(authorizationId: string): Promise<ConsentRequest | null>;
  approve(authorizationId: string): Promise<{ redirectUrl: string }>;
  deny(authorizationId: string): Promise<{ redirectUrl: string }>;
  listConnectedApps(): Promise<ConnectedApp[]>;
  /** Ends every session and refresh token the app holds for the caller. */
  disconnect(clientId: string): Promise<void>;
}

// Added to AuthService
/** The user behind an OAuth app's access token, or null if it's invalid, not an app token, or its session has ended. */
verifyAppToken(token: string): Promise<{ userId: string; email: string; clientId: string } | null>;
/** Runs as the user behind a verified app token. */
sessionForAppToken(token: string): AuthSession;
```

- The Supabase `verifyAppToken` calls `getClaims(token)`, requires `client_id`, then `getUser(token)`
  so a disconnected app fails at once. Keep `getUser` even after the project gets an asymmetric key:
  then `getClaims` checks the signature locally and can't see a revoke (spike finding 4).
- `sessionForAppToken` runs on a client created from the token, and `getCurrentUser` inside that run
  returns the token's user (spike: `createTokenClient` remembers the token for the scoped run),
  so repositories that call `getAuthenticatedUser()` keep working inside MCP calls. Test it.
- The Supabase `OAuthConsent` wraps `supabase.auth.oauth.*` on the request's client (the signed-in
  user), passing `skipBrowserRedirect: true`.
- **The REST API refuses app tokens:** `getCurrentUser` returns null for a bearer JWT with a
  `client_id` claim. Cookie sessions never carry one.

**Tests:** unit tests with a mocked Supabase client for each method, including a JWT without
`client_id`, an ended session, and an app token sent to a REST route (401).

### M4: A session for a user, from the server

**Files:** `src/lib/auth/admin.ts`, `src/lib/auth/service.ts`, `src/lib/supabase/auth-admin.ts`,
`src/lib/supabase/auth.ts`, `src/test/fakes/auth.ts` and their tests.

```ts
/**
 * Opens a session for this user without their password, for personal MCP tokens. It acts as the
 * user under RLS, exactly like one from `startSession`. Null when the account doesn't exist or the
 * provider refuses.
 *
 * SECURITY: anyone holding the result acts as that user. Call it only after the caller has proved
 * they may act for them (a valid, live personal token for that user).
 */
startSessionForUser(user: { id: string; email: string }): Promise<AuthSession | null>;
```

The Supabase implementation calls `generateLink` on the admin client, refuses if the returned user's
id isn't `user.id` (the email moved to another account in between), then `verifyOtp` on a fresh
publishable-key client, wrapped by the same helper `startSession` uses so the two can't drift.

Add `end(): Promise<void>` to `AuthSession`: signs out that session only (`scope: "local"`),
swallowing errors.

**Tests:** success; `generateLink` failing; `verifyOtp` failing; a mismatched user id; no
email-sending call; `end()` signs out with `local` scope. The fake gains `startSessionForUser`.

### M5: Token helpers and the repository

**Files:** `src/lib/mcp/tokens.ts`, `src/lib/mcp/token-repository.ts`,
`src/lib/supabase/repositories/mcp-tokens.ts`, `src/test/fakes/mcp-tokens.ts`,
`src/lib/repositories.ts`, `src/test/fakes/repositories.ts`, `src/lib/supabase/admin-client.ts`
(add the new file to the comment's list of callers), and tests.

`src/lib/mcp/tokens.ts`, pure: `generateMcpToken()` (the snippet above), `hashMcpToken(token)`,
`parseMcpToken(value)` (`^sl_mcp_[A-Za-z0-9_-]{43}$` or null), and
`MCP_TOKEN_EXPIRIES = ["1m", "3m", "6m", "never"]` with their labels.

```ts
export type McpTokenExpiry = "1m" | "3m" | "6m" | "never";
export type McpToken = {
  id: string; name: string; prefix: string;
  createdAt: string; regeneratedAt: string | null; lastUsedAt: string | null; expiresAt: string | null;
};
export type McpAccess = {
  status: "ok" | "mcp_off" | "not_permitted" | "email_required";
  personalTokens: boolean;
};
export type McpTokenCheck =
  | { status: "ok"; tokenId: string; user: { id: string; email: string } }
  | { status: "unknown" | "revoked" | "expired" | "kid_token" | Exclude<McpAccess["status"], "ok"> };

export interface McpTokenRepository {
  /** The caller's access: the switch, and for a kid the permission and email. */
  access(): Promise<McpAccess>;
  setEnabled(enabled: boolean): Promise<void>;
  /** The caller's tokens that aren't revoked (expired ones included), newest first. */
  list(): Promise<McpToken[]>;
  create(input: { name: string; hash: string; prefix: string; expiry: McpTokenExpiry }): Promise<McpToken>;
  regenerate(id: string, input: { hash: string; prefix: string; expiry: McpTokenExpiry }): Promise<McpToken>;
  revoke(id: string): Promise<boolean>;
  /**
   * Looks a personal token up by its hash, with no signed-in user.
   * SECURITY: runs with the secret key (authenticate_mcp_token is granted to service_role only).
   */
  check(hash: string): Promise<McpTokenCheck>;
}
```

Every method except `check` runs as the caller. Map database errors to `DomainError`s: 403 for kids
and the switch guard, 409 for the token cap, 404 for someone else's token, 422 for bad input.

**Done when:** the repository tests pass against the fake Supabase client, and the fake repository
follows the same rules.

### M6: `/api/mcp` accepts both kinds of token

**Files:** `src/lib/mcp/auth.ts`, `src/app/api/mcp/route.ts`,
`src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts` (or whatever P1 found works),
and tests.

- `Authorization: Bearer sl_mcp_…` → the personal-token path; any other `Bearer` → the OAuth path;
  `Basic` → unchanged until M10.
- **Personal-token path:** throttle check → `check(hash)` → cached session for the token id, or
  `startSessionForUser`. Concurrent first requests share one pending session. On any status but `ok`,
  the cached session is dropped and `end()`ed. The cache holds at most 20 sessions, oldest out first
  (and ended), shared with Basic.
- **OAuth path:** `verifyAppToken` → `sessionForAppToken` → `access()` inside it.
- Unknown, revoked, expired and malformed personal tokens count toward the throttle; access refusals
  don't (they're settings to fix, not guesses).
- **Protected-resource file** (served at both `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-protected-resource/api/mcp`):
  `{ resource: "<SITE_URL>/api/mcp", authorization_servers: [issuer], bearer_methods_supported: ["header"], scopes_supported: ["email"] }`.
  The proxy matcher skips `/.well-known/`.
- Don't check the token's audience against `/api/mcp`: Supabase sets `aud: "authenticated"` and
  ignores the `resource` parameter (spike finding 1).
- Responses as in "Refusals". Until M10, a request with no `Authorization` header gets both
  challenges in one header, **`Bearer resource_metadata=…` first**, then `Basic`.

**Route tests:** for each path, a valid token lists the owner's expenses, and user A's token never
sees user B's data. Every refusal in the table. Revoking a personal token after a successful call
refuses the next one and ends the cached session. A disconnected app is refused on the next call. Two
concurrent first calls open one session. Six bad tokens from one IP get 429. A Basic request still
works. A personal token sent to `/api/expenses` gets 401.

### M7: The consent page

**Files:** `src/app/oauth/consent/page.tsx`, `src/components/oauth/*`,
`src/app/api/oauth/authorizations/[id]/route.ts` (`GET`),
`src/app/api/oauth/authorizations/[id]/approve/route.ts` and `…/deny/route.ts` (`POST`), and tests.
The browser talks to our API, never to Supabase, as everywhere else.

- **Not signed in:** send the browser to `/login?next=/oauth/consent?authorization_id=…` and back
  afterwards (check `safeNextPath` allows it).
- **Access not `ok`:** show why (the messages in "Refusals", with a link to Settings where it helps)
  and a single **Back to the app** button, which calls deny so the app gets `access_denied`.
- **`already_approved`:** follow `redirectUrl` only if access is `ok`; otherwise deny, as above. The
  per-request check on `/api/mcp` would refuse anyway; this keeps the app from getting a code at all.
- **Consent:** "**{app name}** wants to use your Simple Ledger account". Show the app's address and,
  prominently, the host it will send you back to (`localhost` for Claude Code). Say what it can do:
  "Read and change your expenses, tabs, net worth and investments, as you, within your permissions."
  Warn: "Only allow apps you started connecting yourself." Anyone can register an app under any name,
  so the redirect host is what tells a real Claude apart from a fake one.
- **Allow / Deny** call our API, then `window.location.assign(redirectUrl)`.
- The page sits outside the app shell (no sidebar), styled like the sign-in pages.

**Done when:** component tests cover each state above, and route tests cover a non-owner's
authorization id (404) and an access refusal at approve (403). Screenshots at 390 and 1280 px, light
and dark, of: consent, access refused, and signed out.

### M8: Settings API

**Files:** `src/app/api/account/mcp/route.ts`, `src/app/api/account/mcp/tokens/route.ts`,
`src/app/api/account/mcp/tokens/[id]/route.ts`,
`src/app/api/account/mcp/tokens/[id]/regenerate/route.ts`, `src/app/api/account/mcp/apps/route.ts`,
`src/app/api/account/mcp/apps/[clientId]/route.ts`, `src/lib/validation/mcp.ts`,
`src/lib/api/keys.ts`, and tests. All behind `withUser`.

| Route | Does | Answers |
| --- | --- | --- |
| `GET /api/account/mcp` | Access, tokens and connected apps | `{ enabled, access: McpAccess, tokens: McpToken[] \| null, apps: ConnectedApp[] }`; `tokens` is null for kids |
| `PATCH /api/account/mcp` | `{ enabled: boolean }` | 200, same shape; 403 with the reason for a kid who can't turn it on |
| `POST /api/account/mcp/tokens` | `{ name, expiry: "1m" \| "3m" \| "6m" \| "never" }` | 201 `{ token, secret }`, with `Cache-Control: no-store`: the only response that ever carries a token; 403 for kids, 409 at the cap |
| `POST /api/account/mcp/tokens/[id]/regenerate` | `{ expiry }` | 200 `{ token, secret }`, `no-store`; 404 when it isn't yours or is revoked |
| `DELETE /api/account/mcp/tokens/[id]` | Revoke | 204; 404 when it isn't yours or is already revoked |
| `DELETE /api/account/mcp/apps/[clientId]` | Disconnect an app | 204 |

Creating, regenerating and revoking tokens are rate-limited per user with
`src/lib/http/rate-limit.ts`, as the avatar upload is.

**Route tests per role:** a user with no family; a parent; a kid with the permission off; a kid with
the permission on and no real email; a kid with both (can turn the switch on, still 403 on tokens);
another user's token and app ids.

### M9: Settings → AI assistants

**Files:** `src/app/(app)/settings/mcp/page.tsx`, `src/components/settings/mcp-*.tsx`,
`src/components/settings/settings-nav.tsx`, `src/app/(app)/settings/layout.tsx`,
`src/hooks/use-mcp-settings.ts`.

- A new tab, **AI assistants**, at `/settings/mcp`, for everyone, not only when the family module is
  on. Change `settingsTabs` and the layout's family-only redirect so it isn't sent back to
  `/settings`.
- **The switch:** "Let AI assistants use your account". When a kid can't turn it on, it's disabled
  with the reason: "A parent can turn on AI assistants for you in Manage family", or "Add and confirm
  an email address above to use AI assistants".
- **Connected apps** (while the switch is on): each app's name, address and when it was connected,
  with **Disconnect** behind a confirm. The same app can appear more than once (Claude Code registers
  again each time its authentication is cleared), so the connected date is what tells them apart. An empty state explains how to connect Claude Code
  (`claude mcp add --transport http simple-ledger <origin>/api/mcp`).
- **Personal access tokens** (adults, while the switch is on): "For machines without a browser, like
  a server or Claude Code over Remote Control. Use Connected apps wherever you can."
  - **Create:** a name and an **Expires** select: 1 month, 3 months (default), 6 months, Never.
    Choosing **Never** shows a warning right under the select: "We don't recommend tokens that never
    expire. This token would stay valid until you revoke it, so if it ever leaks, it keeps working.
    Pick an expiry unless this machine really needs a permanent token."
  - **The show-once dialog**, as described in "Showing it once".
  - **The list:** name, `sl_mcp_Ab3xQ9…`, created, last used ("Never" when unused), and expiry: "Expires
    in 12 days" (warning tone within 7 days), "Expired" (danger tone), or "Never expires" (warning
    tone). Each row has **Regenerate** (asks for an expiry, defaulting to 3 months, then the same
    dialog) and **Revoke** behind a confirm.
- With the switch off, both lists stay visible, with a note that everything is refused until it's
  turned back on.
- Add the cards to the UI gallery (`/dev/ui`).

**Done when:** component tests cover the kid states, the never-expires warning, the show-once dialog
(including the close-before-copying confirm) and revoke. Screenshots at 390 and 1280 px, light and
dark, of: switch off, a list with an expired and a never-expiring token, the new-token form with the
warning, and the show-once dialog.

### Checkpoint 2

On the deployed app, George:

1. Checks `SUPABASE_SECRET_KEY` is set in production.
2. Turns on AI assistants and connects Claude Code on his laptop through OAuth, over Tailscale.
3. On the VPS, creates a personal token and replaces the Basic header in Claude Code there.
4. Runs `get_account` and `list_expenses` from both.
5. Disconnects the app and revokes the token, and checks each next call is refused.
6. Signs in as a kid with a real email and the permission on, connects through OAuth, and runs
   `get_account`; then turns the kid's permission off and checks the next call is refused.

### M10: Remove Basic auth

**Files:** `src/lib/mcp/auth.ts`, `src/app/api/mcp/route.ts`, their tests, `README.md`.

- Delete `parseBasicCredentials`, the password-session cache and their tests.
  `AuthService.startSession` goes too if nothing else uses it.
- A Basic request gets 401 with only the `Bearer` challenge.
- README → "MCP / Claude": connecting through OAuth, personal tokens for headless machines, the
  switch, and the kid rules.

**Done when:** a Basic request gets 401 (a test pins it), and the README describes only the new ways
in.

## Later: reaching `/api/mcp` from the internet

claude.ai, the Claude phone app (which uses your claude.ai connectors) and ChatGPT call MCP servers
from their own servers, which can't reach a Tailscale-only app. When you want them:

- Expose **only** `/api/mcp` and `/.well-known/oauth-protected-resource*` publicly, for example with
  a Cloudflare Tunnel and path rules. Sign-in and the consent page open in your own browser, so they
  can stay on Tailscale; the token endpoint is Supabase's, which is already public.
- Add `MCP_PUBLIC_URL` for the `resource` in the protected-resource file, since it then differs from
  `SITE_URL`.
- Nothing else in this plan changes.

## Out of scope

- **Kids with personal tokens:** a later `personal_tokens` kid permission, checked in
  `create_mcp_token`, `regenerate_mcp_token` and `authenticate_mcp_token`.
- **Read-only access:** needs custom scopes from Supabase (OAuth) or a `scope` column (tokens), plus
  a check in `defineTool` for tools that write.
- **Expiry reminders by email:** after the notification work in phase 5.
- **Parents managing a kid's apps:** the permission switch is the parent's control.
