# v1 — PR series

Execution plan for [`architecture-plan.md`](architecture-plan.md) §14 "v1".

One long-lived epic branch, `epic/v1`. Every row below is one small PR **into** `epic/v1`,
branched flat from it (never stacked). One final PR from `epic/v1` to `main`.

Cut by **file ownership**, not by feature. No file is owned by two open PRs. Where three or
more PRs wanted the same file, the seam was extracted first as its own inert PR — that is
what rows 1–6 are, and they exist because an adversarial review of the plan identified six
shared mutable surfaces with no owner.

---

## Foundation — strictly sequential, nothing else starts until these land

These are the six contested surfaces. All are behaviour-neutral or inert by construction:
they add code that nothing yet reads.

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| 1 | Scaffold and toolchain | Vite 8 + React 19 + TS app that builds and serves an empty shell; ESLint, Vitest, CI running lint + typecheck + test + `verify-catalog-facts.py` | `package.json`, `tsconfig*.json`, `vite.config.ts`, `eslint.config.js`, `vitest.config.ts`, `.nvmrc`, `index.html`, `src/main.tsx`, `.github/workflows/ci.yml` | — | yes (inert) |
| 2 | Design tokens | The Parchment palette as the single theming API, consumable from both CSS and TS | `src/tokens/tokens.css`, `src/tokens/tokens.ts`, `src/tokens/tokens.test.ts` | 1 | yes (inert) |
| 3 | Catalog schema | Zod schemas + inferred types for the catalog record and the `catalog.json` contract. The `Footprint` union, `kinds[]`, `conn[]`, `layer`, `blob`, `id`, manifest ordinal | `src/catalog/schema.ts`, `src/catalog/schema.test.ts` | 1 | yes (inert) |
| 4 | Importer and version stamp | Build-time pipeline: fixtures → `catalog.json`. Footprint resolution, layer classification, connection normalisation, display names, family, tag interning, **append-only manifest ordinals**, and the pipeline version stamp all three derived artefacts embed | `pipeline/**`, `scripts/import-catalog.ts` | 3 | yes (inert) |
| 5 | Store and persistence | Zustand store for library, placements and the global lock preference, with `persist`, `version`/`migrate` and a migration test harness | `src/store/**` | 3 | yes (inert) |
| 6 | Routes and URL state | TanStack Router tree; `validateSearch` schemas for facet and query state, shared by catalog and builder palette | `src/routes/**`, `src/search/searchSchema.ts` | 1, 3 | yes (inert) |

**Row 4 is the schedule risk.** Footprint resolution and layer classification are
straightforward; the append-only ordinal invariant and the design→(texture, lock) resolution
table are where the work is. It also owns the CI assertion on catalog payload size.

---

## Wave A — pure modules, headless-testable, fully parallel

Three agents can run these at once. None imports another; all are exercised by unit tests
rather than by the UI.

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| 7 | Facet and search engine | `Uint32Array` bitset facet index with disjunctive counts + MiniSearch text layer. Tokenised matching, size-token synthesis, word boundaries | `src/search/**` (except `searchSchema.ts`) | 3, 6 | yes (inert) |
| 8 | Material registry | `resolveMaterial(tags)` over 16 families / 38 roots, with the ΔE00 separation asserted in a test | `src/materials/**` | 3 | yes (inert) |
| 9 | Assembly resolution | Base↔topper matching on shape + `size|openlock` code; the `connection\|openforge` base auto-insert rule; bill-of-tiles roll-up with md5 dedupe | `src/assembly/**` | 3 | yes (inert) |
| 10 | Share-link codec | Columnar JSON → `CompressionStream('deflate-raw')` → base64url, with manifest-version checking and round-trip tests | `src/share/**` | 3, 5 | yes (inert) |
| 11 | Zip download | `client-zip` + `native-file-system-adapter`, md5 dedupe, filename disambiguation, `predictLength` from fixture sizes, `ATTRIBUTION.csv` + `LICENSE.txt` entries | `src/download/**`, `vendor/client-zip/**` | 3, 9 | yes (inert) |

---

## Wave B — UI, after the shell lands

Row 12 is a seam: three screens need the same app frame, so it lands alone first.

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| 12 | App shell | Sticky header, wordmark, nav with live counts, page frame. Base UI provider setup | `src/ui/shell/**`, `src/ui/primitives/**` | 2, 5, 6 | no |
| 13 | Catalog screen | Facet sidebar, search input, virtualised card grid, empty and loading states | `src/screens/catalog/**` | 7, 8, 12 | no |
| 14 | Library screen | Grouped-by-kind library, remove, empty state, "open in builder" | `src/screens/library/**` | 12, 13 | no |
| 15 | Tile detail drawer | Sprite-sheet viewer with drag/keyboard rotation, spec grid, tags, family variants, storage address as a link | `src/screens/detail/**` | 8, 12 | no |
| 16 | Landing | Hero, three numbered cards, live stats from the index | `src/screens/landing/**` | 12 | no |

---

## Wave C — the builder

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| 17 | Plan-view canvas | Top-down builder: grid, snap at 0.5 units, per-tile rotation step, place/erase, RECT + WALL_SEG rendering from footprints and family colours | `src/builder/canvas/**` | 8, 9, 12 | no |
| 18 | Builder shell | Three-column layout, palette with catalog search, floating toolbar, bill-of-tiles panel with size warning surface, download action | `src/builder/panels/**`, `src/screens/builder/**` | 11, 17 | no |
| 19 | Lock preference UI | One-time lock system picker showing reachable-design counts (openlock 100%, dragonlock 70.2%, magnetic 67.5%) | `src/screens/settings/**`, `src/ui/lock-picker/**` | 5, 12 | no |

---

## Assets and deployment — late, own seam

| # | Title | Goal | Owns | Depends on | Neutral? |
| --- | --- | --- | --- | --- | --- |
| 20 | Thumbnail pipeline | Crop sprite frame 0 → 256 px q80 WebP → `/thumbs/{md5[:6]}/{md5}.webp` | `tools/thumbnails/**` | 4 | yes (build-time only) |
| 21 | Gated 3D viewer | `<Stage>` owning renderer + N8AO post stack; STL load behind a ~20–25 MB size gate with sprite fallback | `src/three/**` | 8, 15 | no |
| 22 | Deployment | `wrangler.jsonc`, SPA fallback routing, deploy workflow, cache headers on the app's own assets | `wrangler.jsonc`, `.github/workflows/deploy.yml` | 1 | **no — switches on staging** |

---

## Non-PR blockers

These gate rows exactly like a dependency and are the ones that get forgotten.

| Blocker | Gates | Owner | Status |
| --- | --- | --- | --- |
| Cloudflare zone admin: CORS unconditional **first**, then the cache rule | 20 (upload), 22 (verify) | needs zone access on `openforge.tools` | **open** |
| R2 write credentials for the `/thumbs/` prefix | 20 | project owner | **open** |
| Publisher declaration (free, non-monetised community tool) | public launch, not any PR | project owner | **open** |
| Lawyer read on conveying OpenSCAD WASM | v2 only — does not gate v1 | project owner | deferred |

Rows 20 and 22 can be **written and reviewed** without these; they cannot be **run against
production** without them. Build them, hold the execution.

---

## Running it

- Every branch is `pr/NN-slug`, branched from `epic/v1`. Flat, never stacked.
- Two or three agents at a time on disjoint `Owns` sets, each in its own worktree with
  distinct scratch names.
- Each agent brief states: goal, `Owns`, **what it must not touch and which PR owns that
  instead**, how to verify, how to finish.
- A PR is ready only when the agent has finished, CI is green, and review comments are
  addressed. "Ready for review" and "still working on it" are mutually exclusive.
- Merge `main` into `epic/v1` periodically so the final merge holds no surprises.

## Verification per wave

| Wave | What proves it works |
| --- | --- |
| Foundation | `verify-catalog-facts.py` exits 0; importer output validates against the Zod schema; ordinal-stability test passes across two runs |
| A | Unit tests only — no UI needed. Facet counts match a brute-force oracle; ΔE00 minimum asserted; share codec round-trips; zip opens with correct CRCs |
| B | Component tests plus a manual pass against `design-contract.md` |
| C | Place a room, verify the bill of tiles against the assembly rules, download and unzip it |
| Assets/deploy | Thumbnail byte reduction measured; staging deploy serves the SPA and 404s route correctly |
