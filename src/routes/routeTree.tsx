/**
 * OpenForge Workshop — the route tree.
 *
 * **Two routes: the catalog at `/`, and the builder.** design-contract.md §2's
 * screen inventory had five and architecture-plan.md §14's v1 scope three; what
 * is left is the archive and the thing you build out of it.
 *
 * **It was six.** Four routes have been deleted rather than reshaped, and three
 * of the four for the same kind of reason: what the screen was *for* moved
 * somewhere the user already was.
 *
 *   - **`/settings`** existed because the lock preference had no home in the
 *     contract's inventory (§2's 40.2-point lock spread gave it one). Row L1
 *     moved that preference into the builder's work area, where the owner asked
 *     for it; `src/ui/lock-picker/LockToggle.tsx` carries the argument and the
 *     documented decision it overrules. Nothing else lived there — its own
 *     docblock called it *"the only screen whose whole subject is a single
 *     preference"*, and that was accurate.
 *   - **`/library`** existed because the user kept a set of saved items and
 *     needed a screen to see it on. Row **A0** deleted the library: the templates
 *     plan makes a template the only placement unit, so there is no set of saved
 *     tiles for a screen to be about. One thing on it was not about the library
 *     and had to move first — the JSON export/import, which
 *     architecture-plan.md §13 makes the app's only defence against Safari's
 *     seven-day `localStorage` eviction. It is now `@/builder/panels`'
 *     `BackupPanel`, at the foot of the builder's bill column, because what the
 *     envelope carries is the room.
 *   - **`/assemblies`** was the entrance to row C3's guided walk through the
 *     recipe templates. The walk itself is not deleted — `@/builder/panels/slots`
 *     drives the same `assemblyState` / `resolvePart` pair from the slot editor,
 *     which is where a part is actually filled — so this is `/settings`'s move
 *     again, one level down. What was left once the screen went was a directory
 *     of pure resolution code six other modules already imported *through* a
 *     screen; it is `src/assembly/recipeWalk.ts` and `src/assembly/templates.ts`
 *     now, and `@/assembly`'s barrel carries that argument.
 *   - **`/`, the landing page**, is the one deletion that moved nothing. It was
 *     a page *about* the archive standing in front of the archive: a hero, four
 *     live figures, three numbered step cards and a credit line, every one of
 *     which described what the visitor would find one press further in. The
 *     catalog took its path, so the front door opens onto the archive itself.
 *     Nothing was relocated because nothing on it was a tool — the four figures
 *     were derived from the same index the catalog loads, and the count the
 *     header carried alongside them went with the header.
 *
 * The mock made all four screens client-side *state*, which is why nothing in it
 * was linkable — no filtered view, no open tile, no shared build. This module is
 * the fix, and the point of it is that the URL is the app's state.
 *
 * **Nothing redirects.** `/catalog` was the catalog's path for the whole of v1
 * and v2, and every shared facet link and `?tile=` link ever copied out of this
 * app spelled it, so it is the one deleted path with real traffic behind it. A
 * redirect would be the only piece of URL compatibility in an app that has none,
 * and it would have to live in this file forever to be worth anything; the four
 * deleted paths get the not-found boundary with the rail still on it, which
 * `routes.test.ts` asserts as four cases.
 *
 * ## Why the tree is code-based, not file-based
 *
 * File-based routing needs `@tanstack/router-plugin` registered in
 * `vite.config.ts` and a generated `routeTree.gen.ts` in the repo. That file
 * belongs to PR 1, `package.json` is being edited by PR 4 right now, and the
 * plugin is a dependency this PR was told to stop and ask for. Against that: the
 * tree is two routes and twenty lines, and every route's search contract is
 * visible in one screen. Code-based is not the compromise here — a generated
 * file for two routes would be the compromise.
 *
 * ## Why the tile detail drawer is search state, not a nested route
 *
 * design-contract.md §2.5 puts tile detail in a 442px drawer over the catalog,
 * so `/catalog/tile/$ord` and `?tile=` are both available. Back and forward
 * behave identically under either — a push is a push. Three things decide it:
 *
 *   1. **Garbage tolerance.** `?tile=nonsense` degrades to `null`, which is a
 *      closed catalog. `/catalog/tile/nonsense` is a path parse failure, and
 *      without a hand-written not-found boundary that is a blank page. Every
 *      other param in this app degrades to a default; the drawer should not be
 *      the one that throws.
 *   2. **One state, three consumers.** The facets are read by the catalog
 *      screen, the builder palette and the share-link codec (see
 *      `src/search/searchSchema.ts`). A nested route would split "what is the
 *      catalog showing" across `params` and `search`, so the share codec would
 *      have to serialise a pathname as well as a search object.
 *   3. **A path segment claims to be a page.** `/catalog/tile/4821` is a URL a
 *      crawler indexes and a user lands on cold, with no filters behind it.
 *      `?tile=4821` degrades to the catalog with a drawer open, which is what
 *      the drawer *is*.
 *
 * The one thing search state has to get right is the close action: a plain
 * navigate to `tile: null` would push a third entry and make Back re-open the
 * drawer. `src/routes/tileDrawer.ts` owns that, and the test file proves it.
 *
 * What `?tile=` *means* moved once, in row A4: the catalog now lists 3,822 items
 * over 8,702 files, so the param still names a file by ordinal and
 * `src/routes/tileAddress.ts` resolves that to the item plus the variant it
 * named. The route declaration is unchanged by it — the schema, the middleware
 * and the close semantics all still describe a single optional number.
 *
 * ## Why `/` carries the facet schema now, where it used to carry none
 *
 * It held none while it was the landing page: there was nothing on that screen
 * worth linking to but the screen itself, and declaring the facets there would
 * have put filters in the URL that nothing read. `/library` and `/assemblies`
 * had none for the same reason. The catalog's params come *with* the catalog —
 * the schema and the strip middleware below are the ones that were on
 * `/catalog`, unchanged except for the path they hang off — so `/` is now the
 * one route in this tree whose whole state is in the URL, which is what it means
 * for the front door to be the archive.
 *
 * ## Which route is lazy, and why the catalog is not
 *
 * Row X9 made `/assemblies` lazy, measured it, and left the other five with its
 * figures as the argument for doing each of them properly. Row X10 was that row,
 * and **two of the five did not survive the measurement.** Rows L1, A0 and the
 * sidebar row then deleted three of the four it shipped, so **one** remains
 * lazy: `/builder`. The table below is X10's, kept intact because the deltas are
 * what a future row needs and re-deriving them without the `/settings`,
 * `/library` and `/assemblies` rows would hide how the `@/ui/lock-picker`
 * sharing worked, what a lazy screen's own stylesheet is worth, and what a route
 * whose barrel something eager imports is worth (nothing).
 *
 * Method is X9's: A/B `vite build`s of one tree at
 * `SOURCE_DATE_EPOCH=1700000000`, summing **every file `dist/index.html`
 * preloads**. X9 summed the three JS chunks; the sums below add the preloaded
 * stylesheet, because a lazy screen takes its CSS out of `index-*.css` as well
 * and a JS-only sum books that as a saving it has not made. Baseline is
 * **815,980 raw / 247,766 gz / 213,339 br** over four preloaded files; over X9's
 * three JS chunks alone it is 739,623, which is 1,466 B above the 738,157 X9
 * recorded, because the tree moved under both of us. X9's finding about its own
 * predecessors applies here too: **the deltas are the usable part of this table
 * and the absolutes are not.** (`gzip -9`; brotli is
 * `BROTLI_PARAM_QUALITY: 11`, node's `zlib`, because the box has no `brotli`
 * binary. Brotli is the number that matters — Cloudflare serves these assets
 * brotli-encoded.)
 *
 * Each route made lazy **on its own**, against that baseline:
 *
 * | route | eager raw | gz | br | delta gz | on demand |
 * | --- | ---: | ---: | ---: | ---: | ---: |
 * | `/builder` | 698,245 | 213,088 | 185,202 | **-34,678** | 109,129 (+16,265) |
 * | `/library` | 800,055 | 244,162 | 210,634 | **-3,604** | 23,198 |
 * | `/settings` | 809,066 | 247,697 | 214,886 | -69 | 8,002 |
 * | `/` | 801,232 | 245,792 | 213,838 | -1,974 | 15,902 |
 * | `/catalog` | 816,976 | 248,223 | 213,741 | **+457** | nothing emitted |
 *
 * Two of those rows are not what they look like, and both reasons are the same
 * reason: **a screen is only lazy if nothing eager still imports it.**
 *
 *   - **`/catalog` alone emits no chunk at all.** `@/screens/catalog`'s barrel is
 *     a static dependency of the builder's palette (`loadCatalogSearchIndex`,
 *     `format`) — and was of the library screen too until row A0 — so
 *     `CatalogScreen` is in the eager graph however this route mounts. The lazy
 *     mount adds the wrapper and the dynamic entry and nothing leaves: **+996 B
 *     raw.**
 *   - **`/settings` alone moves 8,002 B and pays for it in brotli** (+1,547 B),
 *     because splitting `@/ui/primitives` out of `index` to share it costs more
 *     compression context than the settings screen weighs. But `LockNotice` in
 *     `BuilderScreen` is the other importer of `@/ui/lock-picker`, so with
 *     `/builder` already lazy the same edit takes the picker with it (10,044 +
 *     4,484 CSS) and is worth **-21,818 raw / -3,833 gz / -1,974 br**. (X10
 *     wrote "the builder's toolbar and `LockNotice`". There was one importer,
 *     not two: nothing in `src/builder/panels/` has ever imported the picker.
 *     The conclusion is unchanged — one eager importer is one too many — and row
 *     L1's `LockToggle` has since made it two for real.)
 *
 * So the four ship as a set, and cumulatively:
 *
 * | tree | eager raw | gz | br |
 * | --- | ---: | ---: | ---: |
 * | baseline (X9's tree) | 815,980 | 247,766 | 213,339 |
 * | + `/builder` lazy | 698,245 | 213,088 | 185,202 |
 * | + `/library` lazy | 682,289 | 209,541 | 182,200 |
 * | + `/settings` lazy — **shipped by X10** | **660,471** | **205,708** | **180,226** |
 *
 * **Row L1 then deleted the `/settings` route, and the saving is not where you
 * would look for it.** A lazy route's screen was never in the eager bundle, so
 * removing the route can only return the declaration and the `import()` wrapper —
 * about 340 raw bytes. Measured against L1's own baseline of **661,438 /
 * 205,802 / 180,593** over **7** preloaded files, the whole row comes to
 * **661,098 / 204,122 / 177,876** over **4**: **-340 raw / -1,680 gz / -2,717
 * br**.
 *
 * **Row A0 deleted `/library` the same way, and the same caveat applies twice
 * over**: the declaration and the wrapper come back, the 23,236 B on-demand
 * chunk and its stylesheet are simply no longer emitted, and whatever else moves
 * is the chunk graph re-forming around one fewer lazy importer of
 * `@/screens/catalog`. The row deliberately does **not** re-quote a figure for
 * it: A0 also moves a component into `@/builder/panels`, which is inside the
 * `builder` chunk, so an A/B of this file alone would attribute that relocation
 * to the route deletion.
 *
 * Almost all of that is the *chunk graph*, not the deleted code. With
 * `/settings` gone, `@/ui/primitives` had one eager importer and one lazy one
 * instead of two lazy ones, and rolldown stopped extracting it as a shared
 * chunk — `primitives` (86,121 raw) and `scene` (1,140) folded back into `index`
 * and compress better there. **This is the same effect the `/settings` row of
 * the table above records, running the other way**, and it is why row L1
 * declined an `@base-ui/react/popover` for its disclosure and reused
 * `@/ui/primitives`' `Dialog`: the popover re-split the chunk and cost **+2,913
 * B gz** on every page. `LockToggle.tsx` carries that A/B.
 *
 * The settings chunk (6,422 raw / 2,223 gz) and its stylesheet (1,586 / 548) are
 * simply no longer emitted, and the shared `lock-picker` pair (10,044 + 4,484
 * CSS) is now inside the builder's own chunk — one fewer request on the builder
 * press.
 *
 * **-155,509 B raw / -42,058 B gz / -33,113 B br: 17.0% of the gzipped eager
 * payload and 15.5% of the brotli one, off every page in the app.** X10's four
 * on-demand chunks were `builder` 109,361 (32,177 gz) with `download` 16,265
 * beside it, `library` 23,236 (6,667 gz), `settings` 8,008 (2,773 gz) with the
 * shared `lock-picker` 14,528, and X9's `assemblies` 48,464 (5,858 gz). After
 * row L1 there is no `settings` pair and no shared `lock-picker`; the picker is
 * inside `builder`. After row **A0** there is no `library` pair either, so the
 * on-demand set was `builder` (with `download` beside it) and `assemblies`.
 *
 * **The sidebar row deleted `/assemblies` and the landing page, and the two are
 * opposite kinds of deletion in exactly the terms of this table.**
 * `/assemblies` was lazy, so it gives back the declaration and the wrapper and
 * nothing else — the 48,464 B chunk is simply no longer emitted, and the
 * on-demand set is now `builder` and `download` alone. The landing page was
 * **eager**, so its 15,902 B (5,138 gz) come off the bundle every visitor
 * downloads for real, and its stylesheet with them. Neither figure is re-quoted
 * from an A/B of this file, for A0's reason twice over: the same row moves the
 * nav into the rail, deletes the header's archive stat, and moves the catalog's
 * facet sidebar and the builder's palette into a portal, so an A/B of this file
 * alone would book five unrelated relocations as route-deletion savings.
 *
 * **The whole row A/Bs as -11,571 B raw / -758 B gz / +464 B br**, by the method
 * above at `SOURCE_DATE_EPOCH=1700000000`: `main` preloads **5** files at
 * 664,073 / 205,403 / 178,972 and this tree **9** at 652,502 / 204,645 /
 * 179,436. The raw saving is real and the compressed one is almost nothing,
 * because the four extra preloaded chunks split the compression context — the
 * same chunk-graph effect the `/settings` row of the table above records,
 * running against us this time. It is 0.26% of the brotli payload and not worth
 * chasing a hand-written chunk boundary for; what a future row should take from
 * it is that **deleting an eager screen returns raw bytes and not necessarily
 * compressed ones.**
 *
 * **One line of X10's method had gone stale, and the count is the part to
 * distrust.** Its baseline is quoted "over the four preloaded files"; the tree
 * L1 inherited preloaded **seven** — `index`, `catalog`, `primitives`,
 * `vanilla` and `scene` plus two stylesheets — and the tree L1 shipped preloads
 * **four** again, for the chunk-graph reason above. So the number of files is a
 * consequence of the tree and not a property of the method. **The method is
 * "sum every file `dist/index.html` preloads", and it is the only line of this
 * that a future row should copy**; a fixed file count, or a JS-only sum, books a
 * CSS relocation as a saving it has not made.
 *
 * Every row above was built from **one frozen copy** of the tree, because other
 * rows were editing this working tree while the A/Bs ran — 26 files moved under
 * it, none of them this one — and a baseline that moves between builds compares
 * nothing. Re-run as a single A/B against the
 * tree as it merged — 817,596 / 248,274 / 213,697 static against 661,350 /
 * 205,789 / 180,489 lazy — the same edit is worth **-156,246 raw / -42,485 gz /
 * -33,208 br**, which reproduces the table to within 427 B gzipped.
 *
 * ## Why the catalog stays eager, which is a measurement and not a caution
 *
 * A lazy route is not a deferral of *some* work on a cold load; it is a
 * round trip in front of **all** of it. Measured against this app's real
 * `AppFrame` with a lazy child whose import is a promise held open: **1.4 s into
 * the pending chunk the document is still empty** — no rail, no nav, no
 * skeleton, and `index.html` ships an empty `#root` — **and the
 * `catalog.json` request has not been issued.** Both happen on the tick the
 * chunk lands. In-app navigation is the opposite and is why `/builder` is free:
 * the screen the user is on **stays painted** for the whole pending window, so a
 * lazy route reached by a nav press costs a transition and nothing visible.
 *
 * That split the six by how they were *arrived at*, not by what they weighed,
 * and the sidebar row collapsed the two eager ones into one:
 *
 *   - **The landing page was the cold load.** The 15,902 B its chunk deferred
 *     (5,138 gz) were the bytes of the only thing on the screen, so the "saving"
 *     was a deferral of work that was immediately needed, plus a round trip
 *     before the first pixel. Alone it was also a brotli **regression** (+499 B)
 *     and it fragmented the preload set from 4 files to 9. It is deleted now, and
 *     the 15,902 B are gone rather than deferred, which is the only way that
 *     number was ever going to come off.
 *   - **The catalog is the cold load, and now it is the only one.** Every shared
 *     facet link and every `?tile=` link was already a cold catalog; since it
 *     took `/`, so is every visit. On top of the three shipped above, making it
 *     lazy was worth a further **-150,677 raw / -44,289 gz / -37,695 br** — the
 *     largest number in this file — because by then nothing eager imported the
 *     barrel any more. It is still declined, and the deletion of the landing page
 *     sharpens the reason rather than softening it: a round trip would now sit in
 *     front of the **first** page of the app **and** in front of the 5,907,360 B
 *     (366,768 B brotli at the payload epoch) `catalog.json` that the screen
 *     requests on mount and the grid cannot render without.
 *
 * That 44,289 B is not lost, it is *conditional on the fetch being started
 * early*, and nothing that starts it early is in this file. A hand-written
 * `<link rel="modulepreload">` in `index.html` is not the answer — the chunk
 * name is content-hashed, so the tag would rot on the next build — but
 * `router.preloadRoute({ to: '/' })` on boot in `src/App.tsx`, or
 * `defaultPreload: 'intent'` in `src/routes/router.ts` (which would also hide
 * `/builder`'s in-app transition), both start it without blocking the first
 * paint. Reported rather than done: neither file is this row's, and the saving is
 * only real once something proves the fetch overlaps the paint.
 */
import { createRootRoute, createRoute, lazyRouteComponent, stripSearchParams } from '@tanstack/react-router'

import {
  defaultCatalogSearch,
  defaultFacetSearch,
  validateCatalogSearch,
  validateFacetSearch,
} from '@/search/searchSchema'
import { CatalogScreen } from '@/screens/catalog'
import { AppFrame } from '@/ui/shell'

import { ErrorPlaceholder, NotFoundPlaceholder } from './placeholders'

/**
 * The frame every screen renders inside.
 *
 * `notFoundComponent` and `errorComponent` are set here rather than left to the
 * router's defaults so that a bad path and a thrown screen both render
 * something. Both render *inside* `AppFrame` — they are children of this route —
 * so a 404 keeps the rail and the user keeps a way out.
 */
export const rootRoute = createRootRoute({
  component: AppFrame,
  notFoundComponent: NotFoundPlaceholder,
  errorComponent: ErrorPlaceholder,
})

/**
 * The catalog, at `/`: facets, free text, and the tile whose drawer is open.
 *
 * `stripSearchParams(defaultCatalogSearch())` is what keeps the URL honest.
 * TanStack runs `validateSearch` first, so the middleware sees a fully populated
 * search object and deletes every key still equal to its default. Unfiltered is
 * therefore `/`, not `/?q=&kinds=&tex=&build=&conn=&tile=null`, and a link only
 * ever spells out what the user actually chose.
 */
export const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: validateCatalogSearch,
  search: { middlewares: [stripSearchParams(defaultCatalogSearch())] },
  component: CatalogScreen,
})

/**
 * The builder. Carries the facets because design-contract.md §2.4 gives the
 * palette a search box over the whole catalog, and that search deserves to be
 * linkable for the same reason the catalog's does.
 *
 * The share-link payload rides in the URL *fragment* (§13: columnar JSON →
 * `CompressionStream('deflate-raw')` → base64url), not in a search param, so it
 * is deliberately absent from this schema. PR 10 owns the codec and reads
 * `location.hash`; a compressed room in a query param would be validated,
 * re-encoded and canonicalised by this layer for no benefit.
 *
 * **Lazy since row X10, and the largest single win in this file: -34,678 B gz
 * (-28,137 br) off every other page**, against 109,361 B (32,177 gz) of screen
 * and stylesheet on the press. The one route where that trade is arguable, and
 * the argument is written down rather than waved at: a share link is a *cold*
 * `/builder`, so a recipient now waits a round trip on an empty page. It ships
 * lazy anyway because the cold builder path is already two lazy chunks deep
 * before it can draw a room (`BuilderRoom` 82,922 and `material` 1,187,797), so
 * one more in front of it is a proportional change rather than a new kind of
 * wait — where on the catalog it would be a new kind of wait, which is exactly
 * why the catalog stayed eager.
 */
export const builderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/builder',
  validateSearch: validateFacetSearch,
  search: { middlewares: [stripSearchParams(defaultFacetSearch())] },
  component: lazyRouteComponent(() => import('@/screens/builder'), 'BuilderScreen'),
})

/**
 * The two, in nav order.
 *
 * X9's `/assemblies` declaration used to sit above this array and carried the
 * measurement that made it the tree's first lazy route — a static mount of that
 * screen cost **+47,972 B raw / +5,833 B gzipped** on every page for a screen
 * reached from one nav tab. The screen is deleted, but the finding is the reason
 * `/builder` above is written the way it is, so it is kept in the module note
 * rather than lost with the declaration.
 */
export const routeTree = rootRoute.addChildren([catalogRoute, builderRoute])
