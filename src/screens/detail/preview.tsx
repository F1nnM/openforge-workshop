/**
 * A dev-only harness for the drawer, at `/src/screens/detail/preview.html`.
 *
 * The drawer is mounted by the catalog screen (row 13) and by nothing else, so
 * until that one line lands there is no route in the app that renders it — and a
 * screen nobody can open cannot be looked at. This is the smallest thing that
 * lets it be looked at: the real app frame, the real search codec, the real
 * emitted `catalog.json`, and a list of ordinary `?tile=` links standing in for
 * the card grid.
 *
 * Two things about the harness are deliberate:
 *
 *   - **The router runs on a memory history seeded from the page's own query
 *     string.** `TileDrawer` reads its param through `getRouteApi('/catalog')`,
 *     so the route it mounts under has to be `/catalog` — which this page's URL
 *     is not, and cannot be, because Vite's dev server would answer `/catalog`
 *     with the real app. So the browser URL seeds the router and the router takes
 *     it from there.
 *   - **Back and Forward are buttons**, for the same reason: they drive
 *     `router.history`, which is exactly what the browser's own buttons drive in
 *     the real app. The readout beside them shows the search string and whether
 *     there is an entry to go back to, which is the whole of §2.5's history
 *     contract in one line.
 *
 * It is **not** part of the app. `vite build`'s only input is `index.html`, so
 * neither this module nor its page reaches `dist/`. Delete both the day the
 * catalog screen renders `<TileDrawer />`; nothing imports them.
 *
 * ```
 * mise exec -- npm run dev
 * open http://localhost:5173/src/screens/detail/preview.html
 * ```
 */
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { CatalogFile, CatalogRecord } from '@/catalog'
import { openTileDrawer } from '@/routes'
import { parseCompactSearch, stringifyCompactSearch, validateCatalogSearch } from '@/search'
import { Eyebrow } from '@/ui/primitives'
import { AppFrame, loadCatalogIndex } from '@/ui/shell'

import { TileDrawer } from './TileDrawer'

import '@/index.css'

interface Case {
  label: string
  ord: number
  name: string
}

/** One tile per branch the drawer has to render, found in the real index. */
function cases(catalog: CatalogFile): Case[] {
  const pick = (label: string, match: (record: CatalogRecord) => boolean): Case[] => {
    const found = catalog.records.find(match)
    return found === undefined ? [] : [{ label, ord: found.ord, name: found.name }]
  }

  return [
    ...pick('rect footprint', (r) => r.foot.shape === 'rect' && r.sprite),
    ...pick('wall footprint', (r) => r.foot.shape === 'wall'),
    ...pick('arc footprint', (r) => r.foot.shape === 'arc'),
    ...pick('size code only', (r) => r.foot.shape === 'none' && r.sizeCode !== undefined),
    ...pick('shape word only', (r) => r.foot.shape === 'none' && r.sizeCode === undefined),
    ...pick('no sprite sheet', (r) => !r.sprite),
    ...pick('no build tag', (r) => r.build === undefined),
    ...pick('no texture tag', (r) => r.texture === undefined),
    ...pick('no kind buckets', (r) => r.kinds.length === 0),
    ...pick('widest family', (r) => r.family === 'tiles/building_facades/roof/roof%shingles'),
  ]
}

const mono = { fontFamily: 'var(--face-mono)', fontSize: 11, color: 'var(--mut)' } as const

function Harness() {
  const router = useRouter()
  const location = useRouterState({ select: (state) => state.location })
  const [catalog, setCatalog] = useState<CatalogFile | undefined>(undefined)

  useEffect(() => {
    loadCatalogIndex().then(setCatalog, (error: unknown) => {
      console.error('preview: catalog index', error)
    })
  }, [])

  return (
    <div style={{ padding: '24px 28px', maxWidth: 760 }}>
      <Eyebrow as="div">Row 15 preview · not part of the app</Eyebrow>
      <h1 style={{ fontFamily: 'var(--face-display)', fontSize: 30, margin: '6px 0 14px' }}>
        Tile detail drawer
      </h1>

      <p style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 18px' }}>
        <button type="button" onClick={() => router.history.back()}>
          ← Back
        </button>
        <button type="button" onClick={() => router.history.forward()}>
          Forward →
        </button>
        <span style={mono}>
          {location.pathname}
          {location.searchStr} · canGoBack {String(router.history.canGoBack())}
        </span>
      </p>

      {catalog === undefined ? (
        <p>Loading the index…</p>
      ) : (
        <>
          <ul style={{ display: 'grid', gap: 6, padding: 0, margin: 0, listStyle: 'none' }}>
            {cases(catalog).map((entry) => (
              <li key={entry.ord}>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--acc)',
                    cursor: 'pointer',
                    font: 'inherit',
                  }}
                  onClick={() => {
                    void openTileDrawer(router as never, entry.ord as never)
                  }}
                >
                  {entry.name}
                </button>{' '}
                <span style={mono}>
                  {entry.label} · #{entry.ord}
                </span>
              </li>
            ))}
            <li>
              <button
                type="button"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'var(--acc)',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
                onClick={() => {
                  void openTileDrawer(router as never, 999_999 as never)
                }}
              >
                An ordinal no tile has
              </button>{' '}
              <span style={mono}>rotted link · #999999</span>
            </li>
          </ul>
          <TileDrawer catalog={catalog} />
        </>
      )}
    </div>
  )
}

const root = createRootRoute({ component: AppFrame })
const catalogRoute = createRoute({
  getParentRoute: () => root,
  path: '/catalog',
  validateSearch: validateCatalogSearch,
  component: Harness,
})

const router = createRouter({
  routeTree: root.addChildren([catalogRoute]),
  history: createMemoryHistory({ initialEntries: [`/catalog${window.location.search}`] }),
  parseSearch: parseCompactSearch,
  stringifySearch: stringifyCompactSearch,
})

const mount = document.getElementById('root')
if (mount !== null) {
  createRoot(mount).render(
    <StrictMode>
      <RouterProvider router={router as unknown as never} />
    </StrictMode>,
  )
}
