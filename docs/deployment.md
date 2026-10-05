# Porter V0 deployment and acceptance handoff

## Production topology

Use the existing VPS pattern with a dedicated `/opt/porter` deployment and `porter`
service account. A dedicated DNS name terminates HTTPS at the existing reverse
proxy (Caddy example supplied). That origin serves the Vite PWA, `/auth/*`, and
`/client/*` through `porter-web.service`, bound only to `127.0.0.1:8790`.

The existing client dispatcher calls `PersistentPorterService`, the repository,
Supabase RLS, and the deterministic TripPacket builder. The browser never reads
source tables. Private artifact downloads pass through the same authenticated
service. Static shell/artwork are public, generic files; all travel data requires
an authenticated owner. This lets the worker open cached shell/local data without
a proxy login redirect or a network authentication prerequisite.

Optional `porter-mcp.service` binds `127.0.0.1:8791`; it is not routed by the public
proxy. Keep Assistant's 8787 and Coach's 8788 unchanged. A separately provisioned
OpenAI Secure MCP Tunnel may target Porter, but it must provide a real Supabase
user JWT to the existing authenticated MCP boundary. A tunnel API key is not a
Supabase JWT. No fabricated tunnel credentials, permanent JWTs, or auth bypass
are included. MCP/plugin activation is separate from getting the PWA running.

No Sites project is registered: a static-only deployment would leave `/client`
unserved; moving the existing Node runtime to a new worker architecture is
unnecessary. This repository does not depend on Assistant/Coach source.

## Configuration and first provisioning

Node 22+, npm, systemd, DNS and an HTTPS reverse proxy are required. Verify the
Node executable is `/usr/bin/node` before installing the units. The selected
shared Supabase project is `zjgklcigytxvjexiizdn` (Coach-AI). Porter owns only its
`travel_*` tables and private `porter-artifacts` bucket.

| Variable | Purpose |
| --- | --- |
| `PORTER_SUPABASE_URL` | Real Supabase HTTPS project URL |
| `PORTER_SUPABASE_KEY` | Publishable key, or legacy anon key; privileged keys are rejected |
| `PORTER_PUBLIC_ORIGIN` | Exact HTTPS origin, with no trailing slash/path |
| `PORTER_OWNER_ID` | Provisioned Supabase Auth user UUID allowed on this V0 deployment |
| `PORTER_ARTIFACT_BUCKET` | `porter-artifacts`, matching checked-in policies |
| `PORTER_WEB_PORT` | Defaults to 8790; keep 8790 for supplied proxy/health scripts |
| `PORTER_MCP_HOST`, `PORTER_MCP_PORT` | Optional private MCP listener; deployment uses 127.0.0.1:8791 |

No service-role key is needed. Requests retain the verified user's JWT and RLS.
Sign-in uses the Supabase password API; refresh uses its normal refresh-session
API. Access/refresh cookies are host-only, Secure, HttpOnly and SameSite=Strict.
POST requests with cookies require the exact configured Origin. Native bearer
clients without an Origin remain supported. Public errors/logs omit credentials.
The auth routes have a bounded process-wide attempt limit in addition to Supabase
limits. No registration, invitations or participant accounts are introduced.

There were no Auth users in the shared project during this audit. Create the
owner through **Supabase Dashboard → Authentication → Users**, or its supported
Admin Auth API, using a securely chosen password. Complete email verification as
required. Put the returned user UUID in `PORTER_OWNER_ID`. Do not insert users with
SQL, disable email confirmation globally, or send passwords/tokens in chat. The
UUID is unrelated to Trip participant IDs. This deployment is owner-only; changing
the owner requires a fresh browser profile/cleared site data to avoid sharing the
previous owner's local travel cache. Disconnecting sync intentionally retains
local data and clears browser cookies; it does not revoke all Supabase sessions.

On the VPS (after PR review and merge):

```bash
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin porter
sudo install -d -o root -g porter -m 750 /etc/porter
sudo install -d -o root -g porter -m 755 /opt/porter
sudo git clone https://github.com/BlueWhale0101/Porter.AI.git /opt/porter/source
sudo install -o root -g porter -m 640 /opt/porter/source/deploy/runtime.env.example /etc/porter/runtime.env
sudoedit /etc/porter/runtime.env
sudo install -m 644 /opt/porter/source/deploy/porter-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable porter-web.service
sudo /opt/porter/source/deploy/release.sh /opt/porter/source EXACT_MERGED_MAIN_SHA
```

If the service user or checkout already exists, reuse it. Never overwrite an
existing environment file on an update. Configure the selected DNS name to the
VPS, adapt/import `deploy/Caddyfile.example` in the existing reverse proxy, validate
its configuration and reload it. Do not replace the host's entire configuration
or change Assistant/Coach listeners. Only HTTPS should expose the web service;
8790 and 8791 remain loopback. Let the proxy manage certificates/renewal.

`systemctl status porter-web`, `journalctl -u porter-web -n 100`, and
`curl --fail http://127.0.0.1:8790/health` establish process health. `/health` reports
revision/build identity, not database readiness. `/client/trips` and the real
smoke procedure establish the authenticated data path. Logs contain request IDs,
route families, statuses, and revision—not tokens, bodies, ticket data, or emails.
Configuration is root:porter 0640; releases are root-owned/read-only to the service.
Systemd restarts failure and enables startup after reboot. Those live behaviors
must still be verified on the VPS; unit-file inspection is not a reboot test.

## Database migration status

Both repository migrations were applied to the real shared project on 2026-10-04:

- `202610030001_porter_v0.sql`: tables, revisions/checks/FKs, indexes, parent guard, RLS.
- `202610030002_porter_storage_and_hierarchy.sql`: private bucket, ownership policies,
  hierarchy cycle guard. Deployment exposed a text/UUID comparison error in the
  unapplied Storage policies; this PR corrects `auth.uid()` to `auth.uid()::text`.

The management connector assigns its own migration history timestamps. Match
migration names/content, not assumed source filename versions; do not reapply
these CREATE statements to this project. For a new project apply these files in
order using the Supabase migration tooling. The verification query below is read-only:

```sql
select c.relname,c.relrowsecurity,
  has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as grants
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('travel_trips','travel_events','travel_knowledge');
select id,public from storage.buckets where id='porter-artifacts';
select tablename,policyname,qual,with_check from pg_policies
where tablename like 'travel_%' or policyname like 'porter_%';
```

All three tables have RLS and authenticated grants; the bucket is private; policies,
revision constraints, FKs and indexes were inspected. No RLS or auth was weakened.
Artifact paths remain validated by `PersistentPorterService` as
`tripId/eventId/artifactId/original`, with the configured bucket. Runtime requests
use the owner's JWT for both database and Storage operations.

Security advisors reported mutable search paths on the two existing invoker
trigger functions. Record for hardening; no SECURITY DEFINER conversion or privilege
expansion was made. The shared project's unrelated advisor findings were left
untouched. Remediation reference:
https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

## Repeatable update and rollback

1. Review/merge the deployment PR; record the resulting **main** SHA.
2. Run `deploy/release.sh /opt/porter/source EXACT_MERGED_MAIN_SHA` as root.
3. The script fetches main, refuses any other SHA or dirty source, creates an
   immutable detached release, installs the lockfile, runs tests/build and checks
   the production bundle. Only then does it atomically switch `/opt/porter/current`.
4. It restarts the service and verifies the exact revision over loopback HTTP.
   Failed startup restores the previous release when one exists.
5. Fetch the public HTTPS `/health` and `/build.json`; both must report that SHA.
   Run the authenticated smoke and browser checks below. Store actual results in
   `docs/deployment-status.md` before claiming readiness.

The build embeds the Git SHA in the client and `dist/build.json`. The worker ID
hashes revision, HTML, shell paths, manifest, worker code and artwork. Shell/art
caches rotate together; the art cache remains bounded to 24. `sw.js`, HTML,
manifest, artwork and build metadata revalidate at the HTTP layer. Hashed Vite
assets are immutable. A waiting worker is announced by the safe update lifecycle described in
`docs/v0-acceptance.md`. Explicit Update waits for owned interactions to finish
before activation and reload. Close other Porter windows before updating.
A pre-update cached client may still need an initial close/reopen. Diagnostics
reports running and waiting build state. Installed shell icons are read from the shell
cache, independently of artwork cache eviction.

To roll back, identify the previous retained release SHA, verify its `build.json`,
then atomically point `/opt/porter/current` at that directory and restart
`porter-web.service` (and optional MCP if enabled). Check `/health` again. Example:

```bash
sudo ln -s /opt/porter/releases/PREVIOUS_SHA /opt/porter/current.rollback
sudo mv -Tf /opt/porter/current.rollback /opt/porter/current
sudo systemctl restart porter-web.service
```

Do not drop tables, remove storage objects, erase IndexedDB, or rewind migrations
for a code rollback. Retain at least the current and previous releases. Older
workers are replaced through the normal close/reopen lifecycle.

## Real data smoke, then browser smoke

Obtain a short-lived Supabase user JWT through normal sign-in, securely on the
host. Supply `PORTER_SMOKE_TOKEN`, `PORTER_SMOKE_ORIGIN`, and
`PORTER_EXPECTED_REVISION` as environment variables (not command-line values).
Run `npm run smoke`. It creates an explicitly disposable Trip, Event and Knowledge
via `/client/mutate`, reads them through the TripPacket and checks repeatability,
authorized lists, anonymous denial, manifest and icons. It prints generated IDs
for cleanup. It does not claim browser rendering or IndexedDB verification.

Optional artifact check: load the runtime environment securely, set
`PORTER_SMOKE_TRIP_ID` to that disposable Trip, then run
`node scripts/artifact-smoke.mjs`. It uses the existing persistent semantic service
and artifact-storage adapter to save a clearly non-admission text original,
attaches its checksum through `updateEvent`, and verifies the authenticated HTTP
download. This adds no new artifact-upload API. After browser sync the artifact
can be checked in diagnostics/Door Mode as a cached original, not a real ticket.

On the deployed origin in a real browser:

1. Open `/?porter-diagnostics=1`, sign in with the configured owner, open the
   disposable Trip in Trips. No `porter-fixture` query may activate fixture data.
2. Confirm the Event/Knowledge render and sync completes. Diagnostics must show
   Trip ID, generated time, revision, last successful sync, usable local packet,
   artifact present/missing state, perspective, queue/conflicts and timings.
3. Reload: `usefulLocalDataAtLaunch` should be true; utility must appear before
   background sync, which should then succeed. Preserve the metadata-only trace.
4. Verify the manifest/icon requests and root-scoped service worker. After closing
   and reopening, diagnostics should show the controller's build/cache identity.
5. Inspect Cache Storage: hashed application shell and used generic art are
   separate; art is bounded and old build caches retire after activation.
6. Visit `/health` and `/build.json` to verify merged revision. Report separate
   results for HTTP data smoke, browser/IndexedDB smoke and PWA worker smoke.

Tests using in-memory seams are automated regression evidence only, never a
substitute for these real production checks. `/health` alone does not prove
Supabase, sign-in or persistence. No fixture is used for the production smoke.

Cleanup: archive the disposable Trip via the semantic API if retaining diagnostics
is useful. For full removal, delete the specific recorded disposable objects from
Storage through its API/dashboard, then the exact disposable Trip through an
operator database operation after verifying its `PORTER SMOKE — DELETE ME` title.
Event/Knowledge FKs cascade. Do not add a product deletion feature for this smoke.
Clear only the disposable origin/device cache when deliberately retiring test data.

## Acceptance boundary and known observations

Actual iPhone installation, airplane mode, scanning, offline writes, interrupted
sync, perspective changes, suspension/relaunch and visual approval remain the
user's subsequent acceptance session. No iPhone acceptance is claimed here.

Existing behavior to observe during that pass: Event editing relies on revision
metadata in projected descriptors; mutation retry after an ambiguous network
failure and atomicity around direct post-edit refresh merit hardening review.
These broader semantics were not redesigned by this deployment task.
