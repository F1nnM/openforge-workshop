/**
 * Placeholder route components.
 *
 * **This file is the seam, and it is meant to be deleted.** PR 6 owns the route
 * tree and the URL state; it does not own a single screen. Every component here
 * is a heading and nothing else, so that the tree can be built, typed and tested
 * before any screen exists.
 *
 * How the real screens land, one PR at a time and without touching
 * `routeTree.tsx`'s structure:
 *
 * | route      | placeholder        | replaced by                              |
 * | ---------- | ------------------ | ---------------------------------------- |
 * | root frame | *landed*              | PR 12 — `src/ui/shell/AppFrame.tsx`    |
 * | `/`        | `LandingPlaceholder`  | PR 16 — `src/screens/landing/`         |
 * | `/catalog` | *landed*              | PR 13 — `src/screens/catalog/` (+ PR 15's drawer) |
 * | `/library` | *landed*              | PR 14 — `src/screens/library/`         |
 * | `/builder` | *landed*              | PR 18 — `src/screens/builder/`         |
 *
 * Each of those changes exactly one `component:` reference in `routeTree.tsx`.
 * Nothing else in `src/routes/` moves, and the search-param contract does not
 * move at all.
 *
 * There is deliberately no styling here beyond what makes the text legible. The
 * Parchment palette is PR 2's and the frame is PR 12's; a placeholder that
 * looked finished would invite someone to keep it.
 *
 * These render `<div>` rather than `<main>`: `AppFrame` owns the document's one
 * `<main>` landmark, and a nested one is invalid and breaks the skip link.
 * Screens land the same way.
 */
import { Link, useRouterState } from '@tanstack/react-router'

function Screen({ title, note }: { title: string; note: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm">{note}</p>
    </div>
  )
}

export function LandingPlaceholder() {
  return <Screen title="Landing" note="Placeholder — PR 16 owns this screen." />
}

/**
 * Shown for any path the tree does not match.
 *
 * Present from the first routing commit rather than later, because the
 * alternative to a not-found component is a blank page, and a blank page is what
 * every stale bookmark and mistyped URL would otherwise produce.
 */
export function NotFoundPlaceholder() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-sm">
        Nothing is routed at <code>{pathname}</code>.
      </p>
      <p className="mt-4 text-sm">
        <Link to="/catalog">Browse the catalog</Link>
      </p>
    </div>
  )
}

/**
 * Shown when a screen throws.
 *
 * Same reasoning as the not-found component: the router's default for an
 * unhandled render error is an empty document, and "the page went white" is the
 * single least debuggable bug report a user can file.
 */
export function ErrorPlaceholder({ error }: { error: Error }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Something broke</h1>
      <p className="mt-2 text-sm">{error.message}</p>
    </div>
  )
}
