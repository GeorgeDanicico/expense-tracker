# Incident checklist

Short steps for the four bad days: a key leaks, the database needs a restore, a deploy is bad, an
account is compromised. Read the one you need, top to bottom. Don't paste secrets into chat, issues
or pull requests: say which one it was, not what it was.

How production runs, so the steps make sense:

- A green CI run on `main` pushes the image to `ghcr.io/georgedanicico/expense-tracker`, tagged with
  the full commit SHA and `latest`. `notify-vps.yml` then wakes the **Sync applications and deploy
  production** workflow in the `GeorgeDanicico/vps-apps` repo.
- That workflow runs this repo's `scripts/deploy.sh` on the VPS (through `deploy/adapters/expense-tracker.sh`
  in vps-apps). The script pulls the image, starts the web container `expense-tracker-web`
  (port 3000, on `127.0.0.1`) and the worker container `expense-tracker-worker`.
- Both containers read one file, `/etc/expense-tracker/.env.production`, **only when they are
  created**. Editing the file does nothing until the containers are replaced (`docker restart` is
  not enough: it keeps the old values).
- Host settings for the deploy live in `/etc/vps-apps/expense-tracker.sh` on the VPS.

**To make the containers pick up a changed env file**, run on the VPS, from a clone of vps-apps:

```bash
python3 scripts/deploy.py --app expense-tracker --force
```

or use **Actions → Sync applications and deploy production → Run workflow** in the vps-apps repo
with the force option. Then check `docker logs expense-tracker-web` and `docker logs expense-tracker-worker`.
Logs are JSON lines kept for 5 days in the host's journal; [logging.md](logging.md) has the events and
query recipes (for example, everything that happened for one request id).

## 1. A key leaked

First: stop the damage (rotate), then look at what it could have done, then clean up. Rotating
first is right even if you aren't sure it leaked.

| Key | Where it lives | Where to rotate it | What to restart after |
| --- | --- | --- | --- |
| `SUPABASE_SECRET_KEY` (`sb_secret_…`) | VPS env file only. It skips every database rule, so this is the worst one to lose. | Supabase dashboard → Project Settings → API Keys: create a new secret key, then delete the old one. | Put the new value in the env file, then force a deploy (above). Both containers use it. |
| `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) | VPS env file. It is public by design (the database rules protect the data), so a leak is low risk. | Same page, same steps, if you want a new one. | Env file, then force a deploy. |
| Supabase legacy `anon`/`service_role` keys and the JWT secret | Supabase only. The app doesn't use them. | Project Settings → API Keys (legacy tab) and → JWT Keys. Turn the legacy keys off if they are still on; rotating the JWT secret signs everyone out. | Nothing in the app. |
| Database password | Supabase only. The app talks to Supabase over its API and does not use it. You would use it for `pg_dump` or a restore. | Project Settings → Database → reset password. | Anything you made that uses it (a backup job). |
| `OPENAI_API_KEY` | VPS env file (web container only). | platform.openai.com → API keys: create a new one, delete the old one. If the key was used, look at the usage page. | Env file, then force a deploy. |
| `VAPID_PRIVATE_KEY` (and `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`) | VPS env file; the private key is read only by the worker. | `npx web-push generate-vapid-keys`, replace **both** keys. The old private key lets someone send push messages to subscribed devices. | Env file, then force a deploy. Every device has to press **Enable on this device** again in Settings → Notifications. |
| Google sign-in client secret | Supabase dashboard → Authentication → Providers → Google (not in our env file). | Google Cloud console → Credentials: make a new secret, paste it into Supabase, delete the old one. | Nothing on the VPS. |
| MCP personal tokens (`sl_mcp_…`) and OAuth grants | The database (`mcp_tokens`, only a hash) and Supabase Auth. No env key. | Settings → AI assistants: **Revoke** tokens, **Disconnect** apps (see "An account is compromised"). | Nothing. They stop at the next call. |
| `VPS_DISPATCH_TOKEN` | A repository secret in this repo (Settings → Secrets and variables → Actions). It is a GitHub token that may start workflows in `vps-apps`. | GitHub → Settings → Developer settings → tokens: delete the old token, make a new one limited to the `vps-apps` repo, update the secret. | Nothing. The next push to `main` uses it. Until then deploys fall back to vps-apps' scheduled sync. |
| GHCR pull login on the VPS (`docker login ghcr.io`) | The VPS's Docker config, only if the package is private. | GitHub → Developer settings: new token with `read:packages` only, run `docker login ghcr.io` again, delete the old one. | Nothing. |
| `GITHUB_TOKEN` in CI | Made fresh for each run by GitHub. | Nothing to rotate. | None. |
| The self-hosted runner's registration | The VPS runner (only for the manual `deploy.yml` fallback). | Repo Settings → Actions → Runners: remove and register again. | The runner service. |

Then:

1. **Check what it was used for.** Supabase dashboard → Logs (API and Auth logs) for the hours
   around the leak; the OpenAI usage page; for the secret key, any rows you don't recognise
   (new users in Authentication, recent changes in `expenses`).
2. **If a key was committed to Git**, rotating is the fix; we don't rewrite history. The
   `secrets` job in CI (gitleaks) scans every push, so check it is green to confirm nothing else
   leaked.
3. **If a secret was ever on a page the browser can download**, the image build fails
   (`scripts/scan-build-secrets.sh`). Don't ignore that failure.
4. Write down what leaked, when you rotated it and what you checked.

## 2. The database needs a restore

Read `docs/backups.md` first: it says what the plan backs up and has the rehearsal. A restore
replaces the live database and takes the app offline until it ends, so don't do it for a small
mistake you can fix with a query.

1. **Decide the point to go back to.** The last good moment, before the bad change. Note the time
   (with the time zone).
2. **Stop the writers** so nothing is written while you restore: on the VPS,
   `docker stop expense-tracker-web expense-tracker-worker`. (Deploys will restart them; hold off
   merging to `main` until you are done.)
3. **Restore.** Supabase dashboard → Database → Backups. Pick the newest daily backup before the
   bad time, or with PITR pick the exact time. Confirm. The project is unreachable until it ends.
4. **Afterwards:** reset any custom role passwords (a daily backup doesn't keep them).
   Storage files (profile pictures) are not part of the backup: a picture deleted since the backup
   will be missing, and its owner can upload a new one.
5. **Start the containers again**: `docker start expense-tracker-web expense-tracker-worker`, or
   force a deploy. Open the app, sign in, check recent expenses and the notifications worker's
   heartbeat in the logs (`tick` lines, see [logging.md](logging.md)).
6. **Tell people** what the restore lost: everything after the backup's time.
7. If the restore went wrong, don't try it again on the live project from memory. Restore the same
   backup into a separate project first (see `docs/backups.md`, "Option 2") and compare.

If there is no usable backup, the nightly `pg_dump` fallback in `docs/backups.md` is the way out.
Set it up before you need it.

## 3. A deploy is bad

The app is broken or misbehaving after a merge to `main`. Sort it out in this order.

**Fast: put the previous image back.** Every green commit on `main` has an image
`ghcr.io/georgedanicico/expense-tracker:<full commit SHA>`. Find the SHA of the last good commit
(`git log main`, or the package's versions page on GitHub), then on the VPS, in the expense-tracker
checkout that vps-apps keeps (`$VPS_APPS_ROOT/expense-tracker`):

```bash
DEPLOY_ENV_FILE=/etc/expense-tracker/.env.production \
IMAGE_SOURCE=pull \
IMAGE_NAME=ghcr.io/georgedanicico/expense-tracker \
IMAGE_TAG=<good full commit SHA> \
GIT_SHA=<good full commit SHA> \
CONTAINER_NAME=expense-tracker-web \
WORKER_CONTAINER_NAME=expense-tracker-worker \
BIND_ADDRESS=127.0.0.1 \
bash scripts/deploy.sh
```

This is what the vps-apps adapter runs, with an older tag. The script checks the web container is
healthy before it removes the old one and puts the old one back if the new one fails. It starts the
worker only after the web container is healthy.

**Then make it stick.** vps-apps always follows the newest `main`, so the next merge would deploy
over your rollback. Open a pull request that reverts the bad commit (`git revert <sha>`), and merge
it: CI builds the image and the normal pipeline deploys it. Until it is merged, don't merge anything
else.

**Not enough?**

- If only the new memory limit or the read-only root is the problem (look for `OOMKilled`:
  `docker inspect expense-tracker-web --format '{{.State.OOMKilled}}'`, or `Read-only file system`
  in `docker logs`), you don't need to revert the code. Set `WEB_MEMORY_LIMIT` or
  `WORKER_MEMORY_LIMIT` (for example `1g`) in `/etc/vps-apps/expense-tracker.sh` on the VPS and
  force a deploy. (`FATAL ERROR: ... JavaScript heap out of memory` in `docker logs` is the heap limit,
  not the container's: raise `WEB_HEAP_MB` or `WORKER_HEAP_MB` with it, see the README.) Don't remove the hardening flags to "see if it helps" without noting it here.
- A database migration can't be rolled back by going back an image. If the bad deploy included a
  migration, deal with the data first (section 2 if needed), and write a new migration that undoes
  it. Deploys don't apply migrations; they are applied separately.
- `latest` also moves on every push. Roll back by SHA, not by `latest`.

## 4. An account is compromised

Someone else may be using a user's account (or the user lost a device). Do these in order; the
account owner can do the first four themselves, or an admin can help.

1. **Sign out everywhere.** Settings → Account → **Sign out everywhere**. This ends every session,
   including the attacker's.
2. **Change the password**: Settings → Account → Password (it asks for the current password; if the
   attacker changed it, use the sign-in page's reset). Changing it also signs out other sessions.
   For a kid's account, a parent resets it from Manage family.
3. **Disconnect AI assistants.** Settings → AI assistants: **Revoke** every personal token and
   **Disconnect** every app you don't know. These work on their own, outside the browser session,
   so signing out does not stop them.
4. **Check the email address** on the account (Settings → Account), and the Google sign-in link if
   the account uses it. Change it back if it was changed.
5. **Look at what happened**, with the Supabase dashboard (Table editor or SQL editor, as the
   project owner):
   - `ai_usage`: unexpected AI calls and costs for that user (and `app_flags` to see whether the
     global AI kill switch tripped).
   - `mcp_tokens`: tokens created recently, and `last_used_at`.
   - `expenses`, `expense_tabs`, `investment_transactions`, `net_worth_items`, `todos`, `reminders`:
     rows created or changed since the first suspicious time (`created_at`/`updated_at`).
   - `family_members`, `family_invites` and `member_permissions`: new members, invites or changed
     permissions in the family.
   - `push_subscriptions`: devices you don't recognise (delete them).
   - Authentication → Users and Logs → Auth logs: the sign-in times and IP addresses.
6. **Fix the data.** Undo the changes you found by hand, or restore from a backup if it's a lot
   (see section 2, and think twice: a restore affects every user).
7. **If a kid's or a parent's account was the way in**, check the rest of the family's accounts too
   (same device, same password?) and tell them.
8. **If the attacker got in without the password** (no weak or reused password, no phishing), treat
   it as a possible key leak: go to section 1.
