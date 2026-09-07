/**
 * The frame every screen renders inside — the root route's component.
 *
 * It loads the base stylesheet, renders the rail, owns the document's `<main>`,
 * and holds the one node screens portal their own sidebar into.
 *
 * ## The one thing a screen needs to know
 *
 * **The frame owns `<main>`.** A screen renders its own content — sections,
 * grids, headings — but not another `<main>`; the HTML spec allows one per
 * document, and a nested one silently breaks the landmark the skip link and
 * every screen-reader rotor depend on. `<main>` is also the skip link's target
 * and takes focus programmatically, which is why it carries `tabIndex={-1}`.
 *
 * **And the frame owns the rail.** A screen contributes to it with `<RailSlot>`
 * (see `railSlot.tsx`) rather than rendering a sidebar of its own beside the
 * frame's, which is what makes the mockup's single column single.
 *
 * ## What the layout is, and what stopped being a variable
 *
 * Two columns: a fixed rail and the screen. The rail is `100dvh` and scrolls
 * inside itself, so a catalog with 38 texture chips in the rail does not scroll
 * the grid, and the builder — which forbids page scroll outright — gets a
 * viewport-height work area without arithmetic.
 *
 * `--of-header-h` is gone with the header that defined it. It existed so the
 * builder could write `calc(100dvh - var(--of-header-h))` instead of restating
 * 60px, and so the catalog's sticky sidebar could offset itself under the bar;
 * with the chrome beside the screen rather than above it, both are `100dvh` and
 * `top: 0`, which is not a number worth publishing.
 *
 * ## Why the stylesheet is imported here
 *
 * `src/index.css` — where it would otherwise go — belongs to PR 1, and the frame
 * is the one component guaranteed to be mounted whenever anything else is. The
 * import is what makes `body` parchment, so it has to be unconditional; it is
 * not lazy and must not become lazy.
 */
import { Outlet } from '@tanstack/react-router'
import { useState } from 'react'

import { Rail } from './Rail'
import { RailSlotHost } from './railSlot'
import './shell.css'

export function AppFrame() {
  // State, not a ref: the screens render into this node through a portal, so
  // they have to re-render once it exists. `railSlot.tsx` carries the argument
  // and why the extra commit is not a flash.
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)

  return (
    <div className="of-shell">
      {/* First in the tab order, off-screen until focused. The rail holds the
          wordmark and two nav links before the content on every screen, and the
          catalog's filter groups add ~35 more inside the same column. */}
      <a className="of-skip" href="#of-main">
        Skip to content
      </a>
      <Rail slotRef={setSlot} />
      <RailSlotHost host={slot}>
        <main id="of-main" className="of-main" tabIndex={-1}>
          <Outlet />
        </main>
      </RailSlotHost>
    </div>
  )
}
