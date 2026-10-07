# V0 static artifact ingestion

`store_artifact` completes the existing semantic/storage path; no new artifact
model/table, external phone scraping, ticket reconstruction or readiness rule.
Metadata attachment alone does not copy an external ticket. The browser delivery
adapter rejects external refs instead of attempting a Supabase lookup with them.

## MCP input

Resolve the owned Event and current revision from `get_trip_context`. Supply:

```json
{
  "eventId": "<Event UUID>",
  "expectedRevision": 4,
  "staticArtifact": true,
  "artifact": {
    "id": "candide-seat-a",
    "role": "ticket",
    "participantIds": ["wes"],
    "satisfiesAdmissionIds": ["seat-a"],
    "offlineRequired": true
  },
  "source": {"url": "https://authoritative.example/original-qr.png"}
}
```

Alternatively supply `source.base64` containing the exact original bytes, and
`source.mediaType` (`image/png`, `image/jpeg`, `application/pdf`), optionally
`source.filename`. Exactly one URL/base64 source is required. No file URI,
authenticated browser/Gmail cookies, screenshots, OCR or regenerated QR payload.
If a URL needs external authentication and the available Gmail/file tool cannot
return original bytes as base64, obtain the original file from the user rather
than claiming ingestion. No Candide source was fetched during development.

Maximum decoded size is **5 MiB**, total URL download including DNS/redirects
**15 seconds**, at most **3 redirects**. Successful uncompressed HTTP 200,
normalized media type and matching PNG/JPEG/PDF signature are required. HTML
login/error pages, unsupported content, oversize streams and invalid base64 fail
without metadata writes. The private HTTP MCP parser authenticates before its
bounded 8 MiB JSON parser; semantic base64 limits are smaller.

URL ingestion uses HTTPS port 443 only, rejects credentials and private/reserved
destinations, resolves/pins a public IPv4 address per hop into a fresh TLS
connection, and revalidates redirects. TLS authenticates the source hostname.
No cookies, MCP/Supabase credentials, caller headers or proxy settings are
forwarded. IPv6-only sources are deliberately unsupported in V0; use original
bytes instead. Test dependency seams are not exposed via MCP/configuration.

## Persistence and concurrency

Ownership and source Event revision are checked before fetching. The existing
`PersistentPorterService.storeArtifact()` uploads (no upsert) to
`TripID/EventID/ArtifactID/original`, computes SHA-256, then atomically updates
Event metadata with the normal expected revision. Role, participants, admissions,
offline requirement and useful source URL are retained; the authoritative ref is
Porter Supabase storage. Missing version defaults to the content hash. On a failed
metadata CAS/update, the new object is deleted using the existing cleanup path;
cleanup failures remain attached to the error, never reported as ingestion success.
Storage/database transactions cannot be atomic; a crash or failed cleanup can
leave a private orphan for exact-path administrative cleanup.

An existing external artifact can be materialized with the **same artifact ID**,
preserving unspecified mappings/metadata. It replaces that one metadata record,
not unrelated artifacts. An already Porter-owned original is refused: in-place
byte replacement would make rollback/concurrent revision protection unsafe.
Uncertain write outcomes must be read/reconciled before retrying.

`staticArtifact: true` is an explicit assertion, not automatic URL classification.
Known `external_dynamic` admissions are rejected. A server cannot infer every
venue's rotation policy from image bytes; the caller must preserve specialist-app
semantics and never freeze a dynamic credential.

## Phone and deployment

Apply `supabase/migrations/20261007101725_porter_mcp_artifact_delivery.sql` before
deploying. Service-role MCP uploads do not carry an end-user Storage owner_id;
the additive SELECT policy authorizes only the authenticated Trip owner and exact
canonical object referenced in owned Event metadata. No public bucket, arbitrary
prefix grant, write grant or service credential is added to the phone. Custom
artifact buckets still need equivalent existing bucket policies configured by
the operator. The existing default deployment uses `porter-artifacts`.

The phone receives bytes through `/client/artifacts/:eventId/:artifactId` and
uses unchanged sync checksum/version verification and atomic IndexedDB commit.
Only **device-local verification** permits ready-offline status. Ingestion success
does not. Door displays verified cached original PNG/JPEG bytes via a local Blob
URL, revoked on paging/close; PDFs retain the existing cached-original fallback.
Decorative artwork remains independent. Dynamic credentials stay external.

Restart/redeploy the reviewed MCP/app build using the existing deployment guide,
and update the existing Porter plugin package from its source (version 0.1.1;
identity/connection unchanged). No plugin publication, migration or production
Event mutation has been performed as part of development. App rollback may retain
the additive read policy; do not remove stored artifacts as an application rollback.

## Verification and manual acceptance

CI uses disposable QR/PDF data, in-memory MCP transport, the real production
client endpoint/bundle and isolated PostgreSQL RLS checks. Chromium covers fully
offline controlled reload; Linux WebKit uses the established API-unavailable
reload seam. Neither is physical-iPhone acceptance.

After review/deployment, obtain all three authoritative Candide originals from
Gmail, materialize their existing IDs, verify owned server refs, allow phone sync,
confirm all expected tickets ready offline, then airplane-mode cold-launch and
page through Candide Door Mode. This real acceptance is explicitly deferred; no
real Candide/Los Angeles data was touched.
