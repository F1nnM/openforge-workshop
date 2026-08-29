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
 * | root frame | `AppFramePlaceholder` | PR 12 — `src/ui/shell/`                |
 * | `/`        | `LandingPlaceholder`  | PR 16 — `src/screens/landing/`         |
 * | `/catalog` | `CatalogPlaceholder`  | PR 13 — `src/screens/catalog/` (+ PR 15's drawer) |
 * | `/library` | `LibraryPlaceholder`  | PR 14 — `src/screens/library/`         |
 * | `/builder` | `BuilderPlaceholder`  | PR 18 — `src/screens/builder/`         |
 *
 * Each of those changes exactly one `component:` reference in `routeTree.tsx`.
 * Nothing else in `src/routes/` moves, and the search-param contract does not
 * move at all.
 *
 * There is deliberately no styling here beyond what makes the text legible. The
 * Parchment palette is PR 2's and the frame is PR 12's; a placeholder that
 * looked finished would invite someone to keep it.
 */
import { Link, Outlet, getRouteApi, useRouterState } from '@tanstack/react-router'

/**
 * Reached by route id rather than by importing `catalogRoute`, which would make
 * this module and `routeTree.tsx` import each other. The id is checked against
 * the registered route tree, so a renamed route is a compile error here.
 */
const catalogApi = getRouteApi('/catalog')

/**
 * The frame every screen renders inside — the root route's component.
 *
 * It exists in this PR for one reason: to prove `<Outlet />` is wired and that
 * nav links are typed against the route tree. PR 12 replaces it with the real
 * sticky header, wordmark and live count chips from design-contract.md §2.0.
 */
export function AppFramePlaceholder() {
  return (
    <div className="min-h-screen font-sans">
      <header className="flex items-center gap-6 border-b px-6 py-4">
        <strong className="font-bold">OPENFORGE</strong>
        <nav className="flex gap-4 text-sm">
          <Link to="/">Home</Link>
          <Link to="/catalog">Catalog</Link>
          <Link to="/library">Library</Link>
          <Link to="/builder">Builder</Link>
        </nav>
      </header>
      <Outlet />
    </div>
  )
}

function Screen({ title, note }: { title: string; note: string }) {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm">{note}</p>
    </main>
  )
}

export function LandingPlaceholder() {
  return <Screen title="Landing" note="Placeholder — PR 16 owns this screen." />
}

/**
 * Catalog placeholder.
 *
 * Unlike the others it reads its search params, because reading them is the
 * thing this PR has to demonstrate: the values below are fully typed, come from
 * the URL, and are already normalised and defaulted by `validateCatalogSearch`.
 */
export function CatalogPlaceholder() {
  const search = catalogApi.useSearch()
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Catalog</h1>
      <p className="mt-2 text-sm">Placeholder — PR 13 owns this screen, PR 15 owns the drawer.</p>
      <pre className="mt-4 text-xs">{JSON.stringify(search, null, 2)}</pre>
    </main>
  )
}

export function LibraryPlaceholder() {
  return <Screen title="Library" note="Placeholder — PR 14 owns this screen." />
}

export function BuilderPlaceholder() {
  return <Screen title="Builder" note="Placeholder — PR 18 owns this screen." />
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
    <main className="p-8">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-sm">
        Nothing is routed at <code>{pathname}</code>.
      </p>
      <p className="mt-4 text-sm">
        <Link to="/catalog">Browse the catalog</Link>
      </p>
    </main>
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
    <main className="p-8">
      <h1 className="text-2xl font-bold">Something broke</h1>
      <p className="mt-2 text-sm">{error.message}</p>
    </main>
  )
}
