# OpenForge Workshop

A catalog and room builder for the [OpenForge](https://openforge.tools) library of
3D-printable modular dungeon terrain.

**→ [openforge-workshop.mfinn.de](https://openforge-workshop.mfinn.de)**

Browse 8,702 tiles with real previews, lay out a room on a virtual workbench, and download
exactly the STL files that build needs — plus generate parametric bases on the fly.

## What it does

- **Faceted catalog** — the whole index ships to the browser, so search, filtering and
  facet counts run with no server round-trip. Tiles carry tags, footprints, sizes and
  composition configs.
- **Room builder** — place tiles on a grid, and the app resolves what physically connects
  to what. Select a piece to move, turn, re-part or remove it, with undo behind every
  edit; a placement that would exactly overlap a neighbour is refused rather than
  silently hatched, so a room you download can be built. The result is a bill of tiles.
- **Download** — a bill becomes a ZIP built in the browser by a vendored `client-zip`,
  streamed straight from the asset bucket via `showSaveFilePicker` where the platform has
  it. Browsers without it buffer, and split the archive into several parts above the
  buffering ceiling. There is no server in the download path at all.
- **Base generator** — OpenSCAD compiled to WebAssembly, running in a worker, driving the
  Apache-2.0 `openforge-bases` geometry from a parameter panel.

## Shape

Static single-page app, no always-on backend, deployed to Cloudflare as an assets-only
Worker.

**The fact that sets the architecture:** the full index over all 8,702 live tiles —
carrying tags *and* composition configs — measures **367 KB brotli** (5.91 MB raw), against
a 500 KB budget asserted at import time. At that size there is no reason for a query
backend, so there isn't one.

[`docs/architecture-plan.md`](docs/architecture-plan.md) is the full picture. Every number
it quotes is machine-verified: [`docs/verify-catalog-facts.py`](docs/verify-catalog-facts.py)
re-derives them from the fixtures and fails on a broken invariant, and CI runs it.

## What this is, and is not

This is a **separate project** from `openforge-catalog`. It shares two things with it and
nothing else:

- **Assets** — STL files and sprite-sheet previews are served from the existing public
  Cloudflare R2 bucket at `objects.openforge.tools`. This project never writes to it. The
  two *derivative* stores it produces itself — decimated `/lod/` meshes and `/thumbs/` —
  live on its own bucket at `bucket-openforge-workshop.mfinn.de`.
- **Metadata** — tile data is imported at build time from the catalog repo's JSON
  fixtures and compiled into a static index. There is no shared database, no shared API,
  and no shared code.

It deliberately does not follow the catalog's architecture, conventions, or stack.

## Getting started

The toolchain is pinned in `mise.toml` — Node and Python versions, and the tasks that wrap
them. [mise](https://mise.jdx.dev) is the only prerequisite.

```bash
mise install      # fetch the pinned toolchain
mise run setup    # npm ci
mise run check    # lint, typecheck, test, build — the same order CI runs
mise run facts    # re-derive the catalog numbers the plan quotes
npm run dev       # dev server
```

The Node floor is a constraint, not a preference. `wrangler` requires 22, and on Node 20
npm silently resolves down to a version that violates its own peer range; `jsdom` then
pushes the floor to 22.22.2. `mise.toml` holds the exact version.

### The catalog index

`public/catalog/*.json` is derived and gitignored, so a fresh checkout does not carry it.
Point `OPENFORGE_FIXTURES` at a checkout of the pinned upstream fixtures and rebuild:

```bash
npm run stamp     # regenerate the index and share manifest, join the
                  # content-addressed derivatives, write stamp.json
```

The upstream commit is pinned in [`.github/fixtures.env`](.github/fixtures.env), which also
carries the refresh procedure. It is pinned rather than tracking a branch because several
suites assert exact per-family counts, and an upstream scan that adds tiles would otherwise
turn into a surprise red build on an unrelated PR.

Without the fixtures the corpus suites skip rather than fail — CI checks for that, because
a green board that ran a fraction of the tests is worse than a red one.

Where accessories attach is **measured off the meshes**, not derived from the fixtures, so
it is checked in rather than rebuilt:

```bash
npm run mounts               # read and measure the host and insert meshes
npm run mounts -- --inventory  # write pipeline/mounts/inventory.json from that log
```

The run reads ~16 GB out of the public bucket once — **1,130 objects**, ≈1.5 h on 16
threads — and is resumable at md5 granularity, so an interrupted run costs nothing to
finish and a finished one is never repeated. Those 1,130 yield 995 measured hosts and 139
anchored inserts; four blobs are filed both ways and answer both questions from one parse. `npm run stamp` and `npm run import:catalog`
only *read* the committed inventory. Re-run the pair when a host or insert mesh changes —
a re-export gets a new md5, which drops out of the inventory and takes its mounts with it.

## Repository layout

| Path | What it holds |
| --- | --- |
| `src/` | The app — catalog, builder, generator, download, search, three.js layer, UI kit |
| `pipeline/` | Build-time import: fixtures in, static catalog index out |
| `tools/` | CLIs for the derived asset stores — thumbnails, LOD, measurement, stamping |
| `scripts/` | One-shot maintenance entry points (`import:catalog`, `refresh:scad`) |
| `vendor/` | Third-party code kept in-tree with its provenance and licences |
| `design/` | Source of the approved visual design, mirrored from Claude Design |
| `docs/` | Architecture plan, design contract, and the research behind them |

## Deploys

`.github/workflows/deploy.yml` deploys on push to `main` — **staging** automatically, and
production only via a deliberate `gh workflow run deploy.yml -f environment=production`.
Both re-run lint, typecheck and the full suite first, because a push to `main` can reach
the workflow without a PR.

Every pull request also gets its own preview URL, uploaded as a Worker *version* against
staging rather than a deployment, so staging's own traffic is untouched. Preview URLs sit
behind Cloudflare Access.

[`docs/launch-blockers.md`](docs/launch-blockers.md) records the remaining items that only
the project owner can action.

## Licensing

**This project's own code is [MIT](LICENSE).** Three other licences apply to things it
carries or serves, and none of them are MIT:

- **The models are CC BY-NC-SA 4.0.** OpenForge's own statement is that everything
  distributed via the Dropbox is non-commercial, and this catalog is scanned from the
  Dropbox. In practice that means the tool is not monetised — no ads, no paid tier, no
  gating downloads — and attribution rides inside every archive rather than only in a page
  footer.
- **The OpenSCAD WASM engine is GPL-2.0**, vendored unmodified under
  [`vendor/openscad-wasm/`](vendor/openscad-wasm/) with its `COPYING` bundled into the same
  chunk that loads it. [`WRITTEN-OFFER.md`](vendor/openscad-wasm/WRITTEN-OFFER.md) is the
  §3(b) source offer, and names the exact upstream commit the binary reports.
- **`client-zip` is MIT**, vendored under [`vendor/client-zip/`](vendor/client-zip/).

Whether an app that dynamically loads a GPL-2 WASM engine is a derivative work of it is a
legal question rather than a technical one, and it is **not settled here**. What the
project does instead of settling it is keep the engine separable — its own chunk, no static
import path into app code, a worker message boundary between them — and ship the licence
text and the source offer with it. See §10 of the architecture plan for the full reasoning.
