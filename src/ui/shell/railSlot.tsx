/**
 * The rail's slot: how a screen renders its own sidebar inside the frame's.
 *
 * The frame owns one column — wordmark, nav, and then whatever the screen the
 * user is on contributes: the catalog's filter groups, the builder's palette.
 * The mockup this row was drawn from draws that as **one** column with dividers
 * between the three, not as a rail with a second sidebar beside it, and the
 * difference is not decoration: two adjacent columns cost about 500px of chrome
 * before the first tile, and the seam between them tells the user there are two
 * navigations when there is one.
 *
 * So the frame renders an empty node and the screen renders into it, through
 * `createPortal`. Three alternatives were considered and this is the least bad:
 *
 *   - **The frame renders the sidebars itself**, switching on the route. That
 *     puts `FacetSidebar` — which reads `useSearch()`, holds a draft query and
 *     owns 35 controls — and `PalettePanel` — which reads the store and the
 *     catalog index — inside `AppFrame`, so the frame would import both screens
 *     and every route would pay for both. It also inverts ownership: the facets
 *     belong to the screen whose URL they are in.
 *   - **The screens render their own rail**, each drawing the wordmark and nav
 *     above their sidebar. Three copies of the frame, and the nav would remount
 *     on every navigation — losing focus mid-tab and re-animating.
 *   - **A context of `ReactNode`**, set by the screen in an effect. That is a
 *     portal with extra steps, and it renders the screen's tree under the
 *     *frame's* component instance, so a facet click would re-render the frame
 *     and every screen with it.
 *
 * A portal keeps the tree where it belongs — the catalog's sidebar re-renders
 * when the catalog's search changes, and nothing above it does — and moves only
 * the DOM.
 *
 * ## The one-frame gap, and why it is not a flash
 *
 * The host node is state, set by a ref callback, so the frame's first render has
 * `null` and the screen's rail content appears on the second. That is one
 * commit, in the same paint, and neither screen's rail content is ever the first
 * thing a visitor sees: the catalog's facet groups render from the index, which
 * arrives well after first paint, and the builder is a lazy route. The
 * alternative — a `useRef` and no state — never re-renders at all, and the
 * portal silently renders nothing forever.
 *
 * ## Why `null` renders nothing rather than falling back to in-place
 *
 * A `RailSlot` with no provider above it means "there is no rail", which happens
 * in exactly one place: a component test that renders a screen without the
 * frame. Rendering the children in place instead would make that test pass
 * against a layout the app does not have, and the screens' own tests assert the
 * sidebar's position through the real frame for that reason.
 */
import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'

const RailSlotContext = createContext<HTMLElement | null>(null)

export interface RailSlotHostProps {
  /** The node the frame has mounted for screens to render into. */
  host: HTMLElement | null
  children: ReactNode
}

/**
 * Publish the rail's slot node to the screens below.
 *
 * `AppFrame` is the only caller. It is exported from this module rather than
 * inlined there so the context stays private: a second provider would let a
 * screen redirect another screen's rail content.
 */
export function RailSlotHost({ host, children }: RailSlotHostProps) {
  return <RailSlotContext.Provider value={host}>{children}</RailSlotContext.Provider>
}

export interface RailSlotProps {
  children: ReactNode
}

/**
 * Render this screen's sidebar into the frame's rail.
 *
 * Wraps the sidebar the screen would otherwise have rendered in its own layout
 * — `<FacetSidebar>` on the catalog, `<PalettePanel>` on the builder — and
 * nothing else. Whatever goes in here lands under the nav, in document order, so
 * it is reached by `Tab` after the nav tabs and skipped along with them by the
 * skip link.
 */
export function RailSlot({ children }: RailSlotProps) {
  const host = useContext(RailSlotContext)

  return host === null ? null : createPortal(children, host)
}
