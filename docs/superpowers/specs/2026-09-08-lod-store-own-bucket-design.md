# Serving the derivative stores from a bucket we own

**Date:** 2026-09-08
**Status:** design approved, implementation not started
**Closes:** B2 (R2 write credentials), and with it B7 (the LOD backfill) and the
thumbnail backfill. Turns B5 and B6 from requests upstream into settings we own.

**Does not close B1.** B1 is the zone rules on `objects.openforge.tools`, and only its
derivative half moves here. `models` and `sprites` stay upstream, so the missing edge
cache rule on `/models/` remains upstream's to fix — and it still costs us, because the
`src/mesh/` in-browser fallback fetches source STLs from `/models/` and will keep seeing
`cf-cache-status: DYNAMIC` on every one. That is latency only, and it shrinks as the LOD
store fills, since a mesh served from `/lod/` is never fetched from `/models/` at all.

## The problem

`/lod/` and `/thumbs/` are both prefixes on `objects.openforge.tools`, which is not our
bucket and not in our Cloudflare account. Neither store has ever been written:

| | |
| --- | --- |
| LOD objects uploaded | **0** of a projected 8,353 |
| Records carrying a thumb | **0** of 8,702 (`pipeline/thumbs.ts`: probed 2026-09-02, 8,352 absent) |

`docs/launch-blockers.md` B2 asks for "an R2 API token scoped to Object Read & Write on
this bucket only" — a credential the bucket's owner has to issue. Both backfills have
been waiting on that one grant. The tools are written, measured and tested; they have
nothing to write to.

Owning the destination removes the dependency. It does not remove the credential step —
it makes it ours to perform instead of someone else's to approve.

## What the app already supports, and what it does not

The move is small because the index was built to express it. `assets.lod` is a **declared
field** on `CatalogAssets` (`src/catalog/schema.ts:1080`), not a value derived from
`assets.models`, and its docblock states the reason: `z.object` strips unknown keys, so
"a base that is not in this schema cannot reach a reader at all". The consumer's URL
guard is host-agnostic:

```
LOD_GLB_URL = /^https:\/\/[^/?#]+(?:\/[^/?#]+)*?\/lod\/([0-9a-f]{6})\/([0-9a-f]{32})\.glb$/
```

— any origin, so long as the path ends `/lod/{shard}/{md5}.glb` (`src/builder/three/lod.ts:166`).

One thing blocks it. `tools/lod/catalog.ts:190` `lodBase()` throws unless `assets.lod` is
the same origin **and** same parent path as `assets.models`. That guard is deliberate and
its comment says what it buys: without it, a typo in one field "would let a typo in one
field send every mesh URL to a host nobody uploaded to, and the symptom would be 8,353
absences reported as 'the store has not been built yet'". A store on our own bucket
violates it by construction, so it must be *restated*, not deleted.

`tools/thumbnails/` has no equivalent guard — `thumbPrefix` (`catalog.ts:141`) derives its
prefix from `assets.thumbs`'s own last segment. It moves origin with zero code changes.

## Decision: restate the invariant across the derivative pair

Considered and rejected:

- **A live probe instead of a structural check.** Validate the URL shape only, then `HEAD`
  the base at startup and refuse if it does not answer. Rejected: it puts a network call
  into a tool whose `--dry-run` mode exists specifically to plan with no network at all,
  and it cannot distinguish a typo'd host that happens to exist from the right one.
- **A `derivatives` base in the schema.** Model the two-origin split as a first-class
  field and derive `lod`/`thumbs` from it, making the invariant unspellable rather than
  checked. The better design in the abstract, and the right move if a third store ever
  appears or the two split apart. Rejected for now: it is a schema bump (4 → 5) touching
  every fixture, `pipeline` and `src/catalog`, to express something two fields already
  agree on.

**Chosen:** `lod` and `thumbs` are now both ours, so the co-location group is redrawn
around them. `lodBase()` will require that `assets.lod` and `assets.thumbs` share an
origin and a parent path *with each other*, and that `lod` still ends in a `/lod`
segment. Same purpose — a typo is caught by disagreement with a sibling rather than
surfacing as 8,353 absences — with the sibling being the store we write instead of one of
the four we do not.

## Code changes

### `pipeline/version.ts:314`

```ts
export const ASSET_BASES: CatalogAssets = {
  models:  'https://objects.openforge.tools/models',   // unchanged — upstream, read-only
  sprites: 'https://objects.openforge.tools/sprites',  // unchanged — upstream, read-only
  thumbs:  'https://bucket-openforge-workshop.mfinn.de/thumbs',
  lod:     'https://bucket-openforge-workshop.mfinn.de/lod',
}
```

`models` and `sprites` stay upstream: 106.13 GB of STL is neither mirrorable at this
budget nor ours to redistribute.

### `tools/lod/catalog.ts:190`

`lodBase()`'s co-location check moves from `models` to `thumbs`, per the decision above.
`lodPrefix`/`lodKey`/`lodPath` continue to derive from it unchanged, so key and URL still
cannot drift apart.

### No index commit

`public/catalog/catalog.json` is **gitignored** (`.gitignore:36`, *"reproducible from the
fixtures, never committed"*). `deploy.yml` fetches the fixtures at the SHA pinned in
`.github/fixtures.env` and runs `npm run stamp` on every deploy, which regenerates the
index, the share manifest and the sidecar. Changing the constant *is* the propagation
mechanism; there is no generated artefact to commit.

### Unchanged, deliberately

| | |
| --- | --- |
| `src/catalog/schema.ts` | `CatalogAssets` keeps four fields. No schema bump. |
| `src/builder/three/lod.ts` | `LOD_GLB_URL` is already host-agnostic. |
| `tools/thumbnails/*` | No co-location guard. |
| `src/download/source.ts` | Still refuses `/lod/` segments. The change *strengthens* the "two builders reject each other's output" property: the stores now differ by origin, not only by path segment. |
| `wrangler.jsonc` `MODELS_BASE` | Stays upstream. The `/zip` Worker serves original STLs and must never reach a derivative. |

## Infrastructure

**Bucket:** `openforge-workshop-assets`, location hint **WEUR**, storage class
**Standard**. The name never reaches the app; only the hostname does. Not Infrequent
Access — it saves $0.001/month at 211 MB and charges $0.01/GB to read, so the retrieval
fee overtakes the saving within the first few thousand fetches.

**Custom domain:** `bucket-openforge-workshop.mfinn.de` on zone `mfinn.de`
(`dc9e2891da2fff000218a15cf7f32ff8`), which provisions the CNAME. A single label, because
free Universal SSL covers only first-level subdomains of `mfinn.de` — the trap
`staging-openforge-workshop.mfinn.de` already hit.

**The r2.dev development URL stays disabled.** Cloudflare's limits page calls it
non-production, throttled to `429` in the hundreds of requests/second, and uncacheable.

**CORS** — read-only:

```json
[{
  "AllowedOrigins": [
    "https://openforge-workshop.mfinn.de",
    "https://staging-openforge-workshop.mfinn.de",
    "https://*.young-king-75dd.workers.dev",
    "http://localhost:5173"
  ],
  "AllowedMethods": ["GET", "HEAD"],
  "ExposeHeaders": ["ETag", "cf-cache-status"],
  "MaxAgeSeconds": 3600
}]
```

`GET`/`HEAD` only: uploads go through the S3 API with credentials, never a browser, and a
bucket that accepts browser `PUT`s is a bucket anyone can fill. `localhost:5173` is
vite's default (`vite.config.ts` sets no `server.port`).

The workers.dev wildcard covers PR preview aliases
(`pr-<n>-openforge-workshop-staging.young-king-75dd.workers.dev`). R2 follows S3 CORS
semantics, which permit one `*`, but Cloudflare does not document it — so it is set and
then verified with a real preflight. **If it is rejected, previews fall back to
in-browser conversion, which is today's behaviour**, so it blocks nothing.

Exposing `ETag` closes **B5**, with a precise caveat: B5 was downgraded because 58.5% of
source STLs exceed R2's 8 MiB part size and receive a multipart digest rather than an
md5. Every LOD object is ~21 kB, so all of them carry a real md5 ETag — of the **GLB**,
not of the source STL whose md5 names the path. It verifies transfer integrity, not
recipe identity.

**Cache rule** on `http.host eq "bucket-openforge-workshop.mfinn.de"`: eligible for
cache, Edge TTL and Browser TTL **1 year**. The data is content-addressed, therefore
immutable — a given `/lod/{shard}/{md5}.glb` cannot change meaning, and a different mesh
is a different md5 at a different URL. `.webp` is in Cloudflare's default cached
extensions; **`.glb` is not**, so without this rule the LOD store repeats the
`cf-cache-status: DYNAMIC` problem the upstream bucket has. Objects also get
`Cache-Control: public, max-age=31536000, immutable` at upload, so browser caching does
not depend on a zone rule.

**Response header transform** on the same expression, setting
`Cross-Origin-Resource-Policy: cross-origin`. This closes **B6**, and it is not
hypothetical here: B6's note says the thing most likely to force cross-origin isolation is
a feature wanting `SharedArrayBuffer`, "exactly the kind of thing a WASM geometry pipeline
reaches for" — and this repo vendors a 10.5 MB OpenSCAD WASM engine. Both rule phases
currently return `10003: could not find entrypoint ruleset` on this zone, meaning no rules
exist yet; each entrypoint gets created.

**Division of labour.** Dashboard-only, and therefore the user's: **enabling R2** (the API
returns `10042: Please enable R2 through the Cloudflare Dashboard`) and **minting the S3
token** (Object Read & Write, this bucket only — the Cloudflare MCP cannot create tokens;
every `/user/tokens` call returns `9109 Unauthorized`). Everything else — bucket, custom
domain, CORS, cache rule, transform rule — is API work.

## Sequence

**Phase 1 — land the code change against an empty bucket.** TDD the restated invariant,
change the two bases, `npm run stamp`, then `npm test && npm run lint && npm run
typecheck`. At the end of this phase the app points at a bucket holding nothing, every LOD
request 404s, and behaviour is identical to today — because absence is the expected state
(`LOD_ABSENT_IS_EXPECTED`) and `src/mesh/` answers it by converting in the browser. There
is no cutover moment.

**Phase 2 — provision**, per Infrastructure above.

**Phase 3 — prove the plumbing on four objects.** `npm run lod -- --sample 4`, sync, then:

- `curl -I -H 'Origin: https://openforge-workshop.mfinn.de'` → expect
  `access-control-allow-origin`, `cross-origin-resource-policy: cross-origin`, an `etag`,
  and `cf-cache-status: MISS` then `HIT`.
- Load staging and confirm a tile renders with `LodGeometry.source === 'lod'` rather than
  the converted cache — the field exists "for the readout and for the tests".

Cheap, and it catches a CORS typo or a `DYNAMIC` miss before either costs an hour.

**Phase 4 — the LOD backfill**, in two bites:

| | meshes | egress in | LOD out | wall clock at ~9 MB/s |
| --- | ---: | ---: | ---: | ---: |
| `--above-gate` first | 957 | 34.25 GB | ~23 MB | ~65 min |
| `--all` after | 8,353 | 106.13 GB | 176.1 MB | ~3.3 h |

`--above-gate` is the high-value slice: those 957 meshes are the 11.2% the 24 MiB STL gate
refuses outright, so they have no 3D path at all today rather than a slow one. Resumable
by construction — without `--force`, existing objects are skipped.

**Phase 5 — the thumbnail backfill.** `npm run thumbs`, the `aws s3 sync`, then the two
commands `pipeline/thumbs.ts` names: `npm run thumbs -- --inventory` (re-probing all 8,352
against the new host) and `npm run import:catalog`.

The **inventory** — which `--inventory` rewrites as TypeScript source — is the only thing
committed in this phase. `import:catalog` runs to *verify* that the rewritten inventory
produces `thumb: true`, not to produce a committed artefact; the index stays gitignored
and gets rebuilt on deploy as always. The inventory must follow the upload rather than
accompany it, because `thumb: true` on an absent object is "a permanent regression
indistinguishable from the 8,352-strong majority that genuinely is absent". `--inventory`
enforces this itself: it refuses to write if any probe failed.

**Not started without the owner's say-so:** the `--all` run pulls 106 GB from OpenForge's
production bucket. The tool is polite by construction — concurrency 8, spaced requests,
bounded retries, an identifying User-Agent, md5-verified bodies — and free in dollars
(R2 egress), but spending a few hours of someone else's bandwidth is a courtesy decision,
not a technical one.

## Verification

| After | Evidence |
| --- | --- |
| Phase 1 | Full suite green (4,070 at baseline, plus the rewritten invariant tests); stamp shows `config` changed from `6b3c490c45723f28` while `content 09cca68bb8a958f5`, `schema 4` and `pipeline 3` hold — proving the move is configuration, not a derivation change (`tools/stamp/lock.test.ts:205`) |
| Phase 3 | The four response headers above, and one tile rendered with `source === 'lod'` |
| Phase 4 | The run report's own counters — written / skipped / empty / failed, byte and triangle reduction, fidelity — against the 8,353-object, 176.1 MB projection. The tool exits non-zero if any object failed |
| Phase 5 | `thumb: true` on 8,352 records in the regenerated index |

Tests to rewrite, old-first: `tools/lod/catalog.test.ts:79` ("derives the LOD base by
swapping the models segment") and `:106` ("refuses a store that is not beside the
meshes") both encode the old rule. `:131` (no path segment) survives. `pipeline/catalog.test.ts:166`
reconstructs model URLs from `assets.models`, which does not move.

## Cost

| | | |
| --- | ---: | ---: |
| Storage, both stores | 211 MB | **$0.0032 / month** |
| Backfill reads (8,353 + 8,352 Class B) | | $0.006 |
| Backfill writes (16,705 Class A) | | $0.075 |
| Egress, in and out | 110 GB | **$0.00** |
| **One-time** | | **~$0.08** |

All within R2's monthly free allowances (10 GB storage, 1M Class A, 10M Class B). Serving
is one Class B op per read at $0.36/million — a 20-tile room costs $0.0000072, and the
cache rule means most reads never reach R2 at all. The real cost is wall clock: ~3.3 hours
of downloading, once.

## New failure mode

One, and it is worth naming because it did not exist before. Today a missing LOD is a
404, which `LodAbsentError` models as expected. On a cross-origin host there is a second
way to fail: **a CORS rejection is indistinguishable from a network fault to `fetch`**, so
it surfaces as `LodLoadError` — retryable — and the panel will retry a wall it cannot get
past. Hence the CORS policy is set before any object is uploaded, and phase 3 verifies it
with a real preflight. With an empty bucket the question does not arise, because a 404
needs no CORS header to be read as absent.
