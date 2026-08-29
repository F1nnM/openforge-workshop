/**
 * The app is the router.
 *
 * The instance is created once at module scope rather than inside the component:
 * a router owns history subscriptions and match state, and rebuilding it on a
 * render — which `StrictMode`'s double-invoke would do immediately — would drop
 * both. The real header, nav and page frame are PR 12's, and land as the root
 * route's component (see `src/routes/placeholders.tsx`).
 */
import { RouterProvider } from '@tanstack/react-router'

import { createWorkshopRouter } from './routes'

const router = createWorkshopRouter()

export function App() {
  return <RouterProvider router={router} />
}
