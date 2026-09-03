# Launch blockers — what only the project owner can do

Every PR row of the v2 series is written and merged. **Two rows cannot run**, because
running them means writing to production or touching the live zone. This file is the
ordered list of what unblocks them, with the exact values and the verification for each,
so nothing here needs a decision made twice.

`docs/v2-pr-series.md`'s blocker table is the index; this is the runbook.

## The order matters, and only in one place

**B1 is two rules and they must go in one order: the unconditional CORS rule first, then
the cache rule.** Installed the other way round, the cache rule caches responses that
carry no CORS headers, and the app then fails on cached 200s **that look completely fine
in `curl`** — because `curl` sends no `Origin` and so never sees the missing header. That
is the one mistake in this list that costs a day to diagnose.

Everything else is independent.

---

## B1 — the zone rules on `objects.openforge.tools`

**Gates: X1 (thumbnail backfill), X3 (the zip Worker), X6 (deploy).**

1. **CORS, unconditional.** `Access-Control-Allow-Origin` for the app's origin on every
   response from the bucket hostname, not only on preflights and not only on 2xx. A 404
   without CORS headers is a 404 the app cannot read the status of, and during the
   backfill window a 404 on `/thumbs/` is the *expected* case for all 8,352 objects.
2. **Then the cache rule.** `Cache-Control: public, max-age=31536000, immutable` — the
   objects are content-addressed on the source mesh md5, so a changed mesh is a new key
   and never a rewritten one. Immutable is honest here in a way it usually is not.

**Verify:** `cf-cache-status: HIT` on a second request, and an `Origin:` header present in
the request when you check for `Access-Control-Allow-Origin` — row X6 exists partly
because this was going to be assumed rather than checked.

## B2 — R2 write credentials

**Gates: X1, and G1's LOD upload.**

An **R2 API token scoped to Object Read & Write on this bucket only**. Not an account-wide
token: the backfill writes two prefixes, `/thumbs/` and `/lod/`, and nothing else needs
write access ever.

The tool already prints the exact commands with the credentials as environment variables,
because it does not know them and must not guess — `npm run thumbs -- --manifest` writes
them out. The shape:

```
export AWS_ACCESS_KEY_ID=…
export AWS_SECRET_ACCESS_KEY=…
export R2_ACCOUNT_ID=…
export R2_BUCKET=…
```

Then the dry run, then the same command without `--dryrun`. `aws s3 sync` over R2's
S3-compatible endpoint rather than `wrangler r2 object put`, which would be 8,702 separate
HTTP requests.

**Cost of the run:** ~4.5 GB of egress in, ~35 MB out, about **$0.04**. It reads every
sprite sheet once.

**And then two commands, in this order, or the flag is a lie:**

```
npm run thumbs -- --inventory     # HEADs all 8,352 candidates, rewrites the inventory
npm run import:catalog            # rebuilds the index from it
```

Row P3 built the flag as a real probe for this reason: it refuses to write an inventory if
**any** probe failed, because `thumb: false` on an object that exists is a permanent
regression indistinguishable from the 8,352-strong majority that genuinely is absent.

## B3 — publisher declaration

**Gates: public launch only.** Free, non-monetised community tool. Nothing in the code
waits on it.

## B5 — `Access-Control-Expose-Headers: ETag`

**No longer a launch gate, and the reason it was one turned out to be false.**

The original rationale was that the ETag *is* the md5, making it the way a fetched STL is
verified against the file a recipe named. Rows G1 and W1 measured this independently and
it does not hold: above R2's 8 MiB part size the ETag is an S3 **multipart** digest that
no arithmetic converts back to an md5, and **4,884 of 8,353 blobs (58.5%) are above it.**

So integrity checks hash **content**, which is what the code does. Exposing the header
lets a browser verify the 41.5% that are small. Worth setting when the zone is open
anyway; not worth blocking on.

## B6 — `Cross-Origin-Resource-Policy: cross-origin`

**Gates: X6.** Costs nothing today. Without it, the whole catalog is blocked on day one if
anything ever forces cross-origin isolation — and the thing most likely to force it is a
future feature wanting `SharedArrayBuffer`, which is exactly the kind of thing a WASM
geometry pipeline reaches for.

## B4 — waived

Bundling the GPL-2 OpenSCAD WASM engine in-app. Waived by the owner
(*"don't worry too much about the license"*). Rows S2, S3 and S4 shipped on that basis;
the engine is vendored with its licence bundled beside it and `GENERATED.txt` carries the
full Apache-2.0 text for the geometry, which is separately licensed.

---

## What X6 checks that is not a blocker

Worth knowing before the deploy, because these are the failure modes rather than the
permissions:

- **Disable the `r2.dev` URL.** It bypasses every cache rule and the WAF. Leaving it
  enabled means there are two ways to reach the bucket and only one of them is governed.
- **`content-type` on the STL objects.** Set at sync time, in the same pass.
- **The generator's own headers.** `'wasm-unsafe-eval'` in the CSP and
  `Content-Type: application/wasm` — *"the single most common way a working WASM build
  dies on deploy"*, and it dies at runtime in the browser, not in CI.
- **Deploy secrets.** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub
  environment secrets for `staging` and `production`. The workflow re-runs lint, typecheck
  and the full suite before deploying, because a push to `main` can reach it without a PR.
