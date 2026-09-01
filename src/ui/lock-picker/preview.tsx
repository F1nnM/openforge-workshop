/**
 * A dev-only harness for the one-time lock notice, at
 * `/src/ui/lock-picker/preview.html`.
 *
 * `LockNotice` is meant to be mounted where the lock preference changes what the
 * user gets — the builder shell, and anything on the download path. Both of those
 * files belong to PR 18, so as of this PR no route in the app renders it, and a
 * component nobody can open cannot be looked at. This is the smallest thing that
 * lets it be looked at: the real store, the real emitted `catalog.json`, and a
 * `/settings` route so the notice's own link goes somewhere.
 *
 * Same shape and the same reasoning as `src/screens/detail/preview.tsx`, which
 * exists for the same reason and whose docblock explains the memory-history trick
 * in full. Two things worth repeating:
 *
 *   - **The router runs on a memory history**, because Vite's dev server would
 *     answer a real `/settings` with the real app rather than this page.
 *   - **The reset button is the point of the harness.** The notice is one-time by
 *     design, so without a way to clear `lockChosen` it can be seen exactly once
 *     per browser profile and never again.
 *
 * It is **not** part of the app. `vite build`'s only input is `index.html`, so
 * neither this module nor its page reaches `dist/`. Delete both the day the
 * builder shell renders `<LockNotice />`; nothing imports them.
 *
 * ```
 * mise exec -- npm run dev
 * open http://localhost:5173/src/ui/lock-picker/preview.html
 * ```
 */
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { SettingsScreen } from '@/screens/settings'
import { resetWorkshop, setLockSystem, useLockChosen, useLockSystem } from '@/store'
import { Eyebrow } from '@/ui/primitives'
import { AppFrame } from '@/ui/shell'

import { LockNotice } from './LockNotice'
import { ALL_LOCK_SYSTEMS, lockLabel } from './reach'

// The base stylesheet — Tailwind's Preflight and the Parchment tokens. Loaded by
// `src/main.tsx` in the app, and by every preview harness for itself; without it
// every `var(--bg)` in the app's CSS resolves to nothing.
import '@/index.css'

/** The controls the harness needs and the app must never have. */
function Harness() {
  const chosen = useLockChosen()
  const lock = useLockSystem()

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '10px 18px' }}>
      <Eyebrow>harness</Eyebrow>
      <span style={{ fontFamily: 'var(--face-mono)', fontSize: 12 }}>
        {`lock=${lock} lockChosen=${String(chosen)}`}
      </span>
      <button
        type="button"
        onClick={() => {
          resetWorkshop()
        }}
      >
        Reset store (bring the notice back)
      </button>
      {ALL_LOCK_SYSTEMS.map((system) => (
        <button
          key={system}
          type="button"
          onClick={() => {
            setLockSystem(system)
          }}
        >
          {`Set ${lockLabel(system)}`}
        </button>
      ))}
    </div>
  )
}

function Page() {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: '22px 26px 48px', maxWidth: 900 }}>
      <Harness />
      <LockNotice />
      <p style={{ margin: 0, fontSize: 13, color: 'var(--mut)' }}>
        Above the rule is the harness; below it is exactly what a host renders. The notice disappears once the choice is
        recorded — use Reset to bring it back.
      </p>
    </section>
  )
}

const rootRoute = createRootRoute({ component: AppFrame })

const router = createRouter({
  routeTree: rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: Page }),
    createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsScreen }),
  ]),
  history: createMemoryHistory({ initialEntries: ['/'] }),
})

const container = document.querySelector('#root')
if (container === null) throw new Error('preview: no #root')

createRoot(container).render(
  <StrictMode>
    {/* The route tree is not the app's, so the registered router type does not
        describe it. The cast is confined to this dev-only file. */}
    <RouterProvider router={router as unknown as never} />
  </StrictMode>,
)
