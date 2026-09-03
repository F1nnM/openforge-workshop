/**
 * The frame every screen renders inside — the root route's component.
 *
 * It replaces `AppFramePlaceholder` and does three things: it loads the base
 * stylesheet, it renders the header, and it owns the document's `<main>`.
 *
 * ## The one thing rows 13–16 need to know
 *
 * **The frame owns `<main>`.** A screen renders its own content — sections,
 * grids, headings — but not another `<main>`; the HTML spec allows one per
 * document, and a nested one silently breaks the landmark the skip link and
 * every screen-reader rotor depend on. `<main>` is also the skip link's target
 * and takes focus programmatically, which is why it carries `tabIndex={-1}`.
 *
 * Screens get the header's height as `--of-header-h` (60px), so row 18's
 * three-column builder can be `calc(100dvh - var(--of-header-h))` without
 * restating the number.
 *
 * ## Why the stylesheet is imported here
 *
 * `src/index.css` — where it would otherwise go — belongs to PR 1, and the frame
 * is the one component guaranteed to be mounted whenever anything else is. The
 * import is what makes `body` parchment, so it has to be unconditional; it is
 * not lazy and must not become lazy.
 */
import { Outlet } from '@tanstack/react-router'

import { Header } from './Header'
import './shell.css'

export function AppFrame() {
  return (
    <div className="of-shell">
      {/* First in the tab order, off-screen until focused. The header holds
          three nav links before the content on every screen, and the catalog's
          facet sidebar adds a dozen more. */}
      <a className="of-skip" href="#of-main">
        Skip to content
      </a>
      <Header />
      <main id="of-main" className="of-main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}
