# Avatars plan (family hub phase 2, steps 2.1–2.3)

This plan covers profile pictures: storing them, uploading them, serving them and showing them. It
replaces the avatar parts of steps 2.1–2.3 in [family-hub-roadmap.md](family-hub-roadmap.md).
Display-name editing (the rest of 2.1) is not part of it. Member colours already exist (#88, #92).

## The design in one page

| Question | Answer |
| --- | --- |
| Where are the image bytes? | A **private** Supabase Storage bucket, `avatars`. |
| What's the object key? | `<user_id>/<uuid>.webp`, all lowercase. A new uuid on every upload. |
| What does the database store? | `profiles.avatar_path`: the object key, never a URL. |
| What can users upload? | JPG or PNG only, up to **5 MB** and **40 megapixels**. |
| What gets stored? | Always a **256×256 WebP** (quality 80), re-encoded by the server with `sharp`. Re-encoding drops all metadata (EXIF, GPS) and anything hidden in the original file. |
| Who can change a picture? | **Only its owner.** Nobody can upload, replace or remove another person's picture: not a parent for a kid, not the family's creator. No route takes a user id for a write, the repository's write methods act only on the signed-in caller, and the database only accepts a key inside the profile owner's own folder. |
| Who writes to Storage? | **Only our server**, with the secret key. Signed-in users have no insert, update or delete policy on the bucket, so a user can't skip the server's checks by calling Storage with their own token. |
| Who sets `avatar_path`? | Only the server (the secret key). A trigger refuses changes from the `authenticated` and `anon` roles, the same pattern as `username` (F04). |
| How is an avatar read? | Through our API: `GET /api/avatars/<userId>/<uuid>`. The route downloads the object **as the caller**, so Storage's read policy decides who may see it: yourself and the members of your family. Anyone else gets 404. |
| How does caching work? | A new upload gets a new uuid, so each URL's content never changes. The route answers `Cache-Control: private, max-age=31536000, immutable`: a browser downloads each avatar once. |
| What does the client get? | `avatarUrl` (the API path above, or `null`) on each family member and on the account response. |

Why images are served by our API and not through Storage signed URLs:
- **Consistent with uploads:** every byte goes through the server, as decided.
- **Faster pages:** signed URLs would cost a Storage call each time `getFamily()` runs, and every finance route runs it.
- **Better caching:** a signed URL changes every time one is created, which defeats browser caching. Our URL stays the same until the picture changes.
- **Works for native apps unchanged:** React Native's `<Image source={{ uri, headers }}>` can send the bearer token.

The URL has **no `.webp` extension** on purpose. `src/proxy.ts` skips paths ending in `.webp`, and those requests would then miss the session refresh.

### Request flow

```
Upload  browser ──PUT /api/account/avatar (raw JPG/PNG bytes)──▶ Next route
          route: auth → rate limit → Content-Type → read body ≤ 5 MB → magic bytes
                 → sharp (decode, auto-rotate, 256×256 cover, WebP q80, no metadata)
                 → Storage upload with the secret key → profiles.avatar_path = new key
                 → delete the old object → 200 { avatarUrl }

Read    browser ──GET /api/avatars/<userId>/<uuid>──▶ Next route
          route: auth → validate both ids → Storage download as the caller (RLS)
                 → 200 image/webp (cached forever) | 404
```

## Tasks

The workflow is the same as phase 1: one task, one branch (`family/<id>-<slug>` from `main`) and
one PR. Tasks depend on each other in order. The single migration is in A1, and George applies it
to the live project at the checkpoint after A1 merges.

| Task | What | Depends on |
| --- | --- | --- |
| A1 | Migration: `profiles.avatar_path`, its guard, the bucket, the read policy, `get_family()` | — |
| — | **Checkpoint:** George applies the A1 migration | A1 |
| A2 | `sharp` image pipeline and body-size reader | — (can run alongside A1) |
| A3 | `AvatarRepository`: interface, Supabase implementation, fake, wiring | A1 |
| A4 | API: upload, remove, serve; `avatarUrl` on the account and family responses | A2, A3 |
| A5 | `<Avatar>` UI primitive and gallery entry | — (can run alongside A1–A4) |
| A6 | Settings → Profile picture card, sidebar, more sheet, family list | A4, A5 |

---

### A1: Migration and SQL tests

**Files:** `supabase/migrations/<timestamp>_add_profile_avatars.sql` (the coordinator picks the
timestamp, after `20261016001100`), `supabase/tests/profile_avatars.sql`,
`supabase/tests/support/legacy-bootstrap.sql` (only if needed, see below),
`src/lib/database.types.ts`.

**Before writing SQL:** check that the test image has the `storage` schema:

```bash
docker run --rm -d --name avatar-check -e POSTGRES_PASSWORD=x supabase/postgres:17.4.1.054
```

```bash
docker exec avatar-check psql -U supabase_admin -d postgres -c '\d storage.buckets' -c '\d storage.objects' -c '\df storage.foldername'
```

```bash
docker rm -f avatar-check
```

The Supabase image normally creates `storage.buckets`, `storage.objects` and `storage.foldername()`.
The bucket's `file_size_limit` and `allowed_mime_types` columns are added later by the Storage
service, so the image may not have them. The migration below copes with both. If the schema is
missing altogether, add the guarded stub at the end of this task to `legacy-bootstrap.sql`.

**Migration:**

```sql
begin;

-- Profile pictures (docs/avatars-plan.md, A1).
--
-- profiles.avatar_path is the key of the member's picture in the private
-- `avatars` bucket: '<user id>/<uuid v4>.webp'. Only the server writes it (the
-- secret key), right after it uploads the re-encoded image; the API roles can't.
-- Only the server writes objects too: there is no insert, update or delete
-- policy on the bucket. Signed-in users may read their own pictures and those
-- of their family; the API reads them as the caller, so this policy decides.

alter table public.profiles
  add column avatar_path text,
  add constraint profiles_avatar_path_format check (
    avatar_path ~ (
      '^' || id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
    )
  );

comment on column public.profiles.avatar_path is
  'Key of the profile picture in the avatars bucket (<id>/<uuid>.webp), or null. Set only by the server.';

-- Same pattern as guard_profile_username (20261015182916): refuse the API roles,
-- let trusted writers (the service role, migrations, security definer
-- functions) through. Must stay security invoker: current_user is what tells
-- them apart.
create function public.guard_profile_avatar_path()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
    and new.avatar_path is distinct from (
      case when tg_op = 'UPDATE' then old.avatar_path else null end
    )
  then
    raise exception 'Profile pictures can only be set by the server.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_profile_avatar_path() from public, anon, authenticated;

create trigger profiles_guard_avatar_path
before insert or update of avatar_path on public.profiles
for each row execute function public.guard_profile_avatar_path();

-- The bucket. Private: objects are reachable only through policies or the
-- secret key. The size and type limits are a second line behind the server's
-- own checks; older storage schemas (the SQL test image) lack those columns.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets
    set file_size_limit = 262144, allowed_mime_types = array['image/webp']
    where id = 'avatars';
  end if;
end;
$$;

-- The user ids (as text, matching storage.foldername()) whose pictures the
-- caller may see: their own, and everyone in their family. Text, not uuid, so a
-- malformed object name can never make the policy throw.
create function family_private.visible_avatar_owner_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct owner_id::text), '{}')
  from (
    select app_private.current_user_id() as owner_id
    union
    select m.user_id
    from public.family_members m
    where m.family_id = family_private.my_family_id()
  ) owners
  where owner_id is not null
$$;

revoke all on function family_private.visible_avatar_owner_ids() from public, anon;
grant execute on function family_private.visible_avatar_owner_ids() to authenticated;

comment on function family_private.visible_avatar_owner_ids() is
  'User ids (text) whose avatars the caller may read: the caller and their family''s members.';

-- Read only. The (select ...) wrapper makes Postgres run the function once per
-- statement instead of once per row.
create policy avatars_select_self_or_family on storage.objects
for select to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = any ((select family_private.visible_avatar_owner_ids()))
);

-- get_family(): identical to 20261016001100 plus each member's avatarPath.
-- (Copy that function verbatim and add the one line marked below.)
create or replace function public.get_family()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'family', jsonb_build_object(
      'id', f.id,
      'name', f.name,
      'createdAt', f.created_at
    ),
    'members', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'memberId', m.id,
          'userId', m.user_id,
          'role', m.role,
          'isCreator', m.user_id = f.creator_id,
          'displayName', coalesce(
            p.display_name,
            p.username,
            nullif(split_part(u.email, '@', 1), '')
          ),
          'username', p.username,
          'currency', coalesce(p.currency, 'EUR'),
          'color', m.color,
          'avatarPath', p.avatar_path,   -- new
          'joinedAt', m.joined_at
        )
        || case
          when caller.role = 'parent' or m.id = caller.id then jsonb_build_object(
            'lastActiveAt', m.last_active_at,
            'permissions', family_private.member_permissions_json(m.id)
          )
          else '{}'::jsonb
        end
        order by m.user_id = f.creator_id desc, m.role = 'parent' desc, m.joined_at, m.id
      ), '[]'::jsonb)
      from public.family_members m
      left join public.profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.family_id = f.id
    )
  )
  from public.family_members caller
  join public.families f on f.id = caller.family_id
  where caller.user_id = app_private.current_user_id()
$$;

revoke all on function public.get_family() from public, anon;
grant execute on function public.get_family() to authenticated;

comment on function public.get_family() is
  'The caller''s family and members as camelCase JSON, or null without a family. Every member entry has its currency (EUR without a profile row), its chosen color (null for automatic) and its avatarPath (null without a picture). lastActiveAt and permissions appear for every member to parents, and only on their own entry to kids.';

commit;
```

The existing `profiles.avatar_url` column (from Supabase's starter schema) is unused by the app.
Leave it alone.

**Stub for `legacy-bootstrap.sql`, only if the image has no `storage` schema.** Every statement is
guarded, so it does nothing on an image that has the real schema:

```sql
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select on storage.objects to authenticated;
do $$
begin
  if to_regprocedure('storage.foldername(text)') is null then
    create function storage.foldername(name text) returns text[] language sql immutable
      as 'select (string_to_array(name, ''/''))[1:array_length(string_to_array(name, ''/''), 1) - 1]';
  end if;
end;
$$;
```

**pgTAP test `supabase/tests/profile_avatars.sql`.** Follow `family_member_color.sql`: insert
users, families and members as the table owner, then `set local role authenticated` and switch
`request.jwt.claims`. Use the id prefix `a7a00000`. The users: family A has 01 (creator), 02 (parent)
and 03 (kid); family B has 04 (creator); 05 has no family. Insert one object per user as the owner:

```sql
insert into storage.objects (bucket_id, name) values
  ('avatars', 'a7a00000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp'),
  ('avatars', 'a7a00000-0000-4000-8000-000000000003/33333333-3333-4333-8333-333333333333.webp'),
  ('avatars', 'a7a00000-0000-4000-8000-000000000004/44444444-4444-4444-8444-444444444444.webp'),
  ('avatars', 'a7a00000-0000-4000-8000-000000000005/55555555-5555-4555-8555-555555555555.webp');
```

Assertions (one `ok`/`is`/`throws_ok` each):
1. The `avatars` bucket exists and `public` is false.
2. `guard_profile_avatar_path` is security **invoker** and pins `search_path=""`.
3. `visible_avatar_owner_ids` is security definer, stable and pins `search_path=""`.
4. There's no insert, update or delete policy on `storage.objects` that mentions `avatars`, so no signed-in user can write to the bucket at all, their own folder included. Only the server writes, and only for the caller.
   (check `pg_policies where schemaname = 'storage' and cmd <> 'SELECT' and qual/with_check like '%avatars%'`).
5. As 02 (a parent in A): sees the objects of 01 and 03 (2 rows), not 04 or 05.
6. As 03 (a kid in A): sees 01 and 03. Kids see everyone in their family; pictures aren't
   finance data.
7. As 04 (family B): sees only 04.
8. As 05 (no family): sees only 05.
9. As 02: `update public.profiles set avatar_path = '<02's id>/<uuid>.webp' where id = <02>` throws `42501`.
10. As 02: inserting a profile row with `avatar_path` set throws `42501`.
11. As the table owner (`reset role`): setting a well-formed path works.
12. As the owner: a path in **another user's** folder violates `profiles_avatar_path_format` (`23514`).
13. As the owner: an upper-case uuid, a `.png` key and a key without a folder each violate the check (`23514`).
14. As 02: `get_family()` has `avatarPath` for 01 (the one set in 11 or set up front) and `null` for 03 when unset.
15. As 02: `get_family()`'s other fields are unchanged. Compare the keys of one member entry with the list from 20261016001100 plus `avatarPath`.
16. As 02: updating `currency` on their own profile still works (the guard only fires on `avatar_path`).

**`src/lib/database.types.ts`:** add `avatar_path: string | null;` to `profiles.Row`, and
`avatar_path?: string | null;` to `Insert`. `Update` is derived from `Insert`. Keep keys in
alphabetical order (after `avatar_url`).

**Done when** `npm run test:db` passes with the new file, and the other SQL tests still pass.

---

### A2: Image pipeline and body-size reader

**Files:** `package.json` and `package-lock.json` (add `sharp`), `src/lib/avatars/image.ts`,
`src/lib/avatars/image.test.ts`, `src/lib/http/body.ts`, `src/lib/http/body.test.ts`,
`src/lib/http/route.ts` (two new statuses).

**Dependency.** `sharp@0.35.3` is already installed as Next's optional dependency. Make it a direct
one, pinned exactly like every other dependency:

```bash
npm install --save-exact sharp@0.35.3
```

Then check that `package-lock.json` lists `@img/sharp-linux-x64` (and `@img/sharp-libvips-linux-x64`)
as optional packages, because the Docker image runs `npm ci` on Debian bookworm. Also check that
`output: "standalone"` copies it: after `npm run build`, check that `.next/standalone/node_modules/sharp`
and `.next/standalone/node_modules/@img` exist. If they don't, add
`outputFileTracingIncludes: { "/api/account/avatar": ["./node_modules/@img/**/*"] }` to
`next.config.ts`.

**`src/lib/http/route.ts`:** widen `HttpError`'s status union, both in the field and in the
constructor:

```ts
readonly status: 400 | 404 | 413 | 415 | 422 | 429;
```

**`src/lib/http/body.ts`:**

```ts
import "server-only";

import { HttpError } from "@/lib/http/route";

/**
 * The request body as bytes, refusing more than `maxBytes` with a 413 `tooLarge`. It checks
 * `Content-Length` first, then counts while reading, because the header can be missing or wrong.
 * It stops reading as soon as the limit is passed, so an oversized body is never held in memory.
 */
export async function readBodyWithLimit(request: Request, maxBytes: number, tooLarge: string): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) throw new HttpError(413, tooLarge);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, tooLarge);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
```

Tests: an empty body, a body exactly at the limit, a body one byte over with a correct
`Content-Length` (413 before reading), and one over with **no** `Content-Length`. For the last one,
build the request from a `ReadableStream` that sends chunks; NextRequest needs `duplex: "half"` for
a stream body.

**`src/lib/avatars/image.ts`:**

```ts
import "server-only";

import sharp from "sharp";

import { DomainError } from "@/lib/errors";

/** Width and height of every stored avatar, in pixels. Shown at up to 64 px, so this covers 3× screens with room to spare. */
export const AVATAR_SIZE = 256;
/** The largest upload accepted, in bytes. Phone photos are 2–4 MB. */
export const AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Refuse images over this many pixels before decoding them, so a small file can't expand into gigabytes. */
export const AVATAR_MAX_INPUT_PIXELS = 40_000_000;

export type AvatarUploadType = "image/jpeg" | "image/png";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The image type the bytes start with, or `null` when they aren't a JPEG or a PNG. Never trusts names or headers. */
export function sniffImageType(bytes: Uint8Array): AvatarUploadType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return "image/png";
  }
  return null;
}

const UNREADABLE = "That image couldn't be read. Try another JPG or PNG.";

/**
 * Re-encodes an uploaded JPG or PNG as the stored avatar: turned upright from its EXIF orientation,
 * cropped to a centred square, `AVATAR_SIZE` px, WebP quality 80. sharp writes no metadata unless
 * asked, so EXIF (including GPS), ICC and XMP data are all dropped. Only the first frame of an
 * animated PNG is kept. Throws a 422 `DomainError` for anything it can't decode as a JPEG or PNG.
 */
export async function toAvatarWebp(input: Uint8Array): Promise<Buffer> {
  if (!sniffImageType(input)) throw new DomainError(UNREADABLE, 422);

  try {
    const image = sharp(input, { failOn: "error", limitInputPixels: AVATAR_MAX_INPUT_PIXELS, pages: 1 });
    const { format } = await image.metadata();
    if (format !== "jpeg" && format !== "png") throw new DomainError(UNREADABLE, 422);

    return await image
      .rotate() // no argument: apply the EXIF orientation, then forget it
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    // sharp's messages describe the file's internals; keep them out of responses.
    throw new DomainError(UNREADABLE, 422);
  }
}
```

**`src/lib/avatars/image.test.ts`:** make the fixtures with sharp itself, so nothing binary is
committed:

```ts
const photo = (format: "jpeg" | "png", width = 800, height = 600) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } })[format]().toBuffer();
```

Cases:
- `sniffImageType`: JPEG bytes → `image/jpeg`; PNG bytes → `image/png`; GIF (`GIF89a`), WebP (`RIFF…WEBP`), text and an empty array → `null`.
- A JPEG and a PNG each become a WebP (`(await sharp(out).metadata()).format === "webp"`) of exactly 256×256.
- A portrait image (600×800) and a tiny one (32×32) still come out 256×256.
- EXIF is dropped: make the input with `.jpeg().withExif({ IFD0: { Copyright: "secret" } })`, and expect the output's `metadata().exif` to be `undefined`.
- Orientation is applied: make a 200×100 input with `.withMetadata({ orientation: 6 })`, run it through, and check the output's `metadata().orientation` is `undefined`.
- Bytes that start like a JPEG but are truncated give a 422 `DomainError` with the generic message.
- A PNG whose header declares more than 40 megapixels gives a 422. Make one cheaply with `sharp({ create: { width: 8000, height: 6000, channels: 1, background: 0 } }).png({ compressionLevel: 9 })`, which is 48 MP but a small file.

**Done when** both test files pass, `npm run check` passes, and the standalone build contains sharp.

---

### A3: `AvatarRepository`

**Files:** `src/lib/avatars/paths.ts`, `src/lib/avatars/paths.test.ts`,
`src/lib/avatars/repository.ts`, `src/lib/supabase/admin-client.ts` (new, moved out of
`auth-admin.ts`), `src/lib/supabase/auth-admin.ts`, `src/lib/supabase/repositories/avatars.ts`,
`src/lib/supabase/repositories/avatars.test.ts`, `src/lib/repositories.ts`,
`src/test/fakes/avatars.ts`, `src/test/fakes/repositories.ts`.

**`src/lib/avatars/paths.ts`** has no `server-only`, because the UI and the family mapping both use
it:

```ts
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const AVATAR_PATH = new RegExp(`^(${UUID})/(${UUID})\\.webp$`);

/** API prefix that serves avatars; see `src/app/api/avatars/[userId]/[file]/route.ts`. */
export const AVATARS_API_PREFIX = "/api/avatars";

/** A fresh storage key for `userId`'s next avatar. A new uuid each time, so cached URLs never go stale. */
export function newAvatarPath(userId: string): string {
  return `${userId.toLowerCase()}/${crypto.randomUUID()}.webp`;
}

/** The storage key that `/api/avatars/<userId>/<fileId>` names. Both ids must already be validated. */
export function avatarPathFromUrlParts(userId: string, fileId: string): string {
  return `${userId.toLowerCase()}/${fileId.toLowerCase()}.webp`;
}

/** The URL the app shows for a storage key, or `null` for no key or a malformed one. */
export function avatarUrl(path: string | null | undefined): string | null {
  const match = path?.match(AVATAR_PATH);
  return match ? `${AVATARS_API_PREFIX}/${match[1]}/${match[2]}` : null;
}
```

Tests: round trip (`avatarUrl(newAvatarPath(id))` matches `/api/avatars/<id>/<uuid>`), upper-case
input is lowercased, and `null`, `""`, `"x/y.webp"`, a `.png` key and a key with an extra folder all
give `null`.

**`src/lib/avatars/repository.ts`:**

```ts
/**
 * Profile pictures. Get it from `getRepositories()`; never import an implementation.
 *
 * Only a picture's owner can change it. `replace` and `remove` take **no user id**: they act on the
 * signed-in caller, whom the implementation looks up itself, so no caller can aim them at someone
 * else. Keep it that way: don't add a write method that takes a user id.
 *
 * SECURITY: the writes use the server's secret key, because signed-in users have no write access to
 * the bucket or to `profiles.avatar_path` (so nobody can skip the server's image checks). The
 * caller lookup is what keeps those writes on the caller's own picture. `getPath` and `read` act as
 * the caller through their own session.
 */
export interface AvatarRepository {
  /** The caller's own avatar key, or `null` when they have none (or no profile row). */
  getPath(userId: string): Promise<string | null>;
  /**
   * The WebP bytes at `path`, or `null` when the object doesn't exist **or the caller may not see
   * it** (not themselves and not in their family). The two are indistinguishable on purpose.
   */
  read(path: string): Promise<ArrayBuffer | null>;
  /**
   * Stores `webp` (already re-encoded by `toAvatarWebp`) as the **caller's** picture under a new key,
   * points their profile at it, deletes their previous picture, and returns the new key. If the
   * profile can't be updated, the new object is deleted again. A failed delete of the old object is
   * logged, not thrown. Throws when nobody is signed in.
   */
  replace(webp: Uint8Array): Promise<string>;
  /** Clears the **caller's** picture and deletes its object. Does nothing when there is none. */
  remove(): Promise<void>;
}
```

**`src/lib/supabase/admin-client.ts`:** move `createAdminClient()` here from `auth-admin.ts`
unchanged, keep its SECURITY comment, export it, and import it in `auth-admin.ts`. Update the
comment's "created only here" to name both users (`auth-admin.ts` and `repositories/avatars.ts`).

**`src/lib/supabase/repositories/avatars.ts`:**

```ts
import "server-only";

import { getAuthenticatedUser } from "@/lib/auth";
import type { AvatarRepository } from "@/lib/avatars/repository";
import { newAvatarPath } from "@/lib/avatars/paths";
import { createAdminClient } from "@/lib/supabase/admin-client";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "avatars";
const LOAD_ERROR = "Unable to load your profile picture.";
const SAVE_ERROR = "Unable to save your picture. Please try again.";
const REMOVE_ERROR = "Unable to remove your picture. Please try again.";

type AdminClient = ReturnType<typeof createAdminClient>;

async function currentPath(admin: AdminClient, userId: string, failure: string): Promise<string | null> {
  const { data, error } = await admin.from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
  if (error) throw new Error(failure);
  return data?.avatar_path ?? null;
}

/**
 * The signed-in caller's id, from their own session (cookie or bearer), never from an argument.
 * This is what limits the secret-key writes below to the caller's own picture.
 */
async function callerId(failure: string): Promise<string> {
  const user = await getAuthenticatedUser();
  if (!user) throw new Error(failure);
  return user.id;
}

/** Deletes an object, logging instead of throwing: a leftover file is harmless, a failed request isn't. */
async function removeObject(admin: AdminClient, path: string) {
  const { error } = await admin.storage.from(BUCKET).remove([path]);
  if (error) console.error(`Avatars: could not delete ${path}.`);
}

export const supabaseAvatarRepository: AvatarRepository = {
  async getPath(userId) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
    if (error) throw new Error(LOAD_ERROR);
    return data?.avatar_path ?? null;
  },

  /** As the caller: the bucket's select policy hides other families' pictures, which Storage reports as an error. */
  async read(path) {
    const supabase = await createClient();
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) return null;
    return data.arrayBuffer();
  },

  async replace(webp) {
    const userId = await callerId(SAVE_ERROR);
    // SECURITY: secret key, only ever on the caller's own folder and profile row.
    const admin = createAdminClient();
    const previous = await currentPath(admin, userId, SAVE_ERROR);
    const path = newAvatarPath(userId);

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, webp, { contentType: "image/webp", upsert: false });
    if (uploadError) throw new Error(SAVE_ERROR);

    // Upsert: a user may not have a profile row yet.
    const { error: writeError } = await admin
      .from("profiles")
      .upsert({ id: userId, avatar_path: path }, { onConflict: "id" });
    if (writeError) {
      await removeObject(admin, path);
      throw new Error(SAVE_ERROR);
    }

    if (previous && previous !== path) await removeObject(admin, previous);
    return path;
  },

  async remove() {
    const userId = await callerId(REMOVE_ERROR);
    const admin = createAdminClient();
    const previous = await currentPath(admin, userId, REMOVE_ERROR);
    if (!previous) return;

    const { error } = await admin.from("profiles").update({ avatar_path: null }).eq("id", userId);
    if (error) throw new Error(REMOVE_ERROR);
    await removeObject(admin, previous);
  },
};
```

The order matters. Upload first, then point the profile at the new key, then delete the old object.
A failure at any step leaves the profile pointing at a file that exists. The worst case is an
orphaned object, never a broken picture.

**Tests (`avatars.test.ts`)** follow `src/lib/supabase/repositories/family.test.ts`, which mocks the
client with `src/test/fake-supabase.ts`. Mock `@/lib/supabase/admin-client` and
`@/lib/supabase/server` separately, so each test proves which client each method uses. Mock
`@/lib/auth`'s `getAuthenticatedUser` to choose the caller:
- `getPath` and `read` use the **request** client and never create the admin client.
- `replace` and `remove` act on the signed-in caller only. Every Storage key and every `profiles` filter they send is under that caller's id.
- With nobody signed in, `replace` and `remove` throw before creating the admin client.
- `replace` uploads to `avatars` with `contentType: "image/webp"` and `upsert: false` at a key under `<userId>/`. It upserts `profiles` with that key, deletes the previous key and returns the new one.
- `replace` with no previous picture deletes nothing.
- `replace` when the upload fails throws `SAVE_ERROR` and never writes the profile.
- `replace` when the profile write fails deletes the **new** object and throws.
- `replace` when deleting the old object fails still returns the new key.
- `remove` with no picture does nothing. With one, it nulls the column and then deletes the object.
- `read` returns `null` on a Storage error.

`fake-supabase.ts` has no `storage` stub yet, so add `storage.from(bucket)` with `upload`,
`download` and `remove` that record their calls and return configurable results. Keep the same style
as its `from(table)` builder, and add a case to `fake-supabase.test.ts`.

**Wiring.** Add `avatars: AvatarRepository` to `Repositories` in `src/lib/repositories.ts`
(`supabaseAvatarRepository`), and `avatars: FakeAvatarRepository` to `FakeRepositories`.

**`src/test/fakes/avatars.ts`:**

```ts
import type { AvatarRepository } from "@/lib/avatars/repository";
import { newAvatarPath } from "@/lib/avatars/paths";

/**
 * In-memory `AvatarRepository`. `paths` maps user id → key, `files` maps key → bytes. `hidden` holds
 * keys the caller may not see (another family's): `read` answers `null` for them, like the bucket
 * policy. `replace` and `remove` act on `caller`, the signed-in user (`testUser` from `@/test/route`
 * by default; set it to match `signedInAs`), and record that id, like the real one.
 */
export class FakeAvatarRepository implements AvatarRepository {
  readonly paths = new Map<string, string>();
  readonly files = new Map<string, Uint8Array>();
  readonly hidden = new Set<string>();
  readonly replaced: string[] = [];
  readonly removed: string[] = [];
  caller = { userId: "10000000-0000-4000-8000-000000000001" };

  async getPath(userId: string) {
    return this.paths.get(userId) ?? null;
  }

  async read(path: string) {
    if (this.hidden.has(path)) return null;
    const bytes = this.files.get(path);
    return bytes ? (bytes.slice().buffer as ArrayBuffer) : null;
  }

  async replace(webp: Uint8Array) {
    const { userId } = this.caller;
    this.replaced.push(userId);
    const previous = this.paths.get(userId);
    const path = newAvatarPath(userId);
    this.files.set(path, webp);
    this.paths.set(userId, path);
    if (previous) this.files.delete(previous);
    return path;
  }

  async remove() {
    const { userId } = this.caller;
    this.removed.push(userId);
    const previous = this.paths.get(userId);
    this.paths.delete(userId);
    if (previous) this.files.delete(previous);
  }
}
```

**Done when** the repository, paths and fake-supabase tests pass and `npm run check` passes.

---

### A4: API routes and `avatarUrl` in responses

**Files:** `src/app/api/account/avatar/route.ts` and `route.test.ts`,
`src/app/api/avatars/[userId]/[file]/route.ts` and `route.test.ts`,
`src/app/api/protected-routes.test.ts`, `src/lib/http/rate-limit.ts`,
`src/lib/account/types.ts`, `src/app/api/account/route.ts` and `route.test.ts`,
`src/lib/family/repository.ts`, `src/lib/supabase/repositories/family.ts` and its test,
`src/test/builders.ts`, `src/app/dev/preview/fixtures.ts`, `src/lib/api/keys.ts`.

**Rate limit (`src/lib/http/rate-limit.ts`).** The existing in-memory limiter is under review in
[#93](https://github.com/GeorgeDanicico/expense-tracker/issues/93). If that lands first, use its
replacement instead; otherwise add this, and #93's follow-up moves it. The limiter only counts what
it's told to, so the route records **every** upload attempt, successful or not:

```ts
/** Avatar uploads allowed per user in `AVATAR_UPLOAD_WINDOW_MS`, counting every attempt. */
export const AVATAR_UPLOAD_MAX_ATTEMPTS = 20;
export const AVATAR_UPLOAD_WINDOW_MS = 60 * 60 * 1000;

/**
 * Avatar uploads per user id for `PUT /api/account/avatar`. Unlike the invite limiter it records
 * every attempt (through `recordFailure`), because each one costs an image decode.
 */
export const avatarUploadAttempts = createFailureLimiter({
  maxFailures: AVATAR_UPLOAD_MAX_ATTEMPTS,
  windowMs: AVATAR_UPLOAD_WINDOW_MS,
});
```

**`src/app/api/account/avatar/route.ts`:**

```ts
import { AVATAR_MAX_UPLOAD_BYTES, sniffImageType, toAvatarWebp } from "@/lib/avatars/image";
import { avatarUrl } from "@/lib/avatars/paths";
import { readBodyWithLimit } from "@/lib/http/body";
import { avatarUploadAttempts } from "@/lib/http/rate-limit";
import { HttpError, json, noContent, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png"]);
const WRONG_TYPE = "Choose a JPG or PNG image.";
const TOO_LARGE = "Choose an image under 5 MB.";
const TOO_MANY = "You've changed your picture a lot recently. Try again in an hour.";

/**
 * Sets the caller's picture. The body is the raw image (not multipart), with `Content-Type`
 * `image/jpeg` or `image/png`. Answers `{ avatarUrl }`.
 * 415 for another type (by header or by content), 413 over 5 MB, 422 for an image that can't be
 * decoded or is over 40 megapixels, 429 past 20 attempts an hour.
 */
export const PUT = withUser(async (request, user) => {
  if (avatarUploadAttempts.isLimited(user.id)) throw new HttpError(429, TOO_MANY);
  avatarUploadAttempts.recordFailure(user.id);

  // Refuse before reading the body when the header already says it's something else.
  const declaredType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!declaredType || !ACCEPTED_TYPES.has(declaredType)) throw new HttpError(415, WRONG_TYPE);

  const bytes = await readBodyWithLimit(request, AVATAR_MAX_UPLOAD_BYTES, TOO_LARGE);
  // The content decides, not the header: a PNG sent as image/jpeg is still a PNG, and is fine.
  if (!sniffImageType(bytes)) throw new HttpError(415, WRONG_TYPE);

  const webp = await toAvatarWebp(bytes);
  // Always the caller's own picture: the repository finds the caller itself.
  const path = await getRepositories().avatars.replace(webp);
  return json({ avatarUrl: avatarUrl(path) });
}, { failure: "Unable to save your picture. Please try again." });

/** Removes the caller's picture. 204, also when there was none. */
export const DELETE = withUser(async () => {
  await getRepositories().avatars.remove();
  return noContent();
}, { failure: "Unable to remove your picture. Please try again." });
```

There's no shared origin check on mutating routes (only MCP checks origins). Two things still block
cross-site requests here. A `PUT` with an `image/*` body isn't a "simple" request, so another site's
`fetch` needs a CORS preflight, which we never grant. And Supabase's session cookies are
`SameSite=Lax`, so cross-site requests don't carry them. Nothing new is needed, but keep the body raw:
switching to `multipart/form-data` would make it a simple request that a plain HTML form could send.

**`src/app/api/avatars/[userId]/[file]/route.ts`:**

```ts
import { avatarPathFromUrlParts } from "@/lib/avatars/paths";
import { notFound, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

const NOT_FOUND = "That picture wasn't found.";

/**
 * A profile picture, for the caller and their family only (the bucket's read policy decides; anyone
 * else gets the same 404 as a missing file). Each URL names one upload and never changes, so the
 * browser may keep it for a year. `private`: shared caches must not store it.
 */
export const GET = withUser(async (_request, _user, context: { params: Promise<{ userId: string; file: string }> }) => {
  const { userId, file } = await context.params;
  const path = avatarPathFromUrlParts(parseId(userId, NOT_FOUND), parseId(file, NOT_FOUND));

  const bytes = await getRepositories().avatars.read(path);
  if (!bytes) notFound(NOT_FOUND);

  return new Response(bytes, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}, { failure: "Unable to load the picture." });
```

`parseId` answers 400 for a malformed id. That's fine, because only a hand-typed URL can trigger it.

**`protected-routes.test.ts`:** add `"account/avatar": ["DELETE", "PUT"]` and
`"avatars/[userId]/[file]": ["GET"]`. The anonymous check returns 401 before it reads params, so the
`{ id }` it passes doesn't matter.

**Account response.** In `src/lib/account/types.ts`, add to `AccountData`:

```ts
/** The caller's picture as an `/api/avatars/…` URL, or `null` without one. Not behind the family flag. */
avatarUrl: string | null;
```

In `src/app/api/account/route.ts`, read it in the same `Promise.all`:

```ts
const [currency, membership, mustChangePassword, avatarPath] = await Promise.all([
  knownCurrency ?? account.getCurrency(user.id),
  accountMembership(),
  account.getMustChangePassword(user.id),
  getRepositories().avatars.getPath(user.id),
]);
return {
  email: user.email, currency, features: { family: isFamilyEnabled() }, membership, mustChangePassword,
  avatarUrl: avatarUrl(avatarPath),
};
```

Update the exact-body `toEqual` in `src/app/api/account/route.test.ts` (the "default currency" case)
to include `avatarUrl: null`, and add a case where `repositories.avatars.paths` has a key and the body
has the matching URL.

**Family members.** In `src/lib/family/repository.ts`, add to `FamilyMember`:

```ts
/** The member's picture as an `/api/avatars/…` URL, or `null` without one. Visible to the whole family. */
avatarUrl: string | null;
```

In `src/lib/supabase/repositories/family.ts`, add `avatarPath?: string | null;` to `FamilyMemberJson`,
and add `avatarUrl: avatarUrl(member.avatarPath),` in `toMember` after `color`. `avatarUrl()` returns
`null` for anything malformed, so a bad row can't produce a strange URL. Add `avatarUrl: null` to
`aFamily()` and `aFamilyMember()` in `src/test/builders.ts`, and to the `FamilyResponse` and
`AccountData` fixtures in `src/app/dev/preview/fixtures.ts`. Give one fixture member a URL, so the
preview shows both an image and initials. TypeScript lists every other literal that needs the field.

In `src/lib/api/keys.ts`, document the new URLs next to the account ones:

```ts
/** PUT raw JPG/PNG bytes (`Content-Type: image/jpeg|image/png`) → `{ avatarUrl }`; DELETE → 204. Refresh `ACCOUNT_API_KEY` and `FAMILY_API_KEY` afterwards. */
export const ACCOUNT_AVATAR_API_URL = "/api/account/avatar";
```

**Route tests (`account/avatar/route.test.ts`)** use the fakes. Build the bodies with sharp, as in
A2, and call the route with a raw body. `callRoute` only sends JSON, so build a `NextRequest`
directly, with the body and the `content-type` header. Call `resetRateLimits()` in `beforeEach`.
Cases:
- A JPEG with `image/jpeg` gives 200 and `{ avatarUrl: "/api/avatars/<testUser.id>/<uuid>" }`. `repositories.avatars.replaced` is `[testUser.id]`, and the stored bytes are WebP.
- A PNG with `image/png` gives 200.
- A PNG sent as `image/jpeg` gives 200, because content decides.
- `image/gif` gives 415, and `replace` isn't called.
- A missing `Content-Type` gives 415.
- GIF bytes sent as `image/png` give 415.
- `Content-Length` over 5 MB gives 413 without reading the body.
- Truncated JPEG bytes give 422.
- The 21st attempt within the hour gives 429. Use `vi.useFakeTimers()`. After advancing an hour, uploads are allowed again.
- `DELETE` gives 204, and `removed` is `[testUser.id]`.
- Uploading changes only the caller's own picture. Seed pictures for two users, sign in as one (setting `repositories.avatars.caller` to match), upload, and check that the other user's key and bytes are untouched.
- The route accepts no target: `?userId=<other id>` in the URL, or a `userId` header, changes nothing about whose picture is replaced.

**`avatars/[userId]/[file]/route.test.ts`:**
- A stored key gives 200 with `image/webp`, the bytes, and `Cache-Control: private, max-age=31536000, immutable`.
- A key in `hidden` gives 404 with the same body as a missing key.
- A missing key gives 404.
- Malformed ids give 400.
- Upper-case ids in the URL still find the lowercase key.

**Done when** all the tests above pass, `npm test` and `npm run check` pass, and a local run works
against the real project after the checkpoint:
- upload a JPG and a PNG;
- check in Supabase Studio that `avatars/<id>/` holds exactly one `.webp` after replacing;
- open the avatar URL signed in as a family member (200) and as an account outside the family (404);
- remove the picture.

---

### A5: `<Avatar>` primitive

**Files:** `src/components/ui/avatar.tsx`, `src/components/ui/index.ts`,
`src/app/dev/ui/ui-gallery.tsx`.

Chakra 3's `Avatar` already does the image-with-fallback logic. `Avatar.Fallback` computes initials
from `name` and only shows when the image is missing or fails to load. The wrapper fixes our sizes
and colours:

```tsx
"use client";

import { Avatar as ChakraAvatar } from "@chakra-ui/react";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

const BOX: Record<AvatarSize, string> = { xs: "6", sm: "8", md: "10", lg: "16" };

/**
 * A person's picture, or their initials on their member colour when they have none (or it fails to
 * load). `name` is required even with a picture: it's the image's alt text and the fallback.
 * `color` is a colour token (`member.3`, from `useMemberColors()`); without one the fallback is neutral.
 */
export function Avatar({
  name,
  src,
  color,
  size = "sm",
}: {
  name: string;
  src?: string | null;
  color?: string;
  size?: AvatarSize;
}) {
  return (
    <ChakraAvatar.Root
      boxSize={BOX[size]}
      flexShrink="0"
      borderRadius="full"
      bg={color ?? "bg.muted"}
      color={color ? "white" : "fg.muted"}
      textStyle="label"
    >
      <ChakraAvatar.Fallback name={name} />
      {src ? <ChakraAvatar.Image src={src} alt={name} /> : null}
    </ChakraAvatar.Root>
  );
}
```

Before merging, check that white text on each of the 8 member colours meets 4.5:1 contrast in both
themes (`src/components/ui/theme/member-tokens.ts`). Where one doesn't, use a darker `fg` token for
it in the token file rather than special-casing it here. Export the component from
`src/components/ui/index.ts`. In the gallery, add a "Avatar" `GallerySection` with each size, for
three cases: an image (use `/apple-icon.png` as the `src`), initials on `member.1`–`member.8`, and
initials with no colour.

**Done when** the gallery shows all of it at 390 and 1280 px, in light and dark. Include
screenshots in the PR.

---

### A6: Settings card and where avatars show

**Files:** `src/components/settings/avatar-card.tsx` (new), `src/app/(app)/settings/page.tsx`,
`src/lib/api/invalidate.ts`, `src/components/layout/app-shell.tsx`, `sidebar-nav.tsx`,
`mobile-tab-bar.tsx`, `more-sheet.tsx`, `src/app/(app)/layout.tsx`,
`src/components/family/family-members.tsx`, `src/components/family/member-swatch.tsx`, and their
tests.

**`invalidate.ts`:** add a helper next to the others:

```ts
/** After the caller's picture changes: their account (sidebar, settings) and the family list. */
export function invalidateAfterAvatarChange(mutate: ScopedMutator) {
  return Promise.all([mutate(ACCOUNT_API_KEY), mutate(FAMILY_API_KEY)]);
}
```

**`avatar-card.tsx`:** a `Card` titled "Profile picture", placed first on the settings page:

- **Header:** "Profile picture", with the description "Shown to your family. JPG or PNG, up to 5 MB."
- **Body:** the current `<Avatar size="lg" name={displayName} src={account.avatarUrl} />` beside two buttons.
  - "Upload picture" (or "Change picture" when one exists) clicks a hidden `<input type="file" accept="image/jpeg,image/png">`.
  - "Remove" shows only when there is a picture, and asks through `ConfirmDialog` first.
- **Checks in the browser before sending**, to save a round trip; the server checks everything again:
  - `file.type` must be `image/jpeg` or `image/png`, else "Choose a JPG or PNG image.";
  - `file.size` must be at most 5 MB, else "Choose an image under 5 MB.".
- **Sending** reuses `apiRequest`. It sets `Content-Type: application/json` first, then lets `init.headers` override it, so the file's own type wins:

```ts
const { avatarUrl } = await apiRequest<{ avatarUrl: string }>(ACCOUNT_AVATAR_API_URL, {
  method: "PUT",
  body: file,
  headers: { "Content-Type": file.type },
});
```

- **While uploading:** the button shows `loading`, and the input is cleared afterwards (`event.target.value = ""`) so picking the same file again still fires `change`.
- **Errors** (413, 415, 422, 429) show in an `InlineAlert` with the server's message. Success shows nothing extra: the new picture is the confirmation.
- **After success or removal:** call `invalidateAfterAvatarChange(mutate)` with `mutate` from `useSWRConfig()`.
- **The name for the fallback** is the account email's part before the `@`. `AccountData` has no display name yet; when display-name editing lands, switch to it.

Use `useApiForm` for the pending and error state, as the email card on the same page does.

**Sidebar and more sheet.** `ProtectedLayout` passes `avatarUrl={data.avatarUrl}` to `AppShell`,
alongside `email`. `AppShell` passes it on to `SidebarNav` and `MobileTabBar`, which passes it to
`MoreSheet`. In `sidebar-nav.tsx`, replace `AccountRow`'s hand-made initial circle with
`<Avatar size="xs" name={email} src={avatarUrl} />`. Use the same `xs` avatar beside the email in
`more-sheet.tsx`.

**Family list.** In `family-members.tsx`, replace `MemberSwatch` in `MemberRow` with
`<Avatar size="sm" name={name} src={member.avatarUrl} color={color} />`. The member's colour now
fills the fallback circle, so the swatch would be redundant. Keep `MemberSwatch` and `MemberName`
everywhere else (charts, viewing chips): those are colour keys, not identity.

**Tests:**
- `family-members.test.tsx`: a member with `avatarUrl` renders an `img` with that `src` and `alt`; one without renders initials.
- A new `avatar-card.test.tsx` covers:
  - a GIF chosen is refused in the browser, and `fetch` isn't called;
  - a 6 MB file is refused in the browser;
  - a JPEG is sent with `method: "PUT"`, the `File` as the body and `Content-Type: image/jpeg`;
  - a 415 from the server shows its message;
  - "Remove" asks first, then sends `DELETE`.

**Done when** the tests pass. Include screenshots at 390 and 1280 px of:
- the settings card with and without a picture;
- the sidebar;
- the family list, with one member who has a picture and one who doesn't.

---

## Checklist for George

1. **After A1 merges:** apply the migration to the live project (`sffivcwushcctcwevnnz`). In Studio, check that the `avatars` bucket exists, is private, and has the 256 KB / `image/webp` limits.
2. **Before A4 is deployed:** `SUPABASE_SECRET_KEY` must be set in `/etc/expense-tracker/.env.production`. Without it, uploads answer 500 and reads keep working. F48 already needs the key, so this may already be done.
3. **If nginx is in front of the app:** check that `client_max_body_size` is at least `6m`. Its default is 1 MB, which would refuse most phone photos before they reach the app.

## Not in this plan

- **Cropping in the browser.** The server crops the centre of the picture. A crop dialog could send the chosen square, and the server would still re-encode it.
- **Clearing pictures when an account is deleted.** No user-facing flow deletes accounts today, apart from cleaning up after a failed kid creation, when there's no picture yet. When one is added, `AuthAdmin.deleteUser` should delete `avatars/<id>/` first.
- **Using the Google profile photo as a default.** `profiles.avatar_url` may hold it for Google sign-ins. It could be shown as a fallback, but it would load from Google's servers, which goes against serving everything ourselves.
- **Display-name editing** (the rest of roadmap step 2.1).
