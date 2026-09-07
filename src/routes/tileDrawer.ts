/**
 * Opening and closing the tile detail drawer.
 *
 * The drawer's *contents* are PR 15's. Its **history semantics** are routing,
 * and they live here because getting them wrong is the classic modal-in-a-URL
 * bug: if closing the drawer is a normal navigation, it pushes a third history
 * entry and the Back button re-opens the thing the user just dismissed.
 *
 * The rule these three functions encode:
 *
 *   - **Opening pushes.** One entry, so Back closes the drawer and lands back on
 *     the same filtered catalog — the facets ride in the same URL, so nothing is
 *     lost and nothing is re-fetched.
 *   - **Swapping the subject replaces.** design-contract.md §2.5 ends with
 *     "other sizes in this family" buttons that change which tile the drawer is
 *     showing. Those are not new places; if each one pushed, dismissing a drawer
 *     after browsing five variants would need six Back presses to escape.
 *   - **Closing goes back**, so the entry the drawer added is consumed rather
 *     than doubled. When there is nothing to go back to — someone opened a
 *     shared `?tile=` link cold — it replaces instead, which closes the drawer
 *     without inventing history that would trap the user in the app.
 *
 * Because swapping replaces, the only push that ever opens the drawer is
 * `openTileDrawer`, and `canGoBack()` is therefore a sufficient test at close
 * time. The one case it decides differently from a naive reading is a `<Link>`
 * straight to `/catalog?tile=N` from another screen: Back then returns to that
 * screen rather than to the catalog behind the drawer. That is the correct
 * answer — the user came from there.
 *
 * These are plain functions over a router rather than hooks so they can be
 * driven headlessly in `routes.test.ts`. The drawer calls them with
 * `useRouter()`.
 *
 * The two that name a tile take a {@link TileSubject} — an ordinal, a variant or
 * a whole aggregate — and put {@link tileOrdinal} of it in the URL. A caller
 * holding an item therefore never has to decide which variant supplies the number,
 * and an `AggregateAddress` will not typecheck as a subject. Which number that is
 * and why it is not the address is `tileAddress.ts`.
 */
import type { WorkshopRouter } from './router'
import type { TileSubject } from './tileAddress'
import { tileOrdinal } from './tileAddress'

/**
 * Open the detail drawer on a tile, keeping the current facets and query.
 *
 * Pushes a history entry, so Back closes the drawer.
 */
export async function openTileDrawer(router: WorkshopRouter, subject: TileSubject): Promise<void> {
  const tile = tileOrdinal(subject)
  await router.navigate({
    to: '/',
    search: (prev) => ({ ...prev, tile }),
  })
}

/**
 * Change which tile the open drawer is showing — the family-variant buttons.
 *
 * Replaces rather than pushes, so a browse through six variants stays one
 * history entry and one Back press still returns to the catalog.
 */
export async function showTileInDrawer(router: WorkshopRouter, subject: TileSubject): Promise<void> {
  const tile = tileOrdinal(subject)
  await router.navigate({
    to: '/',
    search: (prev) => ({ ...prev, tile }),
    replace: true,
  })
}

/**
 * Close the drawer — the backdrop click and the `Escape` key.
 *
 * Consumes the entry `openTileDrawer` pushed, so the history stack does not grow
 * by two per open/close cycle and Forward re-opens the drawer exactly once.
 */
export async function closeTileDrawer(router: WorkshopRouter): Promise<void> {
  if (router.history.canGoBack()) {
    router.history.back()
    return
  }
  // Cold load of a shared `?tile=` link: there is no entry to consume, so drop
  // the param in place rather than pushing a "closed" entry that Back would undo.
  await router.navigate({
    to: '/',
    search: (prev) => ({ ...prev, tile: null }),
    replace: true,
  })
}
