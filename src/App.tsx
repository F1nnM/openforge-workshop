/**
 * The app is the router, plus the one background job that belongs to no screen.
 *
 * The instance is created once at module scope rather than inside the component:
 * a router owns history subscriptions and match state, and rebuilding it on a
 * render — which `StrictMode`'s double-invoke would do immediately — would drop
 * both. The real header, nav and page frame are PR 12's, and land as the root
 * route's component (see `src/routes/placeholders.tsx`).
 *
 * ## Why mesh warming is armed here, of all places
 *
 * Row **R1** converts a saved item's STLs to drawable geometry and cached the
 * result by md5; its docblock left the *call* to another row and said what the
 * absence costs — *"nothing breaks and nothing draws"*. Row R3 wires it, and the
 * wiring has to be somewhere that is mounted for every screen and owns no
 * feature, because the moment a mesh is wanted is spread across four of them:
 * an item is saved from the catalog card, the tile drawer, the assemblies screen
 * or the builder's palette, and the mesh has to be ready by the time the builder
 * opens. `src/mesh/warm.ts` sets out why it is a reconciliation of `(library,
 * lock)` rather than a hook on the add action.
 *
 * **The import is dynamic, and that is a bundle decision with a measurement
 * behind it.** A static `import { startLibraryWarming } from '@/mesh/warm'` here
 * would pull `@/mesh`, `@/assembly` and the aggregate builder into the **entry**
 * chunk — the one blocking first paint on the landing screen, where nothing has
 * been saved yet and there is nothing to warm. Behind `import()` they are a
 * chunk fetched after mount, which is the same argument `Builder3DPanel.tsx`
 * makes for the renderer. Warming is deferrable by construction: no frame waits
 * on it, and `warm.ts` does not even resolve the catalog index unless the library
 * is non-empty.
 *
 * The effect is deliberately not `[]`-guarded against `StrictMode`'s double
 * mount. It subscribes, unsubscribes and subscribes again, over a queue whose
 * `request` is idempotent per blob — so the second pass finds every task already
 * queued or `ready` and asks for nothing.
 */
import { useEffect } from 'react'
import { RouterProvider } from '@tanstack/react-router'

import { createWorkshopRouter } from './routes'

const router = createWorkshopRouter()

export function App() {
  useEffect(() => {
    let stop: (() => void) | null = null
    let mounted = true
    void import('./mesh/warm').then((module) => {
      if (!mounted) return
      stop = module.startLibraryWarming()
    })
    return () => {
      mounted = false
      stop?.()
    }
  }, [])

  return <RouterProvider router={router} />
}
