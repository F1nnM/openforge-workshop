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
 * `@/mesh` converts the STLs a user is entitled to into drawable geometry and
 * caches the result by md5; without a call site it has none, and the 3D builder
 * draws a footprint plate for every tile in every room. The call has to be
 * somewhere that is mounted for every screen and owns no feature, because the
 * moments a mesh is wanted are spread across the app: a template is placed, a
 * saved room is reloaded, the lock preference is re-solved, or a **share link**
 * lands a room that was never converted on this machine. `src/mesh/warm.ts` sets
 * out why it is a reconciliation of `(placements, lock)` — with the real diff on
 * the derived file set — rather than a hook on the place action.
 *
 * **The import is dynamic, and that is a bundle decision with a measurement
 * behind it.** A static `import { startSceneWarming } from '@/mesh/warm'` here
 * would pull `@/mesh`, `@/assembly` and the aggregate builder into the **entry**
 * chunk — the one blocking first paint on the landing screen, where the room is
 * empty and there is nothing to warm. Behind `import()` they are a chunk fetched
 * after mount, which is the same argument `Builder3DPanel.tsx` makes for the
 * renderer. Warming is deferrable by construction: no frame waits on it, and
 * `warm.ts` does not even resolve the catalog index unless the scene names a
 * file.
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
      stop = module.startSceneWarming()
    })
    return () => {
      mounted = false
      stop?.()
    }
  }, [])

  return <RouterProvider router={router} />
}
