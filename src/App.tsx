/**
 * The app is the router, and nothing else.
 *
 * The instance is created once at module scope rather than inside the component:
 * a router owns history subscriptions and match state, and rebuilding it on a
 * render — which `StrictMode`'s double-invoke would do immediately — would drop
 * both. The real header, nav and page frame are PR 12's, and land as the root
 * route's component (see `src/routes/placeholders.tsx`).
 *
 * ## The background job that used to be armed here is gone
 *
 * `src/mesh/` converted the source STL a user was entitled to into drawable
 * geometry and cached it by md5, because `/lod/` answered 404 and the 3D builder
 * would otherwise have drawn a footprint plate for every tile in every room.
 * That was a stand-in for a backfill, and the backfill has run: `/lod/` serves a
 * ~21 kB meshopt GLB for every one of the archive's 8,353 distinct meshes, so
 * `src/builder/three/useLodStore.ts` fetches the object and there is no second
 * store to warm.
 *
 * Nothing replaces the effect. The conversion warmed a cache *ahead* of the
 * moment a mesh was wanted because the thing it was warming cost a 10.77 MB
 * download and a decimation pass; a store object is small enough that the room
 * simply fetches it when the room needs it, and the objects are `immutable` for
 * a year at the edge, so a second look at the same room is a memory-cache hit.
 */
import { RouterProvider } from '@tanstack/react-router'

import { createWorkshopRouter } from './routes'

const router = createWorkshopRouter()

export function App() {
  return <RouterProvider router={router} />
}
